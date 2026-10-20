# Entrega 5.5 — snapshots eficientes y DVR configurable

## 1. Problema y referencia

La referencia exacta es `b52ccc67c8aeaf3d76cf52a4db60d10e120f5942`, verificada también en `origin/codex/entrega-5-final-hardening`. La rama de entrega parte de ese commit y conserva todos sus tests. No se modifica `main`, no se fusionan ramas ni se reescribe historia.

La auditoría anterior registró 183.312 snapshots y 22,82 GiB de JSON lógico en un ensayo de aula. Esas cifras no eran bytes físicos de red. Tampoco se reutilizan como denominador de las mejoras: la comparación nueva vuelve a ejecutar la versión original en este equipo con el mismo calendario que B y C.

## 2. Alternativas y decisión

| Técnica | Evaluación | Decisión |
|---|---|---|
| Snapshot completo menos frecuente | Reduce mensajes, pero amplía los saltos visuales y la espera tras acciones. | Mantener 200 ms. |
| Deltas | Evitan repetir campos estables; exigen base, secuencia y recuperación. | Aplicar deltas inmutables con reemplazo cuando resulte menor. |
| Actualización por dominio | Evita reconstruir contratos independientes de economía, chat y gráficos. | Editar subárboles del snapshot coherente; conservar el contrato React. |
| Coalescencia | Los estados intermedios pierden utilidad para un cliente lento. | Una actualización pendiente por socket; construir la siguiente al quedar disponible. |
| Compresión | Las partículas cambiantes todavía eran costosas a 20× en el primer ensayo. | WebSocket permessage-deflate, nivel 1, cuatro trabajos concurrentes, sin context takeover. |
| Proyección por rol | Recalcular las mismas cinco vistas públicas 27 veces desperdicia CPU. | Compartir la proyección pública durante una emisión y separar la administrativa. |
| Redundancia | `privateCompany` repite la empresa pública; las partículas repiten nombres de campos. | Codificar partículas en tuplas reversibles y transmitir solo las diferencias privadas. |
| Interpolación | El canvas ya anima posiciones derivadas entre snapshots. | Conservar la interpolación visual existente, sin simular cobros ni eventos. |

No se reduce la población de 5.000 clientes, el tráfico del motor, los escenarios, la muestra visual existente de partículas ni la cadencia nominal de actualización.

## 3. Contrato de sincronización

`shared/sync.ts` define protocolo, stream de conexión, secuencia, generación, identidad, base y parche. La primera entrega es completa. La reconexión vuelve a empezar con una base completa. Cambiar de generación o identidad obliga a sustituir toda la base. Un salto de secuencia invalida el estado local y solicita `state:resync`. Un paquete antiguo no puede sobrescribir uno nuevo.

Los cambios anidados, campos eliminados, reducción de arrays y colecciones con IDs conservan su orden. El codec compacto se deshace antes de entregar `Snapshot` a Zustand o React; los componentes mantienen sus tipos y valores. Los tests y scripts existentes usan el mismo reducer de producción, sin fingir que recibieron actualizaciones que no comprendieron.

## 4. Pérdidas, clientes lentos y confirmaciones

`SnapshotSync` retiene una sola base y una actualización pendiente de ACK. Mientras espera, no construye otras proyecciones para ese socket. Si el transporte no está disponible, omite trabajo reemplazable. A los dos segundos sin confirmación vuelve a una base completa. Un ACK viejo no libera una actualización distinta. Los contadores permiten medir coalescencia y resincronizaciones.

La cadencia de 200 ms es nominal: con un ACK lento el siguiente estado espera, y el transporte asíncrono puede aumentar ese intervalo. Los comandos conservan su transacción durable e idempotencia. FlowSlack conserva sus filas, orden y consulta paginada; el límite de la ventana de conversación viva sigue siendo el existente. Coalescer estado no borra mensajes durables ni resultados operativos.

## 5. Autorización

El servidor calcula primero una proyección autorizada. Solo después la compacta y compara con la base de ese mismo socket. La caché temporal usa la identidad completa y nunca comparte deltas privados globales. El docente conserva los campos administrativos; el proyector recibe campos públicos. Las alertas públicas de concurrencia y colapso se mantienen, mientras los detalles administrativos de empresas ajenas se filtran.

Resincronizar vuelve a consultar la sesión en SQLite. Logout invalida el token y desconecta sus sockets. Expulsión o caducidad emiten una limpieza inmediata del estado privado y una base pública. La corrección administrativa y una segunda expulsión también se prueban. React borra su snapshot y reinicia la notificación sonora al limpiar o desconectarse.

