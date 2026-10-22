# Evidencia — rendimiento E7, fases 1 y 2 (codificador `state:update` y group commit)

| Versión | Commit | Contenido |
|---|---|---|
| base | `3e485157a1cbf0ecfdc4e16c0e4ab1d35c6fa00b` | `origin/codex/entrega-7-performance-pass-1` (E7 + PR #3) |
| gc | `754b38dd468dc9de0e924b5e4b44aa8f907b99a5` | fases 1a (`0c703ca`), 1b (`8f16856`) y 2 (`754b38d`), group commit activo por defecto |

Hardware: Apple M5, 10 núcleos, 16 GB, Darwin 27.0.0, Node v25.9.0. Fecha: 21 de octubre de 2026.

## Pruebas y build

| Commit | `npm test` | Archivo |
|---|---|---|
| `3e48515` (base) | 315/315 | `logs/npm-test-3e48515.txt` |
| `0c703ca` (fase 1a) | 318/318 | `logs/npm-test-0c703ca.txt` |
| `8f16856` (fase 1b) | 318/318 | `logs/npm-test-8f16856.txt` |
| `754b38d` (fase 2, group commit) | 327/327 | `logs/npm-test-754b38d.txt` |
| `754b38d` con `FLOW_GROUP_COMMIT=0` | 327/327 | `logs/npm-test-754b38d-FLOW_GROUP_COMMIT-0.txt` |

`npm run build` en `754b38d`: correcto (`logs/npm-build-754b38d.txt`). Vite mantiene la advertencia previa de bundle mayor de 500 kB.

## Método del benchmark

- Harness oficial `scripts/collaboration-classroom.ts` con el preload `scripts/performance-probe.cjs`. Ambas versiones ejecutaron **los mismos bytes** de harness (`d26d9a89…`) y de preload (`6e0c9285…`, el de `754b38d`, copiado sobre el worktree base y verificado con `cmp`); cada JSON registra `harnessDigest`, `probeDigest` y `sourceDigest` (`a303dc89…` base, `2148abd5…` gc). Los cambios del preload están en `docs/19-group-commit-y-codificador.md`, sección 5: gancho de vaciado y contabilidad del codificador, ambos inertes en la base.
- Semilla 8, 1200 s simulados, velocidad 20, 25 o 30 estudiantes más docente y proyector (27/32 conexiones), DVR OFF y ON. Cada partida incluye las ráfagas de 70 operaciones (tick 130) y 125/150 mensajes FlowSlack (tick 160), reenvíos idempotentes, reconexión, parada/recuperación, mantenimiento y SIGKILL con recuperación exacta en el tick 250.
- Repeticiones pareadas e intercaladas en worktrees separados y congelados: orden base→gc en repeticiones impares y gc→base en pares, recorriendo 27-off, 32-off, 27-on y 32-on (`tools/run-matrix.sh`). Antes de cada ejecución se espera a que la carga de 1 minuto sea menor que 8; durante la ejecución se muestrea cada 5 s (`runs/*.load`).
- Validez: estado `passed` del harness y carga media muestreada menor que 8. Hubo picos externos (un iOS Simulator ajeno arrancando, carga hasta 43). Inválidas: `base-32-off-r4` (falló la aserción *action executed at its exact declared tick* con carga 13.9, la fragilidad del harness ya registrada por la auditoría), `gc-27-on-r3`, `gc-32-on-r2` y `gc-32-on-r3` (pasaron, pero con carga media 8.4–9.2). Se añadieron repeticiones pareadas r6 (32-off, 27-on, 32-on) y r7 (32-on) con `tools/run-matrix-extra.sh`. Resultado: 44 de 48 válidas, al menos 5 por grupo. Las inválidas se conservan en `runs/` y en `summary.json`.
- Resumen: `tools/summarize.cjs runs/` → `summary.txt` y `summary.json` (filas por ejecución y mediana, mínimo y máximo por grupo).

## Resultados

Mediana de las ejecuciones válidas, entre corchetes mínimo y máximo. Latencias en ms. ACK medido en el cliente, sin la espera deliberada del preload.

| Config | Versión | n | ACK no-chat p95 | Chat p95 | ACK máx. | Cadencia p99 | Bucle p99 | Broadcast p50 | CPU tramo 2 | Velocidad real | Commits |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 27 · OFF | base | 5 | 1,291 [1,177–1,485] | 2,115 [1,870–2,163] | 2,380 | 1,907 [1,876–2,175] | 109 [106–133] | 58.3 | 55.9 % | 18.2× | 357 |
| 27 · OFF | gc | 5 | **89.2** [79.2–90.1] | **82.9** [74.1–92.6] | 93 | **349** [266–528] | 92.9 [88.4–98.0] | 50.9 | 50.3 % | 19.8× | 104 |
| 32 · OFF | base | 5 | 1,189 [1,185–1,345] | 2,320 [2,221–2,505] | 2,655 | 2,287 [2,266–2,316] | 116 [114–127] | 68.2 | 60.4 % | 18.0× | 384 |
| 32 · OFF | gc | 6 | **84.7** [54.2–99.6] | **106** [97.1–113] | 107 | **449** [294–660] | 107 [102–129] | 60.2 | 55.0 % | 19.6× | 107 |
| 27 · ON | base | 6 | 1,242 [1,199–1,631] | 1,995 [1,897–2,132] | 2,338 | 1,942 [1,885–2,120] | 167 [156–184] | 58.1 | 72.1 % | 17.1× | 358 |
| 27 · ON | gc | 5 | **122** [112–124] | **147** [95.0–215] | 147 | **572** [375–842] | 171 [163–204] | 51.7 | 69.8 % | 18.7× | 104 |
| 32 · ON | base | 7 | 1,318 [1,203–1,762] | 2,618 [2,411–3,104] | 2,957 | 2,338 [2,303–2,594] | 187 [167–222] | 69.1 | 75.1 % | 16.4× | 385 |
| 32 · ON | gc | 5 | **109** [63.1–116] | **134** [127–135] | 134 | **538** [404–897] | 191 [175–216] | 61.0 | 71.8 % | 18.2× | 108 |

"Velocidad real" es 1200 s simulados divididos por el tiempo de pared de simulación (sin pausas). "Commits" cuenta transacciones SQLite confirmadas en la partida.

### Integridad

- Digest económico final `27f84255eda7c146796d5116e53ba86e26f511863f7b2c7e61c0854052a1ecad` en las 44 ejecuciones válidas, ambas versiones y ambos modos DVR; digest económico completo `3ffbecb14e53…` también idéntico en todas.
- `actionTraceDigest` idéntico entre base y gc (`f81ce35f…` con 27 conexiones, `9f2f3884…` con 32): cada acción programada se ejecutó en el mismo tick declarado y en el mismo orden.
- Recuperación SIGKILL exacta en todas (`recovery.exact`). FlowSlack: 625/900 entregas completas, 0 pérdidas y 0 fugas entre empresas en todas.
- **Bytes de `state:update`**: dos partidas completas adicionales de gc (`verify/verify-gc-32-on.json`, `verify/verify-gc-27-off.json`, ambas `passed` con el mismo digest) con el preload de verificación `tools/verify-encoder.cjs`, que vuelve a codificar cada paquete `state:update` de la ruta rápida con el `Encoder` estándar y compara las cadenas: 10,050 paquetes (≈ 401 MB) con 32 conexiones y DVR ON y 8,483 (≈ 343 MB) con 27 y DVR OFF, **0 diferencias** y 0 paquetes `state:update` por la ruta estándar (`verify/encoder-*.json`; el contador del primer tramo es el último volcado, cada 500 ms, antes del SIGKILL). La prueba `tests/socket-encoder.test.ts` cubre la misma igualdad en la suite.

### Lectura

- Las ráfagas ya no se serializan: ACK no-chat p95 baja de 1.19–1.32 s a 85–122 ms y chat p95 de 2.0–2.6 s a 83–147 ms. Ningún ACK supera 216 ms (antes hasta 3.5 s). Los commits por partida bajan de 357–385 a 104–108.
- La cadencia p99 baja de 1.9–2.3 s a 349–572 ms. Queda por debajo de 500 ms con DVR OFF; con DVR ON queda en 538–572 ms.
- El p99 del bucle de eventos no cambia de forma distinguible con DVR ON (rangos solapados) y baja 8–15 % con DVR OFF; no alcanza el objetivo de 100 ms salvo 27·OFF. Lo dominan el broadcast por socket, los pasos del motor y los checkpoints DVR, fuera del alcance de estas fases (fases 3–5 del plan).
- La serialización socket.io por paquete de estado (p50 del tramo 2) baja de 0.3–0.4 ms a 0.1 ms y el broadcast p50 de 58–69 ms a 51–61 ms. La CPU del tramo 2 baja 2–6 puntos y la simulación se acerca a la velocidad nominal (19.6–19.8× con DVR OFF frente a 18.0–18.2×).
- Bytes: la salida TCP sube 0.7–2.0 % (45.7 → 46.6 MB en 27·OFF) porque llegan más actualizaciones (≈ 8,540 frente a 8,260 en 27·OFF: los broadcasts ya no quedan detenidos detrás de ráfagas de 2 s) con un tamaño medio 1.4 % menor (40,177 frente a 40,753 bytes lógicos). No cambia el protocolo ni el contenido de ningún paquete.

## Reproducción

Desde un directorio de trabajo con `bench/` (copiar `tools/` ahí) y worktrees desacoplados `wt-base` (`3e48515`) y `wt-gc` (`754b38d`) junto a él, con `npm ci` en cada uno y el preload de `wt-gc` copiado sobre `wt-base/scripts/performance-probe.cjs`:

```sh
REPS=5 bench/run-matrix.sh
CONFIGS="32-off 27-on 32-on" FIRST=6 REPS=6 bench/run-matrix-extra.sh
CONFIGS="32-on" FIRST=7 REPS=7 bench/run-matrix-extra.sh
node bench/summarize.cjs bench/results
```

Cada ejecución individual equivale a, desde el worktree de cada versión:

```sh
node --import tsx scripts/collaboration-classroom.ts --students=25 --duration=1200 --speed=20 --dvr=off --label=<etiqueta> --output-root=<carpeta>
```

Verificación de bytes (una partida, sólo diagnóstico, no se usa para latencias):

```sh
NODE_OPTIONS="--require $PWD/bench/verify-encoder.cjs" FLOW_VERIFY_ROOT=$PWD/wt-gc FLOW_VERIFY_OUT=<carpeta> node --import tsx scripts/collaboration-classroom.ts --students=30 --duration=1200 --speed=20 --dvr=on --label=verify-gc-32-on --output-root=<carpeta>
```

## Límites

Clientes Node Socket.IO en loopback, no navegadores ni Wi-Fi; sin llamadas a Claude. La máquina era compartida; las comparaciones válidas se hicieron con carga menor que 8, pero con ruido de fondo (simulador, VM, otras sesiones). Las ráfagas del harness llegan liberadas por el preload dentro del timer y se vacían con el gancho documentado; en producción el vaciado lo hace `setImmediate` (cubierto por `tests/group-commit.test.ts` y por los comandos no programados del propio harness).
