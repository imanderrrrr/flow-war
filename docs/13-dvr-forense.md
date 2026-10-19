# DVR forense de FLOW WAR

## Fuente de verdad

El DVR reconstruye el mismo motor en una copia aislada. No reproduce un video ni interpola población. Precisión: **100 ms**. Nunca llama al despachador de producción ni modifica su partida.

`flow-observability-5.1` registra hechos confirmados con ID secuencial global por generación, tick, empresa, clase, referencias y datos compactos. Un comando humano conserva su instante real de recepción; no cambia retroactivamente el orden del motor. Semilla, reglas y versiones quedan congeladas en checkpoints. El contrato debe versionarse al cambiar la semántica de replay; una versión desconocida falla explícitamente.

Los inputs ordenados incluyen identidad autenticada, comando, tick y hora real. Replay utiliza el mismo validador, permisos, intérprete de solicitudes, mercado y despachador. Los efectos comerciales no se reaplican en la sala original. Las proyecciones muestran arquitectura, infraestructura, versiones productivas, capital, clientes, reputación, mantenimiento y documentos del estado reconstruido.

## Tablas SQLite y retención

| Tabla | Contenido |
| --- | --- |
| `game` | Último estado autoritativo recuperable, esquema 6 |
| `request_receipts` | Recibos detallados heredados, una fila por solicitud terminal de tráfico |
| `commands` | Recibos idempotentes del transporte autenticado |
| `history_games` | Generación, cobertura, tick final, duración, estado y contrato |
| `history_inputs` | Comandos en orden global, sin copia de GameState por comando |
| `history_events` | Liquidaciones, transferencias, decisiones y observaciones compactas |
| `history_checkpoints` | Snapshot comprimido con deflate y verificado con SHA-256 |
| `history_points` | Proyección para gráficas cada cinco segundos y al finalizar |
| `slack_messages` | Historial íntegro paginable por generación/empresa/canal |

Hay checkpoint inicial, cada **60 segundos simulados**, al finalizar/restablecer y al recuperar el servidor. No se almacena un estado completo por tick ni acontecimiento. Rutas y paquetes de ejecución se serializan una vez por release en el checkpoint. El navegador recibe proyecciones, no los 5,000 individuos.

Se retiene la partida completa y se conservan generaciones finalizadas después de restablecer. No se eliminan automáticamente historiales ni se suben SQLite/journals a Git. Los ensayos usan carpetas temporales y conservan informes resumidos. No se introduce Kafka, Redis ni otra dependencia distribuida.

Cada COMMIT incorpora recibos, estado, deduplicación, inputs, hechos, puntos, checkpoints y chat. Los buffers se limpian después de confirmar; rollback conserva los hechos previos no escritos. La recuperación durable llega al último COMMIT: normalmente un segundo real, hasta 20 segundos simulados a 20×. No se promete recuperar ticks que no llegaron a persistirse.

## Reconstrucción

1. Validar sesión, generación finalizada, empresa y tiempo dentro del intervalo capturado.
2. Elegir el último checkpoint con tick ≤ destino; en empates, mayor secuencia. Verificar digest y contrato.
3. Recuperarlo en memoria aislada y restaurar su estado de reloj. Producción sigue recuperando RUNNING como PAUSED.
4. Leer inputs posteriores hasta el destino por secuencia. Avanzar el motor y aplicar cada input en su punto original, con su hora real para cuotas/idempotencia del chat.
5. Avanzar hasta el destino y proyectar el estado obtenido. Un reloj imposible, checkpoint faltante o versión desconocida produce error, sin rellenar intervalos.

Outputs registrados permiten trazabilidad y contraste. El motor reconstruye estados intermedios mediante inputs y semilla. Se silencia la grabación en esa copia para no crear un journal recursivo, manteniendo las transiciones derivadas y su orden.

## Causalidad

La liquidación conserva solicitud, cliente, empresa, versión congelada, resultado, activaciones y módulos. Inspeccionar una solicitud enlaza artefactos de su release con `changeId`, reportes QA y decisiones auditadas. Una revisión no publicada no aparece en producción. Solicitudes previas al despliegue mantienen su versión anterior.

`Artefacto → Cambio → QA → Autorización → Despliegue → Release → Solicitud → Activación → Resultado` utiliza referencias directas. Transferencias se registran después de confirmar; reclamaciones llevan el hecho de respaldo. No se atribuye una migración o caída global a un bug por cercanía temporal. La ausencia de evidencia queda explícita.

La comunicación humana conserva su fuente: decir “reinicié” no demuestra un reinicio. El hecho operativo confirmado tiene registro propio. Los mensajes de mantenimiento derivan de transiciones aceptadas; reclamaciones de indisponibilidad derivan de solicitudes rechazadas.

## Acceso y privacidad