## 6. Arquitectura DVR

Las salas nuevas del servidor usan DVR OFF. `room.dvr` solo admite al docente y un booleano en LOBBY. RUNNING, PAUSED y estados terminales rechazan cambiar el modo. `room.reset` cierra la generación actual, conserva su modo y crea un lobby en el que puede elegirse el siguiente. El modo elegido se serializa junto con el estado vivo y queda registrado en `history_games` por generación.

La función de fixtures históricos `createGame` conserva su valor predeterminado ON para mantener el contrato de las pruebas y herramientas anteriores; el servidor especifica OFF al crear una sala nueva. Esta diferencia es deliberada y está comprobada mediante HTTP.

## 7. Funciones esenciales conservadas

Permanecen activas la simulación, economía, stock, clientes, crisis, mantenimiento, resultados de QA, staging, despliegues, artefactos, empleados, sesiones, autorizaciones, idempotencia, recibos de comandos y persistencia del estado vivo. Los recibos temporales usados por QA siguen alimentando sus informes y se consumen durante el trabajo de QA.

La secuencia de hechos operativos se mantiene en ambos modos. Los consumidores de FlowSlack reciben los hechos de liquidación, migración, mantenimiento y telemetría aunque no se archiven para replay. La durabilidad del chat usa un buffer operativo propio, separado del journal forense.

## 8. Trabajo realmente desactivado

Con DVR OFF no se agregan hechos al buffer del journal, inputs históricos ni puntos de muestreo del DVR. No se serializan checkpoints de replay, no se crean recibos forenses vivos ni se preparan o comprimen sus detalles, no se insertan las tablas exclusivas del replay y no se retienen esos outboxes. Los hechos de liquidación evitan además expandir módulos y defectos usados exclusivamente por la evidencia histórica.

Se conserva una fila de metadatos que identifica que la generación no fue grabada. En LOBBY se pueden descartar únicamente las estructuras de captura de esa generación al seleccionar OFF; nunca se borran historiales de otras generaciones.

## 9. Disponibilidad y compatibilidad histórica

La migración añade `dvrEnabled INTEGER NOT NULL DEFAULT 1`: las filas existentes eran grabaciones bajo el contrato anterior. Un estado persistido sin el campo también se interpreta como ON. No se presume que un campo ausente signifique OFF.

Un test crea un archivo exportable ejecutando los fuentes reales de `b52ccc67`, lo lee con el código nuevo, compara el snapshot completo salvo el nuevo indicador y comprueba que su hash no cambió. Los archivos de solo lectura sin la columna nueva siguen funcionando.

Hay tres situaciones distintas: generación sin grabación (409 `DVR_NOT_RECORDED`), generación grabada aún activa (todavía no consultable) y generación grabada cerrada (disponible). El listado muestra solo generaciones cerradas grabadas. Rechazar OFF sucede antes de enviar una consulta al pool, y un test comprueba que no hubo ningún despacho. El mismo test consulta una generación ON anterior mientras la sala actual está OFF.

## 10. Método de medición

La matriz A/B/C usa 25 estudiantes, cinco empresas y cinco roles por empresa, un docente y un proyector: 27 conexiones independientes autenticadas según corresponda. Se ejecutan 1.200 segundos a 1×, 1.200 a 20× y 1.500 a 20×, secuencialmente por configuración. No se mide una red Wi-Fi ni 27 interfaces gráficas de navegador.

Una copia inmutable de Git ejecuta A. El mismo preload de medición se aplica a las tres configuraciones. Para controlar el escenario, recibe comandos reales por sus sockets, los libera exactamente en los ticks declarados y llama al handler original sin cambiar estado o velocidad del motor. Se registran el orden, tick real y hash de acciones. La espera deliberada de este mecanismo se informa por separado y se descuenta de la latencia ACK; el bloqueo real del servidor y el transporte permanecen incluidos.

Se usan semilla 8, 5.000 clientes y reputación inicial explícita de 34 para producir crisis reales. Los pipelines de Backend y Seguridad pasan por QA, CTO y DevOps, y el escalado a ocho servidores usa financiación y comandos normales. Se envían 125 mensajes y sus 125 reintentos; se exigen 625 entregas autorizadas. Se detienen y recuperan servicios, se reconecta un cliente y se ejecuta SIGKILL con QA pendiente. Las pausas controladas en los ticks 190 y 250, sus duraciones y el reinicio se distinguen del tiempo de simulación.

