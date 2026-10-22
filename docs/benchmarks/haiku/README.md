# Haiku 5.5 como modelo por defecto del ejecutor

El ejecutor de FLOW WAR solo traduce una orden explícita del estudiante a una llamada de herramienta: no
razona arquitectura ni redacta soluciones. Esa tarea necesita velocidad y volumen, no profundidad, así que el
modelo por defecto pasó de `claude-opus-5-5` a `claude-haiku-5-5` (`server/claude.ts`, `DEFAULT_MODEL`). El
operador puede fijar cualquier modelo habilitado con `ANTHROPIC_MODEL`.

## Verificación real (Test I, 19 casos, API de Anthropic)

Mismo arnés que Opus (`npm run verify:anthropic`): A–H, los cinco ejemplos obligatorios y cuatro empresas
concurrentes. Cada caso se comprueba sobre el estado del motor, nunca sobre el texto del modelo. Evidencia en
[`anthropic-haiku-5-5-run1.json`](anthropic-haiku-5-5-run1.json) y
[`anthropic-haiku-5-5-run2.json`](anthropic-haiku-5-5-run2.json) (2026-10-22). Las 19 respuestas de cada corrida
las sirvió `claude-haiku-5-5` con `stop_reason: tool_use`, sin reintentos. Haiku no admite el *fallback* por
rechazo del servidor, así que la llamada usa el endpoint normal (sin beta).

| Métrica | Opus 5.5 (base) | Haiku 5.5 corrida 1 | Haiku 5.5 corrida 2 |
| --- | --- | --- | --- |
| Resultado | 19/19 | 19/19 | 19/19 |
| Latencia por orden p50 | 2386 ms | 2403 ms | 2086 ms |
| Latencia por orden p95 | 4155 ms | 6347 ms | 5485 ms |
| Entrada sin caché | 7 534 | 7 534 | 7 534 |
| Lectura de caché | 64 564 | 46 195 | 64 564 |
| Salida | 2 807 | 5 893 | 6 092 |

(La corrida 1 de Haiku calentó la caché del prefijo estable; por eso lee menos caché y su p95 es algo mayor.)

## Costo por corrida

Precios públicos por millón de tokens: Opus 5.5 US$4 entrada / US$20 salida; Haiku 5.5 US$0.10 entrada /
US$0.50 salida. Las lecturas de caché cuestan 0.1× el precio de entrada. Excluye escrituras de caché.

| Modelo | Entrada sin caché | Caché (0.1×) | Salida | Total aprox. |
| --- | --- | --- | --- | --- |
| Opus 5.5 | 7 534 × $4 = $0.0301 | 64 564 × $0.4 = $0.0258 | 2 807 × $20 = $0.0561 | **≈ $0.112** |
| Haiku 5.5 | 7 534 × $0.10 = $0.00075 | 64 564 × $0.01 = $0.00065 | 6 092 × $0.50 = $0.00305 | **≈ $0.0044** |

Haiku 5.5 resuelve el mismo Test I por **unas 25 veces menos** con latencia mediana parecida. Escribe cerca del
doble de tokens de salida porque razona a esfuerzo `low`; aun así su costo es mínimo frente a Opus.

## Mejora posible de latencia y costo (propuesta, no implementada)

Haiku 5.5 acepta desactivar el razonamiento (`thinking: { type: 'disabled' }`) a esfuerzo `low`, `medium` o
`high`; Opus 5.5 no lo acepta. Una opción `FLOW_AI_THINKING=off` limitada a Haiku podría reducir los tokens de
salida y la latencia. No se implementó ni se midió en la API real: requiere una corrida pagada del Test I
para confirmar que el 19/19 se mantiene sin razonamiento.
