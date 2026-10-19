# Auditoría y correcciones de Entrega 5

Referencia verificada: `c86d32058f0fd1741e27e6397f6124a1f1a4b62b`. Rama de trabajo: `codex/entrega-5-audit-fixes`, creada desde ese commit. No se modifica ni fusiona `main` (referencia local inicial `ded62dcba370b899b5295e4e81837a7276b0bc65`). Fecha: 19 de octubre de 2026, zona del usuario America/Guatemala.

## Diagnóstico y reproducciones

Los cuatro hallazgos se confirmaron. `audit-baseline.ts` reproduce el reset RUNNING inaccesible y la exposición de campos del recibo, mide reconstrucción sincrónica y contabiliza páginas SQLite. La primera ejecución de `npm test` aprobó las 213 pruebas originales. Los registros están en `docs/benchmarks/audit-fixes/`, sin credenciales ni bases de partidas.

El primer ensayo de cuatro reconstrucciones consecutivas de 119,9 s registró 498,0 ms de demora de un temporizador y 507,2 ms de demora máxima del event loop. Esto confirma bloqueo en ese escenario; no demuestra por sí solo la degradación de una clase de 31 usuarios. `audit-load.ts` añade un servidor real, partida nueva activa, tres conexiones Socket.IO, dos consultas históricas concurrentes, comandos, chat y ocho cancelaciones HTTP. Las mediciones finales comparables constan en los JSON de carga. El ensayo usa una generación histórica de 120 s y una nueva de 1200 s, velocidad 1.

Para repetir la versión anterior, extraer el commit de referencia a un directorio temporal y copiar allí los scripts de auditoría; usar las mismas dependencias instaladas. El servidor de referencia permanece intacto. `--require` instala instrumentación temporal en el proceso servidor: monitor del event loop de 10 ms, intervalos de 100 ms, duración de sus callbacks y transacciones BEGIN/COMMIT. No altera el motor ni añade endpoints administrativos. El heap medido es el del hilo principal; RSS incluye el proceso completo y los workers.

## H1: interrupción y continuidad histórica

**Causa:** el reset reemplazaba `GameState`, borraba el buffer anterior y solo persistía metadatos RUNNING/PAUSED; `historyAccess` admitía únicamente FINISHED. El persist previo al reset tampoco formaba una transacción con la nueva generación.

**Solución:** se conserva una copia de la generación anterior con sus buffers. Las solicitudes pendientes se cancelan en el mismo tick con `ROOM_INTERRUPTED`, preservando el comportamiento previo de liberación y liquidación del trabajo admitido. Esa cancelación administrativa no produce experiencias negativas del mercado ni quejas automáticas, no avanza el reloj y no equivale a completar la partida. Los resultados ya confirmados permanecen intactos. La generación recibe `ABORTED`, `closure` (generación, tick, estado previo, motivo, identidad, hora real) y un evento con ID del comando. Se fuerza un checkpoint SHA-256 verificable al tick y secuencia del cierre. Las partidas ya FINISHED conservan esa condición.

`createGameWriter` usa una sola transacción `BEGIN IMMEDIATE` para escribir generaciones cerradas, recibos, hechos, checkpoints, nueva sala y recibo durable del comando. Solo después de COMMIT vacía buffers y confirma al cliente. En error, SQLite revierte todo y el servidor recupera el estado y buffer anteriores. `synchronous=FULL` y WAL proporcionan la durabilidad configurada de SQLite. La prueba con SIGKILL valida recuperación después de una confirmación; no simula una avería física del dispositivo.

La deduplicación `(identity,id,digest,result)` ya era durable y se conserva entre generaciones y reinicios. Los recibos de comandos sobreviven incluso a la eliminación de una generación. Un ID reutilizado con otro cuerpo se rechaza. También se prueba un trigger que hace fallar la escritura del reset: no hay ACK positivo, no existe generación parcial y el mismo comando puede reintentarse después de retirar el fallo.

El DVR admite FINISHED y ABORTED, limita las solicitudes al último tick real y distingue visualmente la interrupción. El botón de reset explica que se conserva el historial. El acceso al DVR desde el control está disponible también durante una partida nueva.

**Compatibilidad:** `sealLegacyGenerations` cierra generaciones anteriores huérfanas únicamente si su último tick durable puede reconstruirse. Las marca `LEGACY_UNCLOSED` sin inventar identidad, hora de interrupción o evidencia faltante. No recupera eventos que la versión anterior nunca escribió. Si faltan checkpoints o una versión de replay no es compatible, falla de manera visible y conserva los datos.