No se ejecuta el control opcional D porque el commit original no tiene un modo OFF; introducirlo fabricaría otra versión de referencia.

## 11. Capas de tráfico y costes

Se distinguen JSON de la proyección completa, actualizaciones compactas, codificación Socket.IO, payload y framing WebSocket después de compresión y bytes TCP escritos y leídos. Los contadores TCP abarcan las conexiones persistentes; el HTTP de autenticación y comprobaciones no se atribuye a esos sockets. Se informan también percentiles de tamaño y aplicación del reducer en los clientes Node, snapshots completos, deltas, coalescencia y resincronizaciones. El coste de aplicación del contrato original no se instrumentó y figura como n/d; no se atribuye un coste cero al navegador. Los bytes por identidad incluyen sus reconexiones y se desglosan individualmente en el JSON.

La memoria máxima es el pico observado cada 20 ms. CPU es tiempo de proceso, incluido zlib y la instrumentación. La primera instrumentación copiaba el JSON para contarlo; se retiró ese observador y sus resultados se conservaron como desarrollo. La matriz certificada mide el tiempo real de `Encoder.encode` y deriva los bytes lógicos del paquete ya codificado, sin serializarlo otra vez ni envolver globalmente `JSON.stringify`. El tiempo de broadcast incluye construir y preparar la actualización, pero no la compresión asíncrona. El event loop se resume como máximo p99 de los segmentos separados por el crash.

## 12. Resultados comparables

<!-- MATRIX_RESULTS -->
### 20 minutos a 1×

| Métrica | A: original + ON | B: optimizado + ON | C: optimizado + OFF |
|---|---:|---:|---:|
| Proyección completa reconstruida en cliente, JSON lógico | 20,684.13 MiB | 20,451.32 MiB | 20,448.64 MiB |
| JSON lógico emitido | 20,785.55 MiB | 5,879.14 MiB | 5,869.36 MiB |
| Payload lógico recibido por clientes | 20,684.13 MiB | 5,879.06 MiB | 5,869.31 MiB |
| TCP total enviado | 20,726.66 MiB | 780.59 MiB | 779.18 MiB |
| TCP total recibido por clientes | 20,726.6 MiB | 780.59 MiB | 779.18 MiB |
| Socket.IO serializado | 20,787.78 MiB | 5,882.74 MiB | 5,872.96 MiB |
| Payload WebSocket tras compresión | 20,725.19 MiB | 779.95 MiB | 778.54 MiB |
| Framing WebSocket | 1.46 MiB | 0.62 MiB | 0.62 MiB |
| TCP Mbit/s medio | 141.24 | 5.25 | 5.24 |
| TCP pico de 1 segundo, Mbit/s | 197.14 | 7.61 | 7.42 |
| Bytes TCP medios por identidad | 804,943,487.52 | 30,315,044.56 | 30,260,261.67 |
| Actualizaciones emitidas | 163,152 | 162,073 | 162,109 |
| Actualizaciones aplicadas | 162,466 | 162,045 | 162,081 |
| Completos / deltas | 163,152 / 0 | 55 / 162,018 | 55 / 162,054 |
| Coalescencia por ACK/transporte | n/d: tiene coalescencia setImmediate previa | 283 | 570 |
| Payload p50 / p95 / p99, bytes | 144,751 / 170,581 / 176,570 | 42,742 / 46,300 / 47,504 | 42,740 / 46,300 / 47,504 |
| ACK p95, todas las acciones | 1,594.91 ms | 1,798.81 ms | 1,574.72 ms |
| ACK p95 sin chat | 1,023.36 ms | 1,077.07 ms | 1,299.8 ms |
| Event loop: máximo p99 de segmento | 83.82 ms | 101.91 ms | 91.55 ms |
| CPU de proceso, segundos | 353.25 | 538.63 | 514.05 |
| CPU media (% de un núcleo) | 28.7 % | 43.15 % | 41.24 % |
| RSS máxima observada | 446.03 MiB | 442.47 MiB | 350.95 MiB |
| Encoder Socket.IO, tiempo total | 111,109.69 ms | 58,309.53 ms | 59,148.19 ms |
| Broadcast, máximo p95 de segmento | 64.01 ms | 87.55 ms | 101.58 ms |
| Aplicación del reducer cliente p95 | n/d | 0.22 ms | 0.24 ms |
| Cadencia cliente p50 / p95 / p99 | 201.76 ms / 219.91 ms / 269.52 ms | 202.92 ms / 266.24 ms / 302.12 ms | 202.91 ms / 255.07 ms / 303.59 ms |
| SQLite final con índices | 426.96 MiB | 427.01 MiB | 9.25 MiB |
| Filas SQLite modificadas, no bytes físicos de disco | 460,152 | 460,171 | 3,564 |
| Transacciones SQLite confirmadas | 1,485 | 1,493 | 1,490 |
| Tiempo RUNNING real, segundos | 1,223.21 | 1,233.85 | 1,234.14 |
| Pausas controladas, segundos | 1.16 | 6.13 | 6.03 |
| TCP bytes/s medios | 17,655,533.65 | 655,709 | 655,539.5 |
| Bases completas posteriores al primer ingreso | n/a | 28 | 28 |
| Solicitudes del protocolo state:resync | n/a | 0 | 0 |
| ACK p95 solo chat | 1,732.83 ms | 1,976.04 ms | 1,721.27 ms |
| Cadencia cliente máxima (incluye reconexiones) | 2,675.64 ms | 5,945.74 ms | 5,932.56 ms |
| Heap máximo observado, MiB | 173.15 | 185.67 | 197.72 |
| Workers históricos creados durante la partida | 0 | 0 | 0 |

