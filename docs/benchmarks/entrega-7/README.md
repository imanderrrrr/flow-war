# Evidencia reproducible — Entrega 7

Base de `develop`: `c57bfb7a64bf429bfa44dca4b5ead170a197372e`.
Dependencia Entrega 6: `e79a53e5c18bb3562365180c7e0095494c90a617`.
Código funcional final: `19c1dcb98e46e1bbbb63b18815c561c9cc630014`.
Rama: `codex/entrega-7-qa-cto-team-ai`. PR dependiente dirigido a `codex/entrega-6-backend-security-ai`, sin fusión.

## Pruebas

- `npm test`: 313/313 aprobadas, cero fallos/canceladas/omitidas, en `tests.txt`. Se conservan 285 casos de regresión, ajustando únicamente los que antes permitían una revisión sin devolución QA y la antigua limitación global de dos llamadas.
- Los estados de solicitud tienen verificación HTTP adicional: 2/2 en `http-final.txt`. El último ajuste de escenarios explícitos y carga adversarial tiene 54/54 pruebas específicas posteriores, en `qa-final.txt`.
- `npm run build`: TypeScript y Vite correctos, en `build.txt`. Vite conserva la advertencia de bundle mayor de 500 kB.
- Recuperación, economía, aislamiento, DVR ON/OFF, solicitudes simultáneas, pruebas QA aisladas, cartas y decisiones CTO están cubiertas en la suite.
- `npm run bench:ai`: treinta solicitudes en cinco empresas con transporte HTTP Anthropic explícitamente simulado. Máximo cinco simultáneas, una por empresa; empresa 0 deliberadamente más lenta. Esperas, duración, orden y consumo sintético en `ai-concurrency.json` y salida en `ai-concurrency.txt`.
- `npm run verify:anthropic`: `not_run`; no existen `ANTHROPIC_API_KEY` ni `ANTHROPIC_MODEL`. `anthropic.json` y `anthropic.txt` registran `MISSING_CREDENTIALS`, sin secretos. No se certifica interpretación semántica, disponibilidad ni capacidad contratada del proveedor real.

## Aula: procedimiento

Ejecutar las mediciones de forma secuencial, con el código indicado, sin modificar `server/` o `shared/` durante cada ejecución. Para repetir, usar un `--label` nuevo porque el harness no sobrescribe evidencia.

```sh
npm test
npm run build
npm run bench:ai
npm run verify:anthropic
node --import tsx scripts/collaboration-classroom.ts --students=25 --duration=1200 --speed=20 --dvr=off --label=delivery-27-off --output-root=docs/benchmarks/entrega-7
node --import tsx scripts/collaboration-classroom.ts --students=30 --duration=1200 --speed=20 --dvr=off --label=delivery-32-off --output-root=docs/benchmarks/entrega-7
```

Los archivos `delivery-*` son las mediciones finales. Los `classroom-*`, `certified-*` y `release-*` anteriores se conservan como mediciones preliminares; cada JSON declara el commit, digest de fuentes, harness, hardware y limitaciones. La única adaptación de la carga respecto a Entrega 6 añade una carta QA formal en el segundo 235 antes de solicitar una nueva revisión Backend. No introduce resultados de negocio ni altera decisiones del mercado.

Cada medición cubre 1200 segundos simulados a velocidad 20, cinco empresas, 5000 clientes, dos despliegues por empresa, tráfico comercial real del motor, ráfagas privadas de chat, reconexión, parada/recuperación de servicio y mantenimiento. En el segundo 250 se mata al servidor con SIGKILL; la partida, trabajos pendientes, credenciales y recibos se comparan exactamente con el commit durable antes de reanudar. Los comandos reintentados deben conservar su recibo y no duplicar efectos.

Los clientes son Node Socket.IO sobre loopback, con 25 o 30 estudiantes más docente y proyector. No son pruebas Wi-Fi ni mediciones de FPS de treinta navegadores. DVR está apagado en estos dos benchmarks; su modo encendido se comprueba en la suite, sin afirmar una carga larga ON equivalente.

## Resultados finales

| Conexiones | ACK normal p95 | Chat p95 | Variación normal / chat vs E6 | FlowSlack entregas | SIGKILL |
| --- | --- | --- | --- | --- | --- |
| 27 | 1.241 s | 1.839 s | 21.6% / 13.6% | 625, cero pérdidas/fugas | exacto |
| 32 | 1.158 s | 2.266 s | 13.5% / 18.9% | 900, cero pérdidas/fugas | exacto |

Ambas ejecuciones conservan fuentes idénticas, el mismo resultado económico final y la economía de Entrega 6. Digest económico: `27f84255eda7c146796d5116e53ba86e26f511863f7b2c7e61c0854052a1ecad`. Fuente: `comparison.json`, `delivery-27-off.json` y `delivery-32-off.json`.

Los ACK de ráfaga continúan por encima de un segundo. Respecto a las mediciones históricas de Entrega 6 hay incrementos; no se declara una mejora de latencia ni cumplimiento de un presupuesto subsegundo. No son ensayos contemporáneos emparejados, por lo que el porcentaje no demuestra causalidad por sí solo. El segundo benchmark tuvo variación de carga y de cadencia, registrada en sus segmentos.

El código confirma trabajo síncrono de clonación del juego, serialización y transacción SQLite por comando antes de enviar el ACK. El probe muestra broadcast p95 entre 49.4 y 164.1 ms, y event loop p99 entre 107.9 y 185.7 ms por segmento. Esto es compatible con acumulación en ráfagas, no con espera de red Anthropic: estas mediciones no hacen llamadas a Claude. El probe no separa el costo exacto de clonación frente a SQLite; esa atribución queda como inferencia, no como perfil medido. Se conservó durabilidad por comando; el trabajo de optimización adicional queda pendiente.


## Inspección visual

Servidor aislado `/tmp/flow7-ui`, con credenciales y datos sintéticos; no se usó el directorio de partida real. Se inspeccionaron QA, CTO, diagnóstico del docente y Backend. Se seleccionó evidencia, se escribió y envió una carta desde QA, y se verificó que Backend pasó de bloqueo a edición con revisión incrementada. Las capturas están en `docs/images/entrega-7-*.png`; muestran datos de prueba, sin llamadas reales a Claude.
