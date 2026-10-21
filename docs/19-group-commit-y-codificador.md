# Entrega 7 — rendimiento fases 1 y 2: codificador `state:update` y group commit

## 1. Referencia y alcance

Rama `codex/entrega-7-performance-group-commit`, creada desde `origin/codex/entrega-7-performance-pass-1` en `3e485157a1cbf0ecfdc4e16c0e4ab1d35c6fa00b` (contiene E7 y el PR #3). Implementa las fases 1 y 2 del plan de la auditoría de rendimiento independiente del 21 de octubre de 2026. No toca `main`, `develop` ni ramas de entregas anteriores.

| Commit | Fase | Cambio |
|---|---|---|
| `0c703ca` | 1a | Codificador Socket.IO sin `hasBinary` para `state:update` |
| `8f16856` | 1b | El timer usa `scheduleBroadcast()` en lugar de `broadcast()` |
| `754b38d` | 2 | Group commit de comandos detrás de `FLOW_GROUP_COMMIT` |

Cada fase está en su propio commit y se revierte con `git revert`. La fase 2 también se desactiva sin desplegar código con `FLOW_GROUP_COMMIT=0`.

Se conservan la economía determinista, la recuperación exacta ante SIGKILL, el aislamiento entre empresas y roles, FlowSlack privado, DVR ON/OFF, la idempotencia por `(identity,id)` y el protocolo con el frontend. No cambia ninguna carga de prueba ni la configuración de durabilidad (`synchronous=FULL`, WAL).

## 2. Fase 1a — codificador `state:update`

`SnapshotSync.send` serializa cada actualización con `JSON.parse(JSON.stringify(...))` antes de emitirla, así que el paquete nunca contiene `Buffer`, `ArrayBuffer` ni vistas binarias. Aun así, `Encoder.encode` de socket.io-parser recorría el paquete completo con `hasBinary` antes de llamar a `encodeAsString`. El perfil de la auditoría atribuía a ese recorrido el 7.7 % del tiempo de pared.

`server/socket-encoder.ts` define `StateUpdateEncoder`, derivado del `Encoder` de la instancia CommonJS de socket.io-parser que carga el propio socket.io (se resuelve desde la ubicación de `socket.io`; la entrada ESM del paquete es otra copia del módulo). Para un paquete `EVENT` cuyo primer dato es `'state:update'` devuelve `[encodeAsString(packet)]`; todo lo demás pasa por `super.encode`. `server/index.ts` lo pasa como opción `parser` de `new Server`.

`tests/socket-encoder.test.ts` levanta un servidor Socket.IO real con ese parser, conecta docente, tres roles de empresas distintas y proyector, y emite doce rondas de actualizaciones completas y deltas de `SnapshotSync` sobre proyecciones reales del motor. Cada paquete que escribe el servidor se codifica también con el `Encoder` estándar y se exige igualdad parte por parte. Cubre además ACK, un evento binario (que sigue saliendo como `BINARY_EVENT` con adjuntos) y la reconstrucción de cada cliente igual a su proyección autorizada. Si alguien agrega binarios a `state:update`, esa comparación falla.

## 3. Fase 1b — broadcast fuera del callback del timer

El timer de 100 ms llamaba a `broadcast()` en línea, después de los pasos de simulación. Un comando que llegaba mientras tanto esperaba la proyección, el diff y la codificación de todas las conexiones. Ahora el timer llama a `scheduleBroadcast()`: el broadcast corre en la fase *check* de la misma vuelta del bucle, después de que la fase *poll* entregó los comandos pendientes, y se fusiona con los broadcasts que piden los comandos. Los datos emitidos no cambian; sólo cambia el intercalado.

## 4. Fase 2 — group commit

### Antes

Cada comando hacía `structuredClone` del juego (imagen de rollback), aplicaba el comando, serializaba el estado completo (2.3–4.7 MB) y confirmaba su propia transacción antes del ACK. En una ráfaga, el k-ésimo ACK esperaba k−1 durabilidades completas.

### Ahora

`server/command-pipeline.ts`:

1. **Al recibir** (sin cambios de orden ni de reglas): límite de 20 comandos/s por socket, rechazo de `agent.fixture`, identidad de la sesión, digest SHA-256 y búsqueda de idempotencia en la tabla `commands`. Un duplicado ya confirmado responde de inmediato con el resultado guardado o con `ID de comando ya utilizado.`
2. **Cola**: el comando admitido se encola y se programa un vaciado con `setImmediate`, que se ejecuta en la fase *check* de la misma vuelta del bucle, antes del siguiente timer.
3. **Por lote** (como máximo `FLOW_GROUP_COMMIT_MAX`, 64 por defecto; la cola completa se vacía en esa misma vuelta, lote tras lote):
   - una imagen de rollback (`structuredClone` + `copyHistoryBuffer`);
   - aplicación en orden de llegada con un único `receivedAt`;
   - una transacción `BEGIN IMMEDIATE … COMMIT` con la fila de estado y N filas en `commands`, cada una con la generación en la que se aplicó (un `room.reset` dentro del lote no reasigna las filas anteriores);
   - después del COMMIT: cancelación de tareas IA para `room.reset`/`room.finish`, ACK de todos los comandos y un único `scheduleBroadcast()`.
4. **Duplicados dentro del lote**: una segunda copia de un `(identity,id)` todavía en cola no se aplica ni inserta otra fila (evita violar la clave primaria y revertir el lote). Recibe el resultado confirmado de la primera, serializado igual que el de la tabla, o `ID de comando ya utilizado.` si el digest difiere.
5. **Fallo**: si la escritura en SQLite falla, se hace ROLLBACK, el juego vuelve a la imagen del lote y todos sus comandos (incluidas las copias duplicadas) reciben `No se pudo confirmar el comando.`, el mismo error de hoy. Si `applyCommand` lanzara una excepción, ocurre lo mismo y se registra en consola; en la ruta por comando esa excepción no tenía manejo.

`createGameWriter` (`server/storage.ts`) acepta una fila o una lista de filas de `commands`. Es el único escritor: el persist periódico del timer, `/api/ai`, el apagado y los lotes lo usan. El timer, las tres secciones de `/api/ai` que mutan estado, el broadcast programado y el apagado vacían antes la cola, de modo que el orden de llegada entre comandos y otras mutaciones se conserva y un broadcast nunca adelanta el ACK de un comando encolado.

### Garantías

- **ACK ⇒ COMMIT**: ningún comando se responde antes de que su transacción confirme. Ante SIGKILL a mitad de lote no hay nada durable del lote ni ningún ACK; los clientes reintentan con el mismo ID y el comando se aplica una sola vez.
- **Idempotencia**: igual que antes, por `(identity,id)` en SQLite y por recibos del juego.
- **Tick**: los comandos que llegan en la misma vuelta del bucle se aplican antes del siguiente paso de simulación, igual que la ruta por comando.
- **Durabilidad**: no cambian `synchronous=FULL` ni WAL. Un comando aislado cuesta lo mismo que antes (una imagen, una serialización, una transacción).

### Configuración y reversión

| Variable | Valores | Efecto |
|---|---|---|
| `FLOW_GROUP_COMMIT` | `0` | Ruta original por comando: imagen, transacción y ACK por cada comando. |
| | sin definir u otro valor | Group commit (predeterminado). |
| `FLOW_GROUP_COMMIT_MAX` | entero 1–1000 | Tamaño máximo de lote. Valores inválidos usan 64. |

## 5. Preload del benchmark: cambios documentados

`scripts/performance-probe.cjs` es un preload explícito del harness, nunca instalado por la aplicación. Tiene dos cambios, ambos neutrales para un servidor sin estas fases:

1. **Gancho de vaciado.** El preload retiene los comandos programados del harness y los libera dentro del timer, antes del `step` del tick declarado. Con group commit, el handler sólo encola; sin vaciado, el comando se aplicaría en la fase *check*, después de los veinte pasos del callback, y fallaría la aserción *action executed at its exact declared tick* (y cambiaría la economía). El preload reescribe `step(game)` como `__flowScheduledStep(step, game, flushCommands si existe)` y, si liberó algún comando, llama a `flushCommands()` antes del paso. En un servidor sin `flushCommands` (por ejemplo `3e48515`) no hace nada.
2. **Contabilidad del codificador.** El preload medía bytes y tiempo de los paquetes de estado envolviendo `Encoder.prototype.encode`. El codificador de la fase 1a no pasa por ese método para `state:update`, así que el preload también envuelve `encodeAsString` y cuenta los paquetes codificados fuera de `encode()`. Las llamadas anidadas dentro de `encode()` no se vuelven a contar; con el codificador estándar, por construcción, la contabilidad es idéntica a la anterior.

`tests/group-commit-server.test.ts` comprueba con este preload que los comandos programados se aplican (filas `history_inputs` con DVR ON), se confirman y se responden en su tick declarado con `FLOW_GROUP_COMMIT=1` y `0`; sin el gancho, la prueba falla.

## 6. Pruebas

- `tests/group-commit.test.ts`: equivalencia con la ruta por comando sobre las ráfagas del harness (70 operaciones CTO/DevOps, 125 mensajes FlowSlack, copias idénticas y en conflicto, reenvíos tras COMMIT, rol no autorizado y un `room.reset` en medio de un lote), con DVR OFF y ON y lotes de 64 y 7: mismo digest de resultados, mismo `serializeGame` final y mismas filas en todas las tablas SQLite. También duplicados en lote, ACK después del COMMIT y vaciado completo en una sola vuelta, un fallo real de SQLite (violación de clave primaria dentro de la transacción) con reintento exacto, y una excepción durante la aplicación.
- `tests/group-commit-server.test.ts`: servidor real. SIGKILL dentro de un lote de diez mensajes (un preload de prueba, `tests/group-commit-kill.cjs`, mata el proceso al insertar la cuarta fila de `commands`): ningún ACK, ninguna fila ni mensaje durable, recuperación exacta del estado confirmado y aplicación única de los mismos IDs tras reiniciar. Tick exacto en ambas rutas.
- `tests/socket-encoder.test.ts`: igualdad de bytes de la fase 1a.
- CI ejecuta además la suite completa con `FLOW_GROUP_COMMIT=0`.

## 7. Resultados del benchmark pareado

Evidencia completa, método y reproducción en `docs/benchmarks/entrega-7-group-commit/README.md`. Harness y preload con bytes idénticos para ambas versiones, semilla 8, 1200 s a 20×, 27/32 conexiones, DVR OFF/ON, repeticiones intercaladas con carga menor que 8; 44 de 48 ejecuciones válidas, al menos 5 por grupo. Mediana de las válidas, base `3e48515` → gc `754b38d`:

| Config | ACK no-chat p95 | Chat p95 | Cadencia p99 | Bucle p99 |
|---|---|---|---|---|
| 27 · OFF | 1,291 → **89** ms | 2,115 → **83** ms | 1,907 → **349** ms | 109 → 93 ms |
| 32 · OFF | 1,189 → **85** ms | 2,320 → **106** ms | 2,287 → **449** ms | 116 → 107 ms |
| 27 · ON | 1,242 → **122** ms | 1,995 → **147** ms | 1,942 → **572** ms | 167 → 171 ms |
| 32 · ON | 1,318 → **109** ms | 2,618 → **134** ms | 2,338 → **538** ms | 187 → 191 ms |

Digest económico `27f84255…` y digest completo `3ffbecb1…` idénticos en todas las ejecuciones válidas; traza de acciones idéntica entre versiones; SIGKILL exacto; FlowSlack sin pérdidas ni fugas. En dos partidas completas adicionales, 18,533 paquetes `state:update` de la ruta rápida resultaron byte a byte iguales a la codificación estándar.

Objetivos de la auditoría: ACK no-chat y chat p95 menores que 250 ms y ningún ACK mayor que 4 s, **cumplidos** (máximo 216 ms). Cadencia p99 menor que 500 ms, **cumplido con DVR OFF**, no con DVR ON (538–572 ms). Bucle p99 menor que 100 ms, **no cumplido** salvo 27·OFF: con DVR ON no cambia de forma distinguible. La salida TCP sube 0.7–2.0 % porque llegan más actualizaciones (los broadcasts ya no quedan detenidos detrás de las ráfagas), con un tamaño medio por mensaje 1.4 % menor; el protocolo y el contenido de los paquetes no cambian.

## 8. Riesgos pendientes

- **Bucle de eventos y cadencia con DVR ON.** El p99 del bucle (163–216 ms) lo dominan el broadcast por socket (51–61 ms), los veinte pasos del motor por callback y los checkpoints DVR síncronos. Corresponde a las fases 3 (diff compartido del estado público), 4 (`advanceTraffic`) y 5 (checkpoints fuera del bucle).
- **Costo por lote proporcional al estado.** Cada lote sigue pagando un `structuredClone` y un `serializeGame` completos (2.3–4.7 MB): un comando aislado cuesta lo mismo que antes. Quitar la imagen de rollback (fail-stop) es una decisión del usuario.
- **Fallo de escritura de lote.** Un error de E/S responde con error a todos los comandos del lote (hasta 64) en lugar de a uno; ante un disco lleno persistente el efecto es el mismo que antes.
- **Excepción al aplicar.** En la ruta por comando una excepción de `applyCommand` no tenía manejo y terminaba el proceso. Con group commit se revierte el lote, se responde con error y se registra; es un cambio de comportamiento en un camino que hoy no ocurre (`dispatchCommand` captura internamente).
- **Un `receivedAt` por lote.** Los comandos de una misma vuelta del bucle comparten marca temporal; sólo afecta a ventanas de FlowSlack (10 s) que se crucen dentro de esa vuelta, y el DVR conserva el valor usado.
- **ACK posteriores por conexión.** El primer ACK de cada conexión sale tras el COMMIT de su lote; los siguientes de la misma conexión esperan a que Engine.IO vacíe su búfer, al terminar la vuelta del bucle (igual que antes, pero ahora acotado por lotes de decenas de milisegundos).
- **Dependencia de socket.io-parser.** `StateUpdateEncoder` usa `encodeAsString`, público en tiempo de ejecución pero tipado como privado. Una actualización de socket.io debe volver a pasar `tests/socket-encoder.test.ts`.
- **Gancho del preload.** El benchmark ejerce las ráfagas mediante el gancho `flushCommands`; en producción el vaciado depende de `setImmediate`, cubierto por las pruebas unitarias y por los comandos no programados del harness.
- **Durabilidad en macOS.** Sin `fullfsync` un corte de energía puede perder transacciones confirmadas; no cambia con esta entrega y con group commit costaría por lote, no por comando (decisión del usuario).