### 20 minutos a 20×

| Métrica | A: original + ON | B: optimizado + ON | C: optimizado + OFF |
|---|---:|---:|---:|
| Proyección completa reconstruida en cliente, JSON lógico | 1,087 MiB | 1,034.69 MiB | 1,034.86 MiB |
| JSON lógico emitido | 1,094.71 MiB | 321.22 MiB | 321.26 MiB |
| Payload lógico recibido por clientes | 1,087 MiB | 321.13 MiB | 321.18 MiB |
| TCP total enviado | 1,094.97 MiB | 43.14 MiB | 43.15 MiB |
| TCP total recibido por clientes | 1,094.97 MiB | 43.14 MiB | 43.15 MiB |
| Socket.IO serializado | 1,094.87 MiB | 321.43 MiB | 321.48 MiB |
| Payload WebSocket tras compresión | 1,094.89 MiB | 43.1 MiB | 43.11 MiB |
| Framing WebSocket | 0.08 MiB | 0.03 MiB | 0.03 MiB |
| TCP Mbit/s medio | 133 | 4.58 | 4.75 |
| TCP pico de 1 segundo, Mbit/s | 180.26 | 7.53 | 7.53 |
| Bytes TCP medios por identidad | 42,524,532.11 | 1,675,522.44 | 1,675,886.22 |
| Actualizaciones emitidas | 8,818 | 8,271 | 8,276 |
| Actualizaciones aplicadas | 8,763 | 8,243 | 8,248 |
| Completos / deltas | 8,818 / 0 | 55 / 8,216 | 55 / 8,221 |
| Coalescencia por ACK/transporte | n/d: tiene coalescencia setImmediate previa | 292 | 287 |
| Payload p50 / p95 / p99, bytes | 144,432 / 170,320 / 176,496 | 43,579 / 55,105 / 57,409 | 43,546 / 55,105 / 57,409 |
| ACK p95, todas las acciones | 1,682.99 ms | 1,624.67 ms | 1,490.2 ms |
| ACK p95 sin chat | 1,070.66 ms | 1,115.69 ms | 1,048.17 ms |
| Event loop: máximo p99 de segmento | 127.01 ms | 144.83 ms | 101.52 ms |
| CPU de proceso, segundos | 38.99 | 49.46 | 37.57 |
| CPU media (% de un núcleo) | 56.46 % | 62.55 % | 49.32 % |
| RSS máxima observada | 654.66 MiB | 695.78 MiB | 434.53 MiB |
| Encoder Socket.IO, tiempo total | 3,841.55 ms | 2,541.99 ms | 2,554.03 ms |
| Broadcast, máximo p95 de segmento | 31.94 ms | 60.3 ms | 57.31 ms |
| Aplicación del reducer cliente p95 | n/d | 0.17 ms | 0.17 ms |
| Cadencia cliente p50 / p95 / p99 | 201.75 ms / 259.28 ms / 441.1 ms | 202.6 ms / 316.82 ms / 1,924.63 ms | 201.95 ms / 250.21 ms / 1,878.34 ms |
| SQLite final con índices | 426.88 MiB | 426.8 MiB | 9.2 MiB |
| Filas SQLite modificadas, no bytes físicos de disco | 457,862 | 457,885 | 1,284 |
| Transacciones SQLite confirmadas | 340 | 350 | 350 |
| Tiempo RUNNING real, segundos | 66 | 67.07 | 64.45 |
| Pausas controladas, segundos | 1.16 | 6.13 | 6.08 |
| TCP bytes/s medios | 16,625,112.94 | 572,122.05 | 594,008.16 |
| Bases completas posteriores al primer ingreso | n/a | 28 | 28 |
| Solicitudes del protocolo state:resync | n/a | 0 | 0 |
| ACK p95 solo chat | 1,818.1 ms | 1,779.74 ms | 1,634.86 ms |
| Cadencia cliente máxima (incluye reconexiones) | 2,751.6 ms | 5,944.47 ms | 5,873.71 ms |
| Heap máximo observado, MiB | 166.65 | 183.09 | 164.03 |
| Workers históricos creados durante la partida | 0 | 0 | 0 |