## H2: separación de información observable y evidencia interna

**Causa:** se usaba una lista negativa incompleta para construir recibos y se devolvía directamente el JSON persistido. Había rutas alternativas en las solicitudes de LAST-UNIT, marcadores, estadísticas forenses y etiquetas de partículas.

**Solución:** `projections.ts` contiene contratos positivos para recibos, resultados y hechos. La proyección estudiantil admite identificadores propios, estado, tiempos, etapa, ruta publicada, stock realmente leído, resultado operativo, liquidación y trazas observables. `securityAllowed`, `trafficClass`, `attackKind`, `breach`, activaciones, contratos internos y pérdidas atribuidas a defectos no pasan a esos contratos. Los objetos anidados también se proyectan. Campos futuros desconocidos se mantienen privados por defecto.

Los recibos internos preservan evidencia completa salvo el objeto repetido de la versión publicada: la versión y módulos congelados siguen en checkpoints y hechos del journal. Las proyecciones no modifican esas estructuras. El docente recibe los recibos internos y la evidencia forense autorizada de generaciones cerradas. Las métricas estudiantiles no revelan artefactos con defectos latentes ni atribuciones internas. Los contadores de clasificación de tráfico, la tasa interna de fraude, el contador interno de penetraciones y el diagnóstico `kind: attack` se reservan al operador; permanecen las métricas operativas y el mismo diseño visual.

La autorización de solicitudes usa la empresa de sesión, no parámetros del navegador. Anónimo: 403; otra empresa: 404. En el DVR se verifica también generación cerrada y empresa; los errores de reconstrucción/worker no devuelven errores SQL ni rutas internas. No se modifican cálculos de economía ni generación de tráfico.

Se auditaron `/api/snapshot`, snapshots Socket.IO, `/api/requests/:id` tanto vivo como persistido, LAST-UNIT privado, `/api/flowslack`, marcadores, chat histórico, métricas y evidencia del DVR. Las comunicaciones humanas son contenido introducido por sus autores; las comunicaciones automáticas usan evidencias visibles. No se filtra deliberadamente lo que una persona escribe a su propio equipo.

## H3: aislamiento y control de carga

**Causa:** reconstrucción, lectura de hechos y post-mortem sincrónicos compartían el hilo de ticks, sockets y chat. Envolverlos en una promesa no libera ese hilo.

**Solución:** todos los endpoints DVR ejecutan sus consultas, reconstrucción y construcción de respuesta en `DvrPool`. Cada worker abre su propia conexión SQLite `readOnly`, `query_only`, caché de 8 MiB, sin mmap, y una transacción de lectura por trabajo. Solo recibe consulta e identidad clonadas, nunca la partida activa. El hilo principal mantiene autenticación, admisión y entrega HTTP.

Valores predeterminados: 2 workers, cola global de 8 trabajos, 2 trabajos admitidos por identidad, plazo total de 15 s, heap V8 de 512 MiB por worker más generación joven de 32 MiB. Se permite configurar `FLOW_DVR_WORKERS` entre 1 y 4. Los otros límites están centralizados y validados en `PoolOptions`, con límites superiores; no hay cola ilimitada. Dos workers permiten atender las dos consultas del ensayo; ocho en cola y dos por identidad limitan a diez trabajos globales y evitan que una sola identidad llene la cola. El heap toma como referencia los escenarios originales de Entrega 5, con picos cercanos a 419 MiB, y se valida con escenarios largos; no constituye un límite absoluto del RSS nativo. La aplicación no promete capacidad ilimitada en equipos con poca memoria.

Un aborto HTTP elimina un trabajo en cola o termina el worker que lo está ejecutando. No se reutiliza el slot hasta acabar la terminación. Error, salida o timeout rechazan el trabajo de manera visible; los siguientes trabajos crean un worker nuevo. 429/503 incluyen `Retry-After: 1`. Los workers inactivos no mantienen vivo un servidor cerrado. El cierre explícito termina todos los workers.

El cliente conserva debounce de 70 ms, usa AbortController, verifica secuencia antes de aplicar un frame, cancela métricas obsoletas y no aplica evidencia de una empresa/generación anterior. Los mensajes de saturación son comprensibles. La prueba del pool compara resultados exactos con `queryDvr`, comprueba temporizadores vivos, límites, cola, cancelaciones y caída/recreación de un worker. Pruebas del servidor ejercitan el modo real `NODE_ENV=production` con tsx; un bootstrap `.mjs` registra el runtime ya existente, sin nueva dependencia.