- Docente autenticado: todas las empresas y evidencia interna tras finalizar.
- Estudiante autenticado: su empresa, arquitectura, conversaciones y proyecciones permitidas; las consultas de solicitudes omiten paquetes internos de defectos.
- Proyector/anónimo: sin acceso al DVR ni conversaciones privadas.
- Partida activa: ningún endpoint DVR entrega historial interno, incluso al Docente.

`/api/dvr/games` enumera generaciones finalizadas. `/api/dvr/:generation` acepta empresa/tick; `/requests/:id` inspecciona evidencia; `/metrics` calcula el post-mortem; `/chat` pagina comunicaciones hasta un tick autorizado. Cada operación valida y filtra en el servidor. Respuestas `Cache-Control: no-store`.

Modificar companyId o ID no concede acceso ajeno. Mensajes en vivo se consultan y emiten por empresa. Restablecer cambia la generación y reinicia ventana e indicadores. Snapshots ordinarios y recibos visibles eliminan activaciones, precio contractual interno y descomposición secreta de costos.

## Compatibilidad anterior

Entregas 1–4A no tienen inputs completos. La migración a esquema 6 comienza cobertura en el tick recuperado y archiva el snapshot original. Antes se indica intervalo no reconstruible. Una partida antigua finalizada conserva su estado final; no se promete replay de minutos no registrados.

Las salas nuevas capturan desde su condición inicial. Fixtures declaran reputación o arquitectura inicial y capturan ese estado antes de avanzar. Esas condiciones no se presentan como decisiones durante la partida.

## Métricas

`forensics-1` describe hechos sin calificaciones académicas:

- Incidente desde el primer fallo legítimo terminal, excluidas cancelaciones administrativas. Detección por telemetría. Mantenimiento es mitigación, nunca reparación.
- Recuperación requiere dos muestras sin errores ni indisponibilidad, separadas ≥10 segundos y con ≥5 resultados cada una. MTTR hasta esa confirmación. Sin recuperación: `null`, no cero. Corrección definitiva indeterminada si falta evidencia.
- Costo demostrado: diferencia precio contractual/cobrado con D02; compensación Q8 por duplicado con D03; compensación Q8 por sobreventa con D01. Se registra junto al resultado sin cambiar el ledger ni contar varias veces una solicitud por códigos conjuntos.
- Deltas negativos con activación se separan del costo demostrado: un descuento autorizado puede producir margen negativo sin que todo sea culpa del bug. Ingreso potencial no realizado no recibe causa única.
- Pipeline: cambios probados, aprobaciones, autorizaciones, rechazos, publicaciones, suites y artefactos defectuosos con pruebas que observaron diferencias. Verde no significa cobertura total.
- CTO: asignación inicial, presupuesto adicional, saldo operativo, reservas, publicaciones, servidores, gasto operativo conciliado desde el checkpoint inicial, capacidad web y utilización observada de la última ventana. Las versiones de artefactos con activaciones permiten contar defectos escapados. No se inventa CPU ni evaluación estratégica.

## Interfaz

Selector de generación/empresa, scrubber de 100 ms, reproducción/pausa a 1×/5×/20×, ±10 segundos y marcadores. Transferencias se agrupan por diez segundos para evitar miles de botones. Gráficas de clientes, reputación y capital usan muestras históricas; las tarjetas del momento usan reconstrucción exacta. Marcadores no sustituyen evidencia detallada.

Arquitectura, servidores, versiones y documentos corresponden al tiempo seleccionado. Chat histórico tiene paginación. Métricas post-mortem corresponden a la partida completa. [Captura del DVR al minuto uno](images/entrega-5-dvr.jpg) y [arquitectura histórica](images/entrega-5-dvr-arquitectura.jpg).

## Validación y costos

`npm run bench:entrega5` ejecuta escenarios A–H y J–L durante 20/25 minutos. I se ensaya con `npm run bench:chat`: 25 jugadores, Docente y proyector. Se contrastan hashes de empresas completas, mercado individual, cambios, acciones y chat en ocho puntos, cerrando/reabriendo SQLite antes de reconstruir. Se comprueban población y conciliación económica.

El [informe](benchmarks/entrega-5-informe.md) registra p50/p95/p99 de tick/persistencia, memoria, disco, journal, eventos, snapshots, chat y búsquedas. Las fuentes tienen manifiesto SHA-256 y commit; el benchmark exige que no cambien durante su corrida. Entrega 4A permanece como referencia.

Limitaciones: replay requiere una versión compatible; SQLite y reconstrucción son síncronos y pueden ocupar el event loop al consultar la partida finalizada. Mediciones locales no garantizan latencia del aula. Recibos detallados heredados consumen mucho más disco que checkpoints; se conservan y documentan. No hay post-mortems redactados con IA ni evaluación A+–F.