### 25 minutos a 20×

| Métrica | A: original + ON | B: optimizado + ON | C: optimizado + OFF |
|---|---:|---:|---:|
| Proyección completa reconstruida en cliente, JSON lógico | 1,353.87 MiB | 1,295.75 MiB | 1,302.11 MiB |
| JSON lógico emitido | 1,361.35 MiB | 397.76 MiB | 400.22 MiB |
| Payload lógico recibido por clientes | 1,353.87 MiB | 397.71 MiB | 400.14 MiB |
| TCP total enviado | 1,361.65 MiB | 53.26 MiB | 53.57 MiB |
| TCP total recibido por clientes | 1,361.65 MiB | 53.26 MiB | 53.57 MiB |
| Socket.IO serializado | 1,361.53 MiB | 398.02 MiB | 400.48 MiB |
| Payload WebSocket tras compresión | 1,361.55 MiB | 53.21 MiB | 53.52 MiB |
| Framing WebSocket | 0.1 MiB | 0.04 MiB | 0.04 MiB |
| TCP Mbit/s medio | 136.64 | 4.73 | 4.92 |
| TCP pico de 1 segundo, Mbit/s | 169.59 | 7.6 | 7.6 |
| Bytes TCP medios por identidad | 52,881,391.96 | 2,068,405.48 | 2,080,383.52 |
| Actualizaciones emitidas | 10,838 | 10,295 | 10,301 |
| Actualizaciones aplicadas | 10,783 | 10,267 | 10,273 |
| Completos / deltas | 10,838 / 0 | 55 / 10,240 | 55 / 10,246 |
| Coalescencia por ACK/transporte | n/d: tiene coalescencia setImmediate previa | 373 | 287 |
| Payload p50 / p95 / p99, bytes | 145,213 / 171,247 / 176,796 | 43,794 / 55,017 / 57,905 | 43,771 / 55,017 / 57,905 |
| ACK p95, todas las acciones | 1,450.42 ms | 1,378.34 ms | 1,514.58 ms |
| ACK p95 sin chat | 982.78 ms | 965.71 ms | 1,073.67 ms |
| Event loop: máximo p99 de segmento | 121.77 ms | 144.05 ms | 103.74 ms |
| CPU de proceso, segundos | 45.94 | 59.54 | 45.49 |
| CPU media (% de un núcleo) | 54.95 % | 63.05 % | 49.84 % |
| RSS máxima observada | 671.86 MiB | 660.09 MiB | 375.14 MiB |
| Encoder Socket.IO, tiempo total | 4,784.86 ms | 3,217.19 ms | 3,277.44 ms |
| Broadcast, máximo p95 de segmento | 31.27 ms | 60.61 ms | 58.05 ms |
| Aplicación del reducer cliente p95 | n/d | 0.18 ms | 0.15 ms |
| Cadencia cliente p50 / p95 / p99 | 201.77 ms / 249.39 ms / 348.71 ms | 203.25 ms / 315 ms / 1,172.05 ms | 201.98 ms / 243.73 ms / 1,387.18 ms |
| SQLite final con índices | 531.29 MiB | 531.28 MiB | 9.24 MiB |
| Filas SQLite modificadas, no bytes físicos de disco | 571,807 | 571,830 | 1,334 |
| Transacciones SQLite confirmadas | 355 | 365 | 365 |
| Tiempo RUNNING real, segundos | 80.49 | 82.42 | 79.51 |
| Pausas controladas, segundos | 1.18 | 5.98 | 6.1 |
| TCP bytes/s medios | 17,080,114.75 | 591,359.01 | 615,439.31 |
| Bases completas posteriores al primer ingreso | n/a | 28 | 28 |
| Solicitudes del protocolo state:resync | n/a | 0 | 0 |
| ACK p95 solo chat | 1,566.6 ms | 1,511.94 ms | 1,654.29 ms |
| Cadencia cliente máxima (incluye reconexiones) | 2,403.17 ms | 5,889.58 ms | 5,885.39 ms |
| Heap máximo observado, MiB | 176.51 | 181.53 | 165.3 |
| Workers históricos creados durante la partida | 0 | 0 | 0 |

