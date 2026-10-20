# FLOW WAR — hardening final de Entrega 5

## Referencia y trazabilidad

Repositorio: [imanderrrrr/flow-war](https://github.com/imanderrrrr/flow-war). Rama inicial `codex/entrega-5-audit-fixes`, SHA exacto `dd88729949dabbbf8c216c265dd580eef071a5aa`, comprobado localmente y mediante `git ls-remote`. Rama de entrega: `codex/entrega-5-final-hardening`, creada desde ese SHA. Sin merges ni cambios en main. Los commits separan reproducción, retención, bloqueo y validación.

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

## Evidencia en curso

Los resultados definitivos, comparación de regresión, limitaciones y conclusión se completan después de terminar las ejecuciones. Los intentos de desarrollo se conservan con etiquetas pilot y no sustituyen ejecuciones completas. `tests-development-interrupted.txt` es una ejecución interrumpida, sin resultado final aprobado. El primer piloto falló en la espera del benchmark ante una prueba QA todavía pendiente; su rechazo se conserva. Un segundo arranque de desarrollo se interrumpió antes de medir para corregir el campo de orden de mensajes. No se presentan esos intentos como pruebas aprobadas.
