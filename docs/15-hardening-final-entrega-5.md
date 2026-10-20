# FLOW WAR — hardening final de Entrega 5

## Referencia y trazabilidad

Repositorio: [imanderrrrr/flow-war](https://github.com/imanderrrrr/flow-war). Rama inicial `codex/entrega-5-audit-fixes`, SHA exacto `dd88729949dabbbf8c216c265dd580eef071a5aa`, comprobado localmente y mediante `git ls-remote`. Rama de entrega: `codex/entrega-5-final-hardening`, creada desde ese SHA. Sin merges ni cambios en main. Los commits separan reproducción, retención, bloqueo y validación.

| Commit | Evidencia o corrección |
| --- | --- |
| `f858e82` | Reproducción fallida de la contradicción de archivo |
| `ef43839` | Elegibilidad separada y comprobación de integridad |
| `9e91e7b` | Exclusión nativa SQLite independiente del PID |
| `cabf26b` | Agrupación de notificaciones con ACK durable individual |
| `0d33e99` | Exclusión antes de crear credenciales en el primer arranque |
| `3462651` | Fuentes congeladas de producción y telemetría de la serie definitiva |
| `f2895e4` | Tres ensayos completos de aula; punto de medición de regresiones |

## A. Elegibilidad de archivo y eliminación

La prueba original exportó correctamente una generación FINISHED sin política y después falló al exigir que la vista previa anunciara esa posibilidad. [Reproducción original](benchmarks/final-hardening/reproduction-retention.txt).

La causa era una lista compartida de restricciones. `NO_RETENTION_RULE`, protección y generación actual pertenecían a la política de eliminación y también impedían anunciar respaldos. La vista previa tampoco verificaba que un archivo todavía coincidiera con su digest y el historial actual antes de anunciar que era eliminable.

`archiveReasons` valida cierre terminal con fecha válida y evidencia reconstruible. Protección, generación actual y ausencia de política no impiden exportar. `deletionReasons` agrega todas las restricciones anteriores de borrado: generación actual, protección, política explícita, retención por cantidad/edad, habilitación de borrado, archivo íntegro y manifiestos coincidentes con la generación actual. `reasons` se conserva como alias de las razones de eliminación para compatibilidad. Eliminar sigue requiriendo confirmación exacta y transacción atómica; los recibos de comandos sobreviven como tombstones.

Vista previa, exportación y verificación comparten la comprobación de recibos, checkpoints y reconstrucción final. Una vista previa es una observación: cualquier cambio posterior exige volver a comprobar; la eliminación repite las validaciones dentro de `BEGIN IMMEDIATE`.

La prueba nueva cubre LOBBY, RUNNING, FINISHED actual, FINISHED histórica sin archivo, ABORTED sin política, protegida exportable, archivada con borrado deshabilitado, archivada con política habilitada, checksum modificado, historial modificado tras exportar y cierre inválido. Las pruebas heredadas conservan rollback de borrado parcial, archivos corruptos, lectura independiente y deduplicación durable.

## B. Exclusión administrativa del almacenamiento

La reproducción introdujo una fila obsoleta cuyo PID coincidía con un proceso vivo ajeno al dueño anterior. El código anterior rechazó la adquisición: `kill(pid,0)` prueba existencia, no identidad. Esto valida una debilidad de diseño; no demuestra un incidente de producción. [Reproducción original](benchmarks/final-hardening/reproduction-pid.txt).

La base de la sala usa WAL, transacciones cortas, `synchronous=FULL` y lectores DVR independientes. Mantener una transacción exclusiva en esa misma base impediría el funcionamiento normal. Node no proporciona un flock multiplataforma equivalente en su API fs; consultar `/proc` sería específico de Linux. Un tiempo de inicio necesita mecanismos distintos por SO y tratamiento conservador de errores. Un token persistente identifica una instancia, pero por sí solo no demuestra si vive. Un timeout podría expulsar a un proceso legítimo pausado.

La corrección mantiene una transacción `BEGIN EXCLUSIVE` durante toda la vida del dueño en una SQLite auxiliar, `game.sqlite.admin-lock.sqlite`, con journal DELETE. SQLite arbitra el bloqueo con sus primitivas del sistema operativo. La sala conserva su WAL y los lectores no quedan bloqueados. PID/token/protocolo son diagnósticos; una fila de protocolo nuevo no otorga ni impide autoridad sin obtener antes el bloqueo real. SIGKILL libera el bloqueo del proceso; el siguiente dueño reemplaza la fila obsoleta. No hay heartbeat, expiración ni lock distribuido.

La ruta se canonicaliza para que un enlace simbólico use el mismo guard. Se rechazan enlaces duros del almacenamiento para evitar dominios de bloqueo distintos. Los fallos de escritura revierten admisión y cierran el guard; un fallo al borrar la fila diagnóstica también libera el bloqueo real. La liberación es idempotente.

Para coexistencia con versiones antiguas, una fila sin protocolo nuevo cuyo PID exista o sea incierto bloquea conservadoramente la actualización. Nunca se roba una concesión a un servidor antiguo activo. La reutilización de PID en filas del protocolo nuevo no impide recuperación. La ambigüedad de filas heredadas requiere recuperación offline verificada.

### Sistemas y condiciones soportadas

La implementación usa SQLite/Node y no depende de `/proc`, `flock`, `ps` ni comandos específicos del SO. La ejecución de esta auditoría valida macOS local; no se afirma haber ejecutado Windows o Linux. Los scripts heredados `NODE_ENV=production ...` requieren un shell compatible en Windows. Se necesita la versión de Node con `node:sqlite` utilizada por el proyecto; la sonda de benchmark usa APIs de Node 25.9.0.

El inventario del runtime observó SQLite **3.53.4**, compilado con `THREADSAFE=1`; versión, source ID y opciones completas quedan en [runtime-sqlite.json](benchmarks/final-hardening/runtime-sqlite.json). Este inventario es una lectura del runtime, separada de los resultados de carga.

El almacenamiento debe residir en un sistema de archivos local con locks SQLite correctos. No se admite operar una sala compartida entre hosts, NFS/SMB, reemplazar/renombrar la base o el guard mientras esté abierta, ni mezclar runtimes SQLite incompatibles. Los locks son cooperativos: un administrador con permisos directos para alterar archivos puede romper cualquier contrato de la aplicación. Véanse [bloqueos de SQLite](https://www.sqlite.org/lockingv3.html), [condiciones de corrupción](https://www.sqlite.org/howtocorrupt.html) y [API SQLite de Node](https://nodejs.org/download/release/v25.9.0/docs/api/sqlite.html).

### Recuperación administrativa

1. Detener todas las instancias y administradores, incluidas versiones anteriores. Si no puede demostrarse que todos terminaron, no forzar recuperación.
2. Para una fila del protocolo nuevo, reiniciar normalmente: el sistema operativo decide si el guard está libre. Nunca borrar el guard para superar un bloqueo.
3. Ante una fila heredada ambigua con PID reutilizado, confirmar offline que no queda ningún dueño anterior y respaldar los archivos. Borrar únicamente la fila `storage_lease WHERE id=1 AND protocol IS NULL` mediante SQLite local, sin modificar generaciones, y volver a iniciar. La comprobación humana no puede sustituirse por un timeout. Si no hay certeza, mantener el rechazo.
4. Ante error de permisos, disco o integridad, corregir la causa con todas las instancias detenidas; conservar la base y el guard. No eliminar datos históricos para recuperar acceso.

Las consultas `verify/read/query` de archivos independientes siguen autorizándose con la credencial docente y no adquieren el guard de la sala. Las operaciones sobre almacenamiento activo lo adquieren antes de migrar, compactar, exportar o modificar políticas. Una credencial estudiantil se rechaza antes de esas operaciones.

## Método del ensayo de aula

`npm run bench:classroom -- --duration=1200 --speed=20 --label=<etiqueta-nueva>` crea un directorio temporal y una SQLite aislada. Ejecuta todos los ticks de una generación histórica de 20/25 minutos con el motor y el pipeline real, la cierra y exporta, y prepara otra generación LOBBY de 5.000 personas. La reputación inicial 34 de las cinco empresas es una condición de escenario explícita, anterior al servidor; después no se muta su estado directamente.

Inicia un proceso servidor real y 27 conexiones WebSocket Socket.IO: 25 sesiones con credenciales distintas (backend, security, qa, cto y devops para cada empresa), una docente y una pública sin autenticación. El proyector recibe proyección pública; no se cuenta como usuario autenticado. Todas las acciones y consultas activas pasan HTTP/Socket.IO. Los clientes Node no representan 27 navegadores renderizando CSS.

Cada empresa recorre arquitectura, QA, aprobación, autorización y despliegue, después seguridad. Se ejercitan presupuesto, escalado, balanceador, mantenimiento, suspensión/recuperación de servicio y reinicio. Los rechazos legítimos se registran como tales. Se envían 125 mensajes reales y reintentos idénticos; se comprueba recepción por los cinco compañeros, orden, persistencia, aislamiento y reconexión.

Se conserva trabajo QA pendiente, se fuerza SIGKILL, se reconectan las 27 sesiones y se contrasta el estado persistido. La sala se recupera PAUSED y se reanuda explícitamente. En el tramo tardío, con otra partida activa, dos consultas DVR concurrentes comparan frames completos con consultas independientes sobre la generación cerrada. Se cancelan peticiones, se termina un worker real, se comprueba recuperación y se fuerza el límite por usuario. Los archivos históricos se contrastan antes y después.

La sonda se carga exclusivamente con `--require scripts/audit-classroom-probe.cjs`. Mide cada llamada real a step que avanza el tiempo, intervalos de callbacks, persistencia, event loop, snapshots, workers, heap principal y RSS del proceso. Sus hooks fallan si cambia el punto instrumentado. No se añaden endpoints de diagnóstico ni se guardan credenciales o bases. Los stamps de snapshots son eventos exclusivos del proceso instrumentado. Su coste forma parte de las mediciones.

Los percentiles usan rango más cercano y conservan tamaños muestrales/máximos. Los presupuestos orientativos se informan separados del resultado de integridad. Heap principal, heaps de workers y RSS total tienen campos distintos; los heaps no se suman para inventar RSS. Se guardan series temporales de memoria. El WAL automático se informa por su umbral configurado; no se inventa un recuento exacto de checkpoints internos que SQLite no expone.

## Reproducciones, casos y pruebas nuevas

| Condición de la generación | Archivo | Eliminación | Ejecución comprobada |
| --- | --- | --- | --- |
| FINISHED sin política | Sí | No | Exportación verificada; borrado rechazado |
| ABORTED sin política | Sí | No | Exportación verificada |
| RUNNING | No | No | Exportación rechazada |
| LOBBY | No | No | Exportación rechazada |
| Terminal protegida | Sí | No | Respaldo permitido; borrado rechazado incluso con política |
| Archivada, borrado deshabilitado | Sí | No | Conservación sin borrado |
| Histórica archivada, política habilitada y manifiestos válidos | Sí | Sí | Borrado transaccional comprobado |
| Actual FINISHED | Sí | No | Respaldo permitido; protección por generación actual |
| Histórica sin archivo | Sí | No | Borrado rechazado por falta de archivo verificado |
| Archivo alterado después de exportar | Sí, hacia otro destino | No | Checksum inválido; eliminación rechazada |
| Historial alterado después de exportar | Sí, nuevo respaldo | No hasta verificar de nuevo | Manifiestos distintos; eliminación rechazada |
| Cierre sin fecha válida | No | No | Vista previa y exportación rechazan el cierre |

Se añadieron **seis pruebas automatizadas**, repartidas entre `final-retention`, `final-storage-lease`, `final-broadcast` y `final-startup`. Incluyen múltiples aserciones: PID reutilizado, propietario vivo detenido con SIGSTOP, procesos independientes, SIGTERM/SIGKILL, enlaces simbólicos/duros, fallos al admitir/liberar, primer arranque concurrente, credencial docente utilizable, ráfagas con evidencia durable y proyección privada final. Las 226 pruebas anteriores se preservan sin editar sus archivos ni expectativas. `npm test` volvió a ejecutar **232 pruebas, 232 aprobadas, cero fallos**; `npm run build` pasó y conserva la advertencia existente de Vite por el chunk de 526,79 kB.

La prueba de bloqueo y el benchmark comprueban segundo servidor rechazado, mantenimiento rechazado con sala activa, recuperación del guard obsoleto, ausencia de concesión activa después del cierre y lectura/consulta de archivos independientes con autorización. Los fallos de escritura se inyectan mediante triggers SQLite sobre bases temporales; no se presentan como simulación de una avería física del disco. Las generaciones históricas se comparan completas contra sus manifiestos iniciales, incluidos recibos, rutas, comandos y checkpoints.

## Resultados definitivos de las 27 conexiones

Código medido: `346265103b55b9b6117efa42ce9b4b6bccc956c7`. Las ejecuciones definitivas conservan `sourceDirty: ""`, lista de fuentes y SHA-256. El código de producción medido permanece igual en la batería posterior; los commits siguientes agregan evidencia e informes. Las etiquetas de archivo `certified` identifican esta serie; **`result: passed` significa que pasaron las aserciones de integridad, no que todos los presupuestos de latencia se cumplieran**. Esos presupuestos aparecen por separado, con valores false cuando corresponde.

Entorno: Apple M5, 10 núcleos, 16 GiB de RAM, Node v25.9.0 y macOS Darwin según cada JSON. `os.freemem()` antes de preparar cada ensayo fue 0,23 / 2,19 / 2,61 GiB; esa cifra no incluye toda la memoria recuperable del sistema. El equipo no estuvo reservado exclusivamente a estas pruebas. No se registró una serie de presión/swap del host y no se atribuye a ella una degradación que no se haya demostrado. Los benchmarks de esta auditoría se ejecutan secuencialmente, sin superponer las baterías de carga.

| Ensayo | Tiempo simulado activo | Tiempo real activo | Tiempo real total, incluida preparación | Sesiones / conexiones | Resultado de integridad |
| --- | ---: | ---: | ---: | --- | --- |
| 20 min a 20× | 1.200 s | 79,09 s | 131,76 s | 26 / 27 | Aprobado |
| 25 min a 20× | 1.500 s | 93,17 s | 158,44 s | 26 / 27 | Aprobado |
| 20 min a 1× | 1.200 s | 1.226,26 s | 1.281,74 s | 26 / 27 | Aprobado |

El tiempo activo incluye el calentamiento inicial a 1×, comandos, reconexión y reinicio. No representa ejecución continua exacta a una sola velocidad durante cada milisegundo. La velocidad principal está identificada y cada cambio pasa por un comando real. La ejecución a 1× transcurrió durante más de veinte minutos reales. No hubo estudiantes humanos ni una prueba real de veinticinco minutos a 1×.

Todos recibieron LOBBY coherente, población inicial de 5.000 y 1.000 clientes por empresa, inicio y tráfico real. Las identidades coincidieron con su login. Las cinco empresas recorrieron los pipelines de arquitectura y seguridad, escalaron a ocho servidores mediante presupuesto autorizado y probaron mantenimiento y recuperación. Cada partida terminó naturalmente en su duración prevista, con población consistente y solicitudes terminales liquidadas. No se redujo población, tráfico ni precisión forense.

### Motor y Socket.IO

La tabla utiliza la fase posterior al reinicio, la más larga y donde se ejecuta el DVR. Las distribuciones completas de ambas fases, máximos y tamaños muestrales están en [classroom-summary.json](benchmarks/final-hardening/classroom-summary.json). Los valores triples son p50 / p95 / p99 en milisegundos.

| Métrica | 20 min, 20× | 25 min, 20× | 20 min, 1× |
| --- | ---: | ---: | ---: |
| Tick individual | 1,34 / 3,25 / 4,31 | 1,31 / 3,21 / 4,18 | 2,31 / 7,23 / 9,11 |
| Callback, incluidos ticks y trabajo periódico | 41,04 / 115,30 / 177,95 | 42,36 / 113,64 / 166,27 | 12,16 / 66,75 / 74,98 |
| Intervalo del motor | 101,11 / 149,81 / 222,69 | 101,24 / 144,78 / 216,83 | 101,04 / 103,03 / 125,95 |
| Event loop | 12,03 / 77,73 / 145,10 | 12,03 / 76,41 / **153,35** | 11,37 / 47,97 / 72,61 |
| Persistencia transaccional | 36,27 / 88,78 / 99,46 | 40,08 / 88,79 / 99,21 | 22,07 / 28,92 / 34,32 |
| ACK de comandos sin chat, ensayo completo | 29,81 / 93,32 / 161,09 | 29,48 / 122,11 / 158,41 | 35,15 / 62,42 / 82,04 |
| ACK incluyendo chat y reintentos | 85,01 / **360,13** / 393,70 | 83,92 / **355,12** / 389,34 | 39,51 / **294,40** / 352,46 |
| Entrega de snapshot desde emisión instrumentada | 14,46 / 67,43 / 112,02 | 15,15 / 70,45 / 110,53 | 23,75 / 51,83 / 62,84 |

Los máximos de event loop en la fase larga fueron 286,52 / 302,51 / 177,47 ms; los de ACK global, 412,55 / 418,32 / 375,62 ms. La primera fase con ráfagas registró máximos de event loop de 392,43 / 395,84 / 366,74 ms. No se ocultan estas pausas porque su frecuencia sea inferior al 1 %.

Los intervalos medios posteriores al reinicio fueron 107,12 / 106,84 / 101,95 ms frente a los 100 nominales: desviación +7,12 % / +6,84 % / +1,95 %. Los contadores de ticks medidos por fase se guardan separados; una terminación SIGKILL puede dejar fuera la cola del último muestreo, indicada explícitamente. El tiempo final persistido se comprueba independientemente como 12.000 / 15.000 / 12.000 avances de 0,1 s de la generación activa.

Snapshots recibidos: 15.912 / 18.365 / 183.312; máximo de tamaño: 183.056 / 183.182 / 181.895 bytes. Cadencia p95: 258,73 / 258,55 / 225,36 ms. Máximo de conexiones observado en servidor: 27 en cada ensayo. Hubo cero timeouts de ACK. Las 55 desconexiones por ensayo son programadas: una reconexión de estudiante, desconexión de los 27 clientes antes del SIGKILL y cierre de los 27 al terminar. Se realizan 28 reconexiones explícitas con las mismas cookies, incluida la individual anterior al reinicio. Esto prueba conservación de sesiones; no se presenta como medición del backoff automático del navegador ante pérdida de red.

La sonda del servidor también contó **1,41 / 1,67 / 22,82 GiB de JSON de snapshots** en sus ventanas observadas: 126,56 / 126,21 / 157,44 Mbit/s lógicos de media. El cociente usa los 95,79 / 113,94 / 1.245,25 segundos observados de ambos procesos, incluidos LOBBY/pausa y cierre; no el tiempo simulado ni exclusivamente el activo. Los contadores de emisiones del servidor pueden superar los recibidos por clientes durante la desconexión programada, y el último tramo SIGKILL conserva la limitación de muestreo declarada. Son bytes antes de codificación de transporte: no una captura de red, no incorporan retransmisiones/cabeceras y no determinan por sí solos el enlace físico necesario. El volumen es una razón concreta para mantener pendiente la validación de LAN/Wi-Fi; loopback no demuestra esa capacidad. `classroom-summary.json.network` conserva la fórmula y sus denominadores, sin modificar mediciones originales.

### FlowSlack y aislamiento

Cada ensayo envió **125 mensajes originales** y 125 reintentos idénticos, además de dos reintentos de recuperación/reconexión. Se verificaron **625 entregas autorizadas**: cada mensaje llegó a los cinco estudiantes de su empresa. Los snapshots repetidos son redistribuciones del estado, no mensajes duplicados. Las consultas HTTP y las filas SQLite verificaron orden, unicidad, empresa, persistencia tras SIGKILL y cero pérdida de mensajes confirmados. El chat sigue siendo comunicación y evidencia; la prueba de ráfagas verifica sus hechos `communication.accepted`, sin convertir texto en acciones del motor.

| Métrica de chat, ms | 20 min, 20× | 25 min, 20× | 20 min, 1× |
| --- | ---: | ---: | ---: |
| ACK p50 / p95 / p99 | 202,31 / 375,81 / 403,10 | 191,56 / 372,01 / 400,98 | 181,17 / 346,00 / 368,89 |
| Entrega p50 / p95 / p99 | 414,49 / 426,97 / 427,94 | 400,95 / 431,91 / 432,90 | 378,73 / 386,53 / 387,36 |
| Filtraciones / duplicados aplicados / pérdidas confirmadas | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |

La carga incluye ráfagas de **25 emisores simultáneos**; no es equivalente al chat secuencial anterior de 125 mensajes. El presupuesto global de ACK p95 <150 ms no se cumple al incluir estas ráfagas, aunque sí se cumple para comandos sin chat. Ambos datos se conservan para evitar una selección favorable de muestras.

### DVR concurrente, cancelación y recuperación

Se preparó una generación histórica completa antes de empezar otra. En cada ensayo, las dos consultas concurrentes recorrieron puntos distintos y compararon **24 frames completos exactos** contra consultas independientes: 72 en total, además de la batería histórica de 176 reconstrucciones. Se consultaron métricas, evidencia de solicitudes propias y conversaciones históricas que contienen mensajes humanos reales. Las consultas entre empresas y sin sesión se rechazaron.

| Frame HTTP completo, ms | 20 min, 20× | 25 min, 20× | 20 min, 1× |
| --- | ---: | ---: | ---: |
| p50 / p95 / p99 | 222,99 / 1.212,67 / 1.222,03 | 229,59 / 1.244,49 / 1.278,32 | 206,07 / 1.113,46 / 1.116,29 |

El tiempo HTTP incluye admisión, cola, reconstrucción, proyección, serialización y red local. `workerTaskMs` mide el trabajo del worker con esos componentes internos, no únicamente CPU de `reconstruct`; las reconstrucciones puras también quedan medidas por caso en la batería Entrega 5.

Máximos: dos workers, dos trabajos ejecutándose y ocho en cola. Se terminaron workers reales desde la sonda, sin un endpoint de fallo expuesto. Cada ensayo registró un fallo inyectado con respuesta honesta 503 y consultas exactas posteriores en el reemplazo. Hubo ocho intentos de cancelación por ensayo; los abortos observados fueron **7 / 8 / 8**: en el primer ensayo una petición terminó antes del aborto. Se verificó un rechazo 429 por límite por usuario y tres rechazos 503 por saturación de la cola en cada ejecución. Esos fallos esperados se distinguen de errores operativos y no se cuentan como reconstrucciones exitosas.

La partida activa continuó atendiendo tráfico, comandos y snapshots. No se aumentaron los workers, se cachearon estados históricos ni se compartió la partida mutable con ellos. Los manifiestos completos de la generación cerrada coincidieron después del ensayo.

### Crisis y fallo del servidor

Las cinco empresas registraron entrada en crisis y hubo recuperación real posterior al pipeline y al escalado autorizado. El ensayo invocó 50.000 veces la función visual pura en 32,83 / 33,70 / 33,66 ms y comprobó estado económico idéntico antes/después. La sirena y los documentos progresivos se calculan en el cliente; esta medición y las pruebas SSR/CSS de regresión no sustituyen un perfil de FPS de 27 navegadores.

Cada ensayo confirmó un módulo y una conversación, dejó una prueba QA pendiente y terminó el servidor con SIGKILL. La reapertura recuperó PAUSED, misma generación y exactamente el mercado/cambios del último estado durable leído **después del cierre**, no de un snapshot cliente anterior. Se reintentaron el módulo y el mensaje con sus mismos IDs sin duplicarlos. La prueba pendiente sobrevivió y terminó al reanudar. La revisión completa de manifiestos confirmó que no se modificó la generación histórica. Se conserva la ventana contractual de trabajo no confirmado o ticks no persistidos desde el último COMMIT; no se afirma durabilidad de memoria volátil.

## Investigación y corrección mínima de rendimiento

Una comparación con el mismo observador y parámetros contrapone `5d6fa41d65dd2ce94f2bc77fd360ce6447ad5dbe` y `cabf26b2218b1c401c99450feec4c50ef0dd94fc`. Antes, cada comando confirmado volvía a construir/serializar 27 snapshots. La sonda midió p95 del manejador de 28,80 ms y del broadcast de 11,56 ms; durante la ráfaga se repetía ese trabajo por cada mensaje.

La corrección usa un único `setImmediate` pendiente para notificar el último estado confirmado. Cada comando conserva validación, clon para rollback, transacción, ACK y evidencia. Las emisiones periódicas y la proyección por sesión permanecen; el cierre cancela la notificación pendiente. No se descartan mensajes, hechos, inputs, checkpoints ni recibos.

| Comparación local, ms | Antes | Después |
| --- | ---: | ---: |
| ACK global p50 / p95 / p99 / máximo | 112,12 / 580,72 / 633,22 / 668,70 | 83,66 / 361,82 / 396,15 / 412,51 |
| ACK chat p50 / p95 / p99 / máximo | 302,91 / 606,19 / 642,12 / 668,70 | 197,87 / 379,57 / 405,85 / 412,51 |
| Entrega chat p50 / p95 / p99 / máximo | 338,00 / 630,94 / 673,81 / 685,04 | **416,59** / 425,77 / 426,69 / 426,91 |
| Manejador de comando p50 / p95 | 22,30 / 28,80 | 14,11 / 18,71 |
| Event loop p99, fase larga | 126,94 | **138,41** |

La mejora medida está en las colas y extremos de las ráfagas; la mediana de entrega de chat **empeoró**, porque los mensajes tempranos esperan al estado agregado de la ráfaga. El event loop p99 de la fase larga tampoco mejoró en esa pareja. No se afirma una mejora universal ni de memoria. Son observaciones secuenciales locales y no una campaña estadística de múltiples equipos.

La carga residual está en trabajo síncrono real: en 25 min a 20×, veinte pasos por callback consumen unos 29,62 ms de media; el callback completo promedia 49,88 ms y la persistencia alcanza 88,79 ms p95. Al coincidir ticks, notificación y persistencia pueden superar un intervalo nominal de 100 ms. En la ráfaga, 25 comandos necesitan transacciones individuales; serialización y escritura durable acumulan espera. Reducir esos costos mediante cambios de contratos transaccionales sería otra intervención, no un resultado probado aquí. No se sustituyó la durabilidad por ACK anticipado ni se alteró el motor para cumplir una cifra.

La referencia anterior de tres conexiones (event loop p99 ≈110 ms, ACK p95 ≈113 ms y RSS ≈803 MiB) queda como contexto. No es un control equivalente para afirmar mejora o regresión porcentual de esta nueva aula de 27 conexiones con otras acciones, ráfagas y saturación deliberada.

## Memoria y almacenamiento

Picos muestreados cada 20 ms; series del hilo principal y heaps de workers cada segundo. RSS corresponde al proceso completo y los heaps de workers no son RSS individuales ni se suman para calcularla.

| Medición máxima | 20 min, 20× | 25 min, 20× | 20 min, 1× |
| --- | ---: | ---: | ---: |
| Heap principal, MiB | 185,78 | 159,78 | 150,04 |
| RSS total, MiB | 936,27 | 976,78 | 744,06 |
| Heap usado de un worker observado, MiB | 100,92 | 109,00 | 90,69 |
| SQLite después de checkpoint, MiB | 843,89 | 1.052,64 | 845,40 |
| WAL antes de checkpoint, MiB | 95,65 | 84,10 | 61,16 |
| Archivo independiente adicional, MiB | 408,79 | 511,00 | 408,79 |
| Páginas libres de 4 KiB | 1.139 | 1.138 | 1.196 |

Los archivos SQLite contienen dos generaciones completas. Después del checkpoint explícito, WAL fue cero y `integrity_check` fue `ok` en los tres casos. El umbral automático fue 1.000 páginas; el número exacto de checkpoints automáticos no se instrumentó y se informa como desconocido. Las escrituras de la sonda son filas SQL afectadas y COMMIT observados, no llamadas físicas al dispositivo. Los índices/páginas físicas globales, recibos por generación y payloads de cada tabla están en los JSON.

| Ensayo y generación | Recibos conservados | Payload de recibos, MiB | Otros payloads históricos, MiB |
| --- | ---: | ---: | ---: |
| 20 min 20×, histórica | 227.130 | 229,95 | 97,15 |
| 20 min 20×, activa cerrada | 227.130 | 229,97 | 97,97 |
| 25 min 20×, histórica | 283.910 | 288,16 | 121,59 |
| 25 min 20×, activa cerrada | 283.910 | 288,19 | 122,53 |
| 20 min 1×, histórica | 227.130 | 229,95 | 97,15 |
| 20 min 1×, activa cerrada | 227.130 | 229,98 | 98,79 |

Los payloads son bytes lógicos UTF-8/BLOB, no ocupación física exclusiva por generación: SQLite comparte páginas e índices. El archivo independiente proporciona además una medida física de la generación histórica aislada. No se ejecutó VACUUM ni borrado para favorecer estas cifras.

En el ensayo 1×, antes de iniciar workers en la fase larga, RSS pasó de una media del primer decil de 230,06 a 510,76 MiB; la pendiente observada fue +21,08 MiB/min durante 14,64 min. El heap principal creció +1,54 MiB/min en esa ventana. Después de introducir DVR, RSS alcanzó 744,06 MiB y la media del último decil de esa fase bajó de 670,60 a 484,16 MiB. Estos datos muestran crecimiento y liberación posterior; **no demuestran ausencia de fuga ni un techo estable para ensayos de varias horas**. No se atribuye el RSS restante a una biblioteca concreta sin un perfil nativo. Las pendientes aceleradas no se extrapolan como consumo por minuto real de una clase a 1×.

## Seguridad, permisos y regresiones

Las seis pruebas nuevas y las 226 previas cubren autenticación, sesiones, expulsiones, permisos por rol, idempotencia, recibos, reinicios, proyecciones y DVR. En el aula se comprobó que los 25 estudiantes conservan identidades propias; el proyector no puede comandar; un estudiante no puede resetear, acceder a credenciales, leer recibos/DVR ajenos, verificar archivos ni eliminar generaciones. El docente sí puede leer/consultar archivos independientes con la sala activa, pero no ejecutar mantenimiento incompatible. No se sirvieron `access.json` ni SQLite por HTTP.

La sonda comprueba ausencia de campos internos reservados en proyecciones estudiantiles, recibos, métricas y evidencia autorizada. Las exportaciones contienen evidencia privada y solo se ejercitan con la credencial docente. Cookies, códigos, archivos de acceso y SQLite temporales se eliminan y no forman parte de la evidencia publicada. No se agregan claves, dependencias, IA, servicios externos ni infraestructura distribuida.

| Superficie revisada | Comprobación y evidencia |
| --- | --- |
| Login e identidad | 26 credenciales distintas, identidades coincidentes y 27 sockets reales; escenario A de cada JSON de aula |
| Sesiones y reinicio | Cookies existentes recuperan sus sesiones tras SIGKILL; escenarios C/G y tests `scenario-server`, `audit-server` |
| Roles y comandos | Proyector y estudiante rechazan comandos docentes; QA y despliegue requieren su rol/empresa; tests `server`, `action-server`, `actions-contract` |
| Recibos y diagnósticos | Sin sesión 403, empresa ajena 404, proyección propia filtrada y diagnóstico docente diferenciado; test `audit-server` y sección `security` de aula |
| DVR histórico | Sin sesión/empresa ajena 403, evidencia propia filtrada, respuestas de error públicas limitadas; tests `dvr-server`, `audit-server`, `audit-dvr-client` y escenario E |
| Archivo y administración | Código estudiantil denegado; docente puede leer archivo independiente, pero el guard impide administrar la sala activa; tests `audit-retention`, `final-storage-lease` y escenario A |
| Idempotencia y persistencia | Reintentos idénticos conservan una sola aplicación incluso después del reinicio; pruebas `audit-server`, `final-broadcast` y escenario G |
| Archivos y publicación | `access.json`/SQLite no se sirven por HTTP; revisión de evidencia sin cookies, claves privadas ni tokens; bases temporales excluidas |

La revisión de código conserva tokens aleatorios de sesión almacenados como hash, expiración de doce horas y cookies HttpOnly/SameSite Strict. El ensayo valida conservación de sesiones y autorización; no constituye una campaña de fuzzing de autenticación ni una validación de TLS en la red del aula.

La primera reproducción fallida del benchmark solicitaba aprobar QA antes de recibir su prueba terminada; se corrigió la espera y se conservó el rechazo. Un arranque de desarrollo se interrumpió antes de medir para corregir el campo de orden de mensajes. Otro piloto quebró legítimamente todas las empresas en 932,1 s con cuatro servidores; no se presenta como partida completa. Se cambió a decisiones autorizadas de presupuesto y ocho servidores, el perfil de recuperación existente. Otro intento comparaba recuperación con una lectura anterior a un segundo de progreso legítimo mientras se vaciaba telemetría; ahora la comparación usa el último estado durable tras SIGKILL. Se conservaron los intentos fallidos, builds de desarrollo y `tests-development-interrupted.txt`, que carece de resultado final aprobado.

También se corrigieron errores de tipado del propio harness detectados por build antes de las mediciones definitivas. No se modificaron pruebas heredadas ni resultados históricos para ocultarlos.

## Archivos y reproducción independiente

Cambios de producción: `server/history-admin.ts`, `server/storage-lease.ts` y `server/index.ts`. Motor económico, fórmulas, mercado, tráfico, incidentes, artefactos, persistencia forense, workers y frontend permanecen sin editar. Las seis pruebas nuevas residen en cuatro archivos `tests/final-*.test.ts`. `package.json` solo agrega el comando `bench:classroom`, sin dependencias nuevas.

Infraestructura de auditoría: `scripts/audit-classroom-load.ts`, `audit-classroom-probe.cjs`, `audit-final-classroom.mjs`, `audit-final-regressions.mjs`, `audit-final-compare.mjs`, `audit-final-report.mjs` y `audit-final-verify.mjs`. Documentación y evidencia: este documento, README y `docs/benchmarks/final-hardening/`.

```sh
# Ensayo individual. Usar etiqueta nueva: nunca sobrescribe una medición previa.
npm run bench:classroom -- --duration=1200 --speed=20 --label=auditoria-independiente-20x
npm run bench:classroom -- --duration=1500 --speed=20 --label=auditoria-independiente-25min
npm run bench:classroom -- --duration=1200 --speed=1 --label=auditoria-independiente-1x

# Los mismos comandos de regresión exigidos, en secuencia y sin filtros parciales.
node scripts/audit-final-regressions.mjs
node scripts/audit-final-compare.mjs
node scripts/audit-final-report.mjs
# Verificación posterior sin regenerar datos:
node scripts/audit-final-verify.mjs
```

Los resultados comprimidos de regresión son JSON gzip sin pérdida; `regression-runs.json` identifica SHA, fecha UTC, Node, SO, CPU, RAM, workers, comando, parámetros, duración real, alcance simulado, conexiones cuando aplica y código de salida. El SHA-256 de la representación original y comprimida se conserva por archivo. Las salidas originales se guardan como TXT. `economic-regression.json`, `classroom-summary.json`, `final-verification.json` y `evidence-manifest.json` permiten comprobar los dictámenes. El manifiesto de evidencia excluye su propio archivo para evitar autorreferencia. `optional-reference-provenance.json` identifica la referencia local previa que el benchmark de mercado incorpora opcionalmente; no fue medida de nuevo ni se usa para afirmar mejoras. El hardware/RAM de `regression-runs.json` corresponde al inicio de cada segmento de la batería; `startedAt` identifica el comienzo de cada comando. `base-provenance.json` verifica origen, ausencia de merges y main antes de publicar.

La batería se interrumpió después de completar tests, build y tráfico, durante acciones. Se comprobó que no quedaba otro benchmark ejecutándose, se conservó la salida parcial de acciones como `actions-interrupted-*.txt` con estado sin código de salida y se repitió ese comando completo. `--resume` verifica SHA y hashes de resultados terminados antes de conservarlos; nunca convierte un log parcial en aprobado. La reanudación registra por separado las fuentes efectivamente medidas, los cambios del coordinador/informes y el digest del coordinador. El servidor, los tests y los programas originales de benchmark siguieron idénticos al SHA medido. Para repetir toda la batería, utilice una copia independiente y una carpeta nueva de evidencia; el coordinador rechaza sobrescribir logs existentes.

## Límites y dictamen

Los dos problemas residuales están corregidos y cuentan con reproducción, pruebas y commits individuales. Las tres partidas de aula completaron su duración prevista con 27 conexiones, sin filtración ni pérdida confirmada, y conservaron los manifiestos históricos. Esto valida funcionamiento e integridad en el entorno local medido.

El cierre de rendimiento es **condicionado**, no una aprobación sin reservas: las ráfagas simultáneas de chat no cumplen ACK global p95 <150 ms; la prueba de 25 min a 20× registró event loop p99 de 153,35 ms, ligeramente por encima de 150. A 1×, event loop, cadencia y comandos sin chat quedaron dentro de los presupuestos, con los picos documentados. No se afirma que estos límites se cumplan en todos los equipos, navegadores o redes escolares.

Quedan abiertos el consumo creciente de RSS/almacenamiento, un perfil nativo para atribuir memoria, ensayos de varias horas y pruebas de LAN/FPS con navegadores reales; el volumen lógico de snapshots medido requiere atención particular a la red. Windows y Linux no fueron ejecutados; no se simularon corte de energía, fallo físico del disco, robo de credenciales ni acceso hostil al sistema de archivos local. El límite existente de login por IP permanece: el benchmark utiliza 26 logins iniciales y reutiliza sesiones al reiniciar. No se debilitó para facilitar la prueba.

Una auditoría independiente externa sigue pendiente; esta rama aporta código, datos y procedimientos verificables para realizarla. El resultado aprobado de integridad no sustituye las excepciones de rendimiento ni las limitaciones anteriores.

## Cierre de la batería de regresión

Los siete comandos completos finalizaron con código **0** sobre `f2895e462c60a6a0e5c4b7cde5998ccbb18e8245`. No se usaron filtros para reducir casos ni duraciones. El código de producción coincide con el de los tres ensayos definitivos de aula.

| Comando | Tiempo real | Salida | Registro |
| --- | ---: | ---: | --- |
| `npm test` | 53,136 s | 0 | [tests.txt](benchmarks/final-hardening/tests.txt) |
| `npm run build` | 2,187 s | 0 | [build.txt](benchmarks/final-hardening/build.txt) |
| `npm run bench:traffic` | 703,983 s | 0 | [traffic.txt](benchmarks/final-hardening/traffic.txt) |
| `npm run bench:actions` | 436,461 s | 0 | [actions.txt](benchmarks/final-hardening/actions.txt) |
| `npm run bench:connections` | 8,454 s | 0 | [connections.txt](benchmarks/final-hardening/connections.txt) |
| `npm run bench:chat` | 12,614 s | 0 | [chat.txt](benchmarks/final-hardening/chat.txt) |
| `npm run bench:entrega5` | 647,275 s | 0 | [entrega5.txt](benchmarks/final-hardening/entrega5.txt) |

Se comprobaron de nuevo **232 tests aprobados, cero fallos**, preservando los 226 anteriores. Tráfico/mercado recorrieron 24 casos; acciones, 16 escenarios y dos controles. Entrega 5 completó **22 casos** de 1.200/1.500 segundos simulados y **176 reconstrucciones exactas**, cuyos hashes coincidieron literalmente con los publicados. Los estados económicos finales, evidencia forense y muestras comparables también coincidieron. Las 72 comparaciones de frames completos durante partidas activas de aula constituyen evidencia adicional.

Los **42 casos heredados** comparables (seis de tráfico, dieciocho de mercado y dieciocho de acciones) conservaron resultados económicos, muestras y causas. [economic-regression.json](benchmarks/final-hardening/economic-regression.json) documenta campos comparados y exclusiones: tiempos, memoria/tamaños, digest de mercado que incorpora `receivedAt` de reloj real y referencia local opcional. No se normalizó ni excluyó ningún hash de las 176 reconstrucciones.

El benchmark corto de conexiones observó 27 sockets, 1.701 snapshots y ACK p95 de 58,45 ms, máximo 86,84 ms. El chat heredado verificó 125 mensajes y 125 entregas observadas por un receptor de cada empresa, sin duplicación ni cruce, con ACK p95 15,17 ms y entrega p95 16,62 ms. Su envío es secuencial y la sala está pausada: no sustituye las ráfagas concurrentes ni las 625 entregas comprobadas en cada ensayo largo de aula.

[final-verification.json](benchmarks/final-hardening/final-verification.json) reúne los resultados y mantiene explícitas las excepciones de latencia. [evidence-manifest.json](benchmarks/final-hardening/evidence-manifest.json) permite verificar tamaño y SHA-256 de cada archivo de evidencia. La validación se realiza con `node scripts/audit-final-verify.mjs`, sin reescribir resultados. Los commits posteriores al código medido incorporan exclusivamente herramientas de cierre, documentación y evidencia; no cambian la simulación validada.