Los contadores de emisión y aplicación tienen extremos diferentes durante ingreso, desconexión y cierre: un estado emitido o codificado puede ser reemplazado o quedar en el transporte al desconectar. No se presenta esa diferencia como pérdida de mensajes humanos; estos se verifican por sus 625 destinatarios y por las 125 filas originales. Las 55 bases completas optimizadas corresponden a 27 ingresos, una reconexión manual y 27 conexiones tras SIGKILL; no hubo solicitudes state:resync durante estas partidas. La pérdida de secuencia se fuerza en tests específicos. Los datos individuales de cada una de las 27 identidades están en clients.byIdentity.


<!-- END_MATRIX_RESULTS -->

## 13. Almacenamiento

Se separan archivo principal, WAL, páginas e índices por tabla, bytes lógicos de recibos, eventos, inputs, puntos, checkpoints, comandos, mensajes y estado vivo. Los informes de QA viven dentro del estado activo: se informa su tamaño lógico como subconjunto, sin sumarlo otra vez a los bytes físicos. Todas las configuraciones terminan su generación y aplican la misma política de cierre; no se usa VACUUM.

<!-- STORAGE_RESULTS -->
| Partida | Modo | Principal tras cierre | WAL antes / después | Recibos | Eventos | Checkpoints | Comandos | FlowSlack |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| 1200s / 20× / A | ON | 426.88 MiB | 19.49 MiB / 0 MiB | 227,130 | 228,931 | 23 | 273 | 285 |
| 1200s / 20× / B | ON | 426.8 MiB | 19.45 MiB / 0 MiB | 227,130 | 228,932 | 23 | 274 | 285 |
| 1200s / 20× / C | OFF | 9.2 MiB | 7.9 MiB / 0 MiB | 0 | 0 | 0 | 274 | 285 |
| 1500s / 20× / A | ON | 531.29 MiB | 19.5 MiB / 0 MiB | 283,910 | 285,981 | 28 | 273 | 305 |
| 1500s / 20× / B | ON | 531.28 MiB | 19.42 MiB / 0 MiB | 283,910 | 285,982 | 28 | 274 | 305 |
| 1500s / 20× / C | OFF | 9.24 MiB | 7.91 MiB / 0 MiB | 0 | 0 | 0 | 274 | 305 |
| 1200s / 1× / A | ON | 426.96 MiB | 7.94 MiB / 0 MiB | 227,130 | 228,931 | 23 | 273 | 285 |
| 1200s / 1× / B | ON | 427.01 MiB | 7.95 MiB / 0 MiB | 227,130 | 228,932 | 23 | 274 | 285 |
| 1200s / 1× / C | OFF | 9.25 MiB | 7.85 MiB / 0 MiB | 0 | 0 | 0 | 274 | 285 |

Los JSON certificados desglosan las páginas de tablas e índices, payloads lógicos, detalles comprimidos, estado activo e informes de QA. Las filas modificadas cuentan operaciones SQLite comprobables; no equivalen a bytes físicos escritos por APFS ni al total acumulado de WAL reescrito. El estado vivo continúa persistiendo en OFF.

Desglose adicional del escenario principal (20 minutos a 1×). Los tamaños lógicos, los comprimidos y las páginas físicas son medidas distintas y no se suman entre sí.