## H4: almacenamiento, archivo y retención

**Causa:** recibos extensos repetían rutas y trazas; no había generación explícita en recibos/comandos ni operaciones completas de administración. Los checkpoints ya estaban comprimidos. El tamaño lógico de JSON no equivale a páginas físicas.

**Solución de formato:** las rutas se guardan una vez por `(generation,SHA-256)`. Los campos consultados mediante SQLite JSON (`type`, `arrivalAt`, resultado, `waits`, estado y liquidación) siguen siendo JSON. Los otros detalles se comprimen sin pérdida en un BLOB zlib con checksum de la representación original. El decodificador soporta recibos inline heredados, rutas referenciadas sin compresión y `receipt-zlib-1`. El límite de descompresión de detalles de un recibo es 4 MiB; detalles mayores se conservan inline para no crear recibos ilegibles; las rutas, checkpoints y metadatos se conservan aparte. La aplicación genera trazas de tamaño acotado por la ejecución y las pruebas verifican la descompresión y equivalencia.

La primera alternativa de solo deduplicar rutas redujo payload, pero aumentó un 0,14 % las páginas físicas del ensayo: no se aceptó como mejora. La solución elegida, con compresión de detalles, redujo el mismo conjunto de evidencias de 77.778.944 a 64.802.816 bytes tras VACUUM en ambos casos (16,68 %). No se borró evidencia para obtener esa cifra. `audit-storage.ts` compara hashes de todos los recibos decodificados, produce tres partidas completas de 60 s, mide crecimiento, exporta y vuelve a leer el archivo. Es una prueba de formato; no representa una partida docente de 20/25 minutos. Los benchmarks originales de duración completa se ejecutan por separado.

### Esquema y datos heredados

Se agregan `history_games.closure` y `closedAt`, `request_receipts.generation`, `details`, `detailDigest`, `commands.generation`, `receipt_paths`, índices por generación, y tablas `history_policy`, `history_protection`, `history_archives` y `storage_lease`. `closedAt` es la primera escritura durable que registra el cierre; no inventa una hora simulada.

Las migraciones son aditivas. El guardado sigue aceptando esquemas de partida 1–6. `compact` asigna generación a recibos antiguos solo cuando `history_events.data.requestId` identifica exactamente una generación. Nunca analiza prefijos de IDs. Los recibos sin vínculo inequívoco permanecen íntegros y aparecen como no asignados. Los comandos heredados sin generación permanecen como recibos globales de deduplicación; el journal guarda sus entradas históricas. No se borra esa información ni se supone una relación inexistente.

### Operación administrativa

La CLI requiere la credencial real de operador en `FLOW_ADMIN_CODE`, validada contra `access.json`; rechaza una credencial de estudiante. No publica endpoints destructivos ni expone credenciales. Debe ejecutarse con el servidor detenido. Una concesión durable en SQLite serializa la admisión de servidor/administrador; se recupera automáticamente si el PID anterior murió y conserva el bloqueo si no puede probarlo. La prueba incluye un proceso CLI distinto rechazado mientras existe una concesión activa.

Ejemplos (las rutas de exportación son elegidas por el administrador):

```sh
# Configurar FLOW_DATA_DIR y FLOW_ADMIN_CODE de forma local, sin publicarlos.
npm run history:admin -- usage
npm run history:admin -- preview
npm run history:admin -- policy '{"keepGenerations":null,"olderThanDays":null,"deleteEnabled":false}'
npm run history:admin -- protect 0 'Conservar para evaluación'
npm run history:admin -- export 0 /ruta/privada/partida-0.sqlite
npm run history:admin -- verify /ruta/privada/partida-0.sqlite
npm run history:admin -- read /ruta/privada/partida-0.sqlite 10.5
npm run history:admin -- compact
npm run history:admin -- vacuum
```

No hay umbral de retención ni borrado automático predeterminado. Para habilitar borrado, el docente configura explícitamente `keepGenerations` y/o `olderThanDays`, además de `deleteEnabled:true`. Si ambos criterios están configurados, ambos deben cumplirse. Una fecha heredada desconocida nunca satisface un criterio de edad. `preview` muestra causas de protección, estado del archivo y elegibilidad sin modificar partidas. `unprotect <n>` retira una protección explícita; no evita las demás barreras.