| Concepto | A | B | C |
|---|---:|---:|---:|
| Índices, páginas dbstat | 15.1 MiB | 15.09 MiB | 0.08 MiB |
| Recibos, JSON lógico | 146.5 MiB | 146.5 MiB | 0 MiB |
| Detalles de recibos comprimidos | 83.47 MiB | 83.47 MiB | 0 MiB |
| Rutas de recibos, payload lógico | 0 MiB | 0 MiB | 0 MiB |
| Eventos históricos, payload lógico | 94.14 MiB | 94.14 MiB | 0 MiB |
| Inputs históricos, payload lógico | 0.07 MiB | 0.07 MiB | 0 MiB |
| Puntos históricos, payload lógico | 0.2 MiB | 0.2 MiB | 0 MiB |
| Checkpoints, payload lógico | 3.42 MiB | 3.42 MiB | 0 MiB |
| Comandos, resultados, payload lógico | 0.01 MiB | 0.01 MiB | 0.01 MiB |
| Mensajes FlowSlack, payload lógico | 0.07 MiB | 0.07 MiB | 0.07 MiB |
| Estado activo, JSON lógico | 4.52 MiB | 4.52 MiB | 4.52 MiB |
| Evidencia QA, subconjunto lógico del estado activo | 41,060 bytes | 41,060 bytes | 41,060 bytes |
| Metadatos de generación, páginas dbstat | 4,096 bytes | 4,096 bytes | 4,096 bytes |

<!-- END_STORAGE_RESULTS -->

## 14. Determinismo económico

`dvr-determinism.json` compara estados persistibles completos con acciones y semilla iguales para 1.200 y 1.500 segundos. Normaliza únicamente `dvrEnabled`, `observability.checkpointAt` y `observability.sampleAt`; la exclusión del outbox ya pertenece a `serializeGame` en ambos modos. Se comparan además estados intermedios y las filas de FlowSlack. No se excluyen capital, ingresos, reputación, clientes, errores, stock, migraciones, crisis, QA o despliegues.

La matriz exige asimismo hashes idénticos del calendario y del estado completo de empresas, mercado, cambios, migraciones y stock entre A/B/C para cada escenario. Los IDs aleatorios de RPC y los relojes humanos de recepción no forman parte de ese hash económico; la prueba aislada sí controla los timestamps y compara el resto del estado completo.

## 15. Recuperación

Cada ensayo termina el servidor con SIGKILL después de confirmar un artefacto y una prueba QA pendiente. Tras reiniciar se comparan exactamente empresas, capital, stock, mercado y sus clientes individuales, cambios, acciones, chat, generación, tick y modo persistido. Se reutilizan las 26 sesiones y se reconectan los 27 sockets. El reintento del comando confirmado devuelve el mismo resultado y no duplica el artefacto. Los tests específicos ejercitan ambos modos y logout con el token anterior.

## 16. Regresiones y revisión visual

Se conservan las 232 pruebas anteriores y se añaden pruebas de sincronización, codec, privacidad, modo DVR, transacciones, archivos antiguos y recuperación. Las baterías existentes se ejecutan con DVR ON cuando verifican replay. Los consumidores Socket.IO existentes se adaptan al reducer real del protocolo.

<!-- TEST_RESULTS -->
264 tests aprobados, cero fallos, cero omitidos. Build aprobado. Las siete baterías de integración terminaron con código 0; Entrega 5 conserva 176 reconstrucciones exactas en 22 escenarios completos. Los tests definitivos también verifican un archivo producido por el código original y rechazos OFF antes del pool. Las nuevas pruebas añaden 32 casos sin eliminar ninguno de los 232 anteriores.

<!-- END_TEST_RESULTS -->

La revisión de navegador verifica selección OFF por defecto, explicación previa al inicio, selección ON, bloqueo durante RUNNING y renderizado de la arena con el codec. Las capturas `ui-dvr-off.png` y `ui-dvr-on.png` usan una sala sintética. Esta comprobación funcional de un navegador no equivale a medir FPS de 27 navegadores.

## 17. Riesgos y límites

Loopback no reproduce pérdidas, latencia variable, radio compartida, TLS ni equipos de estudiantes. La compresión consume CPU y puede tener resultados diferentes detrás de un proxy. En 1×, la suma de normalización, compactación y deltas también eleva el coste del broadcast; el aumento de CPU incumple el objetivo de mejorar ese recurso y queda como limitación, aunque el ahorro prioritario de tráfico sea considerable. Las ráfagas durables de chat y escalado simultáneo mantienen el coste de clonar y persistir el estado vivo por comando; esa latencia debe informarse aunque el tráfico baje. Los máximos observados dependen del muestreo y no son límites matemáticos.

Se hace una pasada por celda, no una estimación estadística de producción. Los resultados de desarrollo y sus fallos se conservan pero se excluyen de la tabla causal. Las baterías de integración ejecutadas durante desarrollo no se usan para atribuir ahorro de CPU; la matriz final congela fuentes y calendario y no corre otras cargas de prueba simultáneas.

## 18. Evidencias y reproducción

Fuentes de medición: `scripts/performance-classroom.ts`, `performance-probe.cjs`, `performance-matrix.mjs`, `performance-modes.ts` y `performance-regressions.mjs`. Los datos certificados, hardware, SHA, digest de fuentes, calendario, hashes económicos y códigos de salida están en `docs/benchmarks/entrega-5-5/certified/`; las regresiones y ensayos de desarrollo se conservan en la carpeta superior. La matriz se midió en `35e870719cb63710d568d414e0ebf306d9882ecd`; el cierre posterior añade documentación y evidencia. Se verifican además los hashes de fuentes para evitar confundir ese SHA de medición con el commit documental de entrega. Hardware común: Apple M5 de 10 núcleos, 16 GiB de RAM, Darwin 27.0.0, Node v25.9.0. Su README describe las capas y la reproducción. `certified/validation.json` reúne los resultados y `checksums.sha256` permite comprobar los archivos de evidencia. No se publican bases de partida, accesos, cookies ni datos reales de estudiantes.

## 19. Tabla ejecutiva

<!-- EXECUTIVE_RESULTS -->
Escenario principal: 20 minutos a 1×, 27 conexiones.

| Indicador | Sistema anterior | Snapshots optimizados + DVR ON | Snapshots optimizados + DVR OFF |
|---|---:|---:|---:|
| Tráfico TCP total | 20,726.66 MiB | 780.59 MiB | 779.18 MiB |
| Reducción de tráfico | 0 % | 96.23 % | 96.24 % |
| CPU (segundos de proceso) | 353.25 | 538.63 | 514.05 |
| RAM (RSS máxima, MiB) | 446.03 | 442.47 | 350.95 |
| SQLite (MiB) | 426.96 | 427.01 | 9.25 |
| ACK p95 (ms, ráfagas incluidas) | 1,594.91 | 1,798.81 | 1,574.72 |
| Event loop p99 de segmento (ms) | 83.82 | 101.91 | 91.55 |
| Mensajes humanos perdidos | 0 | 0 | 0 |
| Filtraciones empresariales detectadas | 0 | 0 | 0 |
| Diferencias económicas (hash completo) | 0 | 0 | 0 |

<!-- END_EXECUTIVE_RESULTS -->

## 20. Dictamen

<!-- CONCLUSION_RESULTS -->
Las nueve partidas certificadas finalizaron con código 0, 625 entregas autorizadas por ensayo y hashes económicos idénticos por escenario. En el escenario de aula a 1×, la configuración optimizada con DVR OFF usa 96.24 % menos bytes TCP, 97.83 % menos SQLite y 45.52 % más tiempo de CPU medido que A.

DVR ON conserva replay; DVR OFF no escribe recibos, journal, inputs, checkpoints ni puntos históricos y conserva estado vivo, QA y comunicaciones. La selección OFF continúa recomendada para salas nuevas.

Resultados desfavorables de B (snapshots optimizados con DVR ON): 20 min / 20×: CPU sube 26.85 % y RSS sube 6.28 % frente a A; 25 min / 20×: CPU sube 29.62 % y RSS baja 1.75 % frente a A; 20 min / 1×: CPU sube 52.48 % y RSS baja 0.8 % frente a A. Las latencias de ráfagas y la cadencia máxima están publicadas, aunque aumenten; reducir tráfico no elimina la persistencia síncrona por comando. El dictamen es **funcionalidad y reducción de tráfico/almacenamiento verificadas en entorno local**, con validación de Wi-Fi real, FPS de equipos de estudiantes y latencia de ráfagas pendientes antes de certificar capacidad de una red de aula concreta.

En 1× el broadcast acumulado pasa de 231.04 s a 364.72 s, mientras Encoder.encode baja de 111.11 s a 59.15 s. El coste agregado de proyección, normalización, compactación y diferencias aumenta; zlib añade CPU asíncrona. Estas mediciones no separan cada subfunción, por lo que no atribuyen todo el aumento a compresión. El proceso consume de media 28.7 % de un núcleo en A y 41.24 % en C. C reduce la RSS máxima 21.32 % y usa 4.56 % menos CPU que B, pero no recupera la CPU de A a 1×. La capacidad de CPU del servidor debe evaluarse con esa limitación.

<!-- END_CONCLUSION_RESULTS -->