La exportación crea una base independiente de una sola generación: hechos, entradas, checkpoints, puntos, conversaciones, recibos, diccionario de rutas y recibos de comandos asignados. No incluye sesiones, credenciales ni la partida activa. Se publica sin sobrescribir destino, con permisos 0600, fsync, manifiesto por tabla, conteos, SHA-256 del archivo, `integrity_check`, checksums de checkpoints y reconstrucción del último tick. Se registra el archivo solo después de verificarlo.

La eliminación requiere archivo registrado y verificado de nuevo, coincidencia exacta del manifiesto con la generación aún almacenada, política habilitada, elegibilidad, ausencia de protección y confirmación del número:

```sh
npm run history:admin -- delete 0 --confirm-generation 0
```

Se prohíbe eliminar la generación actualmente cargada, incluso si está FINISHED, y cualquier generación no terminal. La operación borra todas sus tablas relacionadas dentro de una transacción; un fallo intermedio revierte todo. Los recibos globales de comandos se conservan para no romper idempotencia. El archivo independiente permite recuperar la evidencia mediante `read` y las funciones de consulta/reconstrucción de historial; no se implementa importación en la base viva para evitar colisiones entre generaciones. `vacuum` es explícito y offline: borrar filas por sí solo libera páginas, sin necesariamente reducir el archivo.

### Medición

`usage` informa archivo principal, WAL y SHM, tamaño de página, páginas libres, tablas e índices con `dbstat`, filas por generación, bytes lógicos de hechos y bytes comprimidos de checkpoints. Los payloads y la asignación física se identifican por separado. La tabla `game` contiene solo el estado actual y puede generar páginas libres al reemplazarse; no se atribuye ese espacio a pérdida de evidencia.

## Pruebas, archivos y límites

Se añadieron once casos de auditoría: siete de reset, uno de servidor que reúne privacidad/deduplicación/fallo/reinicio, uno de workers con múltiples escenarios y dos de retención/compatibilidad/CLI. El total esperado es 224, frente a 213 de referencia; se registra el total realmente ejecutado más abajo. No se modificaron expectativas de pruebas históricas ni cifras de benchmarks anteriores. Se conservaron los resultados fallidos intermedios como diagnóstico local; la evidencia versionada corresponde a ejecuciones finales y a la línea base identificada.

Archivos centrales: `engine.ts`, `observability.ts`, `history.ts`, `storage.ts`, `index.ts`, `traffic.ts`, `requests.ts`, `market.ts`, `flowslack.ts`, `postmortem.ts`, `shared/types.ts`, `src/Dvr.tsx` y `src/App.tsx`. Nuevos módulos: `projections.ts`, `dvr-query.ts`, `dvr-pool.ts`, bootstrap/worker, `receipt-storage.ts`, `storage-lease.ts`, `history-admin.ts`. CLI, scripts y pruebas se localizan en `scripts/audit-*`, `scripts/history-admin.ts`, `tests/audit-*`. `connection-benchmark.ts` solo admite tipológicamente la ausencia de contadores privados para roles estudiantiles; no cambia ninguna expectativa ni escenario.

Riesgos residuales: los ticks, el guardado del estado vivo y su compresión siguen siendo sincrónicos; H3 separa las consultas históricas, no promete eliminar toda pausa por persistencia. Los workers tienen límite de heap V8, no un límite absoluto de memoria nativa/RSS. La carga medida no reproduce todas las redes ni equipos escolares. Las exportaciones contienen evidencia privada y requieren custodia administrativa. Los checksums detectan corrupción respecto de un manifiesto o digest conocido, no autentican un archivo adversarial cuyo manifiesto también haya sido reemplazado. No se ofrece migración descendente de los nuevos BLOB a un servidor antiguo: los archivos se leen con la versión corregida. Los recibos de comandos crecen deliberadamente para mantener deduplicación durable. No se implementa importación/restauración sobre la base activa; se proporciona lectura independiente verificada. Un PID reutilizado puede conservar un bloqueo de mantenimiento por precaución, nunca liberar a ciegas una concesión viva.

## Resultados finales y comparación

Los valores finales y las ejecuciones completas se incorporan al terminar los benchmarks; los JSON contienen los resultados originales sin reemplazar las referencias históricas de Entrega 5.
