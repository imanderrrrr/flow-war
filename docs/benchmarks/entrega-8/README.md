# Entrega 8 — evidencia medida

Equipo: macOS, 10 CPU, 16 GB, Node 25.9.0. Todas las corridas con DVR OFF salvo indicación.

## Pruebas

| Ruta | Resultado | Duración |
| --- | --- | --- |
| `npm test` (group commit) | 373/373 | 57 s |
| `FLOW_GROUP_COMMIT=0 npm test` | 373/373 | 53 s |
| `npm run build` | correcto (advertencia previa de tamaño de bundle) | — |

Línea base en `59ba951`: 327/327.

## Anthropic real (Test I)

[`anthropic.json`](anthropic.json): `failed` por **saldo de créditos insuficiente** en la cuenta de Anthropic.
El 2026-10-22 se configuró una clave real (`npm run setup:anthropic`) y `npm run verify:anthropic` llegó a la API
real: la clave fue aceptada (sin error de autenticación) y las 19 solicitudes fueron rechazadas con
`INSUFFICIENT_CREDITS`, sin tokens consumidos ni salida del modelo. El informe no contiene la clave.
La comprensión del modelo real sigue **sin verificar**: al recargar créditos, repetir `npm run verify:anthropic`.

## Ejecutor en aula (servidor real, endpoint Messages local)

[`executor-classroom.json`](executor-classroom.json): 25 estudiantes, 100 órdenes (4 por estudiante, una a la
vez por estudiante), simulación a 20×, latencia del modelo simulada de 800 ms (media configurada; rango 400–1200 ms).

| Métrica | Valor |
| --- | --- |
| Resultados | 40 ejecutadas, 40 consultas de datos, 20 rechazos por consejo; ninguna duplicada (servidores de NOVA 1 → 5) |
| Latencia del ejecutor | p50 4064 ms, p95 4911 ms (cola de 25 estudiantes sobre 5 llamadas simultáneas) |
| ACK de comandos ordinarios | control p50 15.9 / p95 19.1 ms; durante carga de Claude p50 18.1 / p95 43.6 ms |
| Ritmo de simulación | 0.91 del previsto durante la carga, 0.95 en control |

La latencia del ejecutor depende de la capacidad configurada y del modelo real; este número mide la cola local.

## Planificador del proveedor

[`ai-concurrency.json`](ai-concurrency.json): 30 solicitudes por el SDK con transporte simulado; máximo global 5,
máximo por empresa 2, primeras cinco atendidas en orden 0–4 aunque la empresa 0 es lenta.

## Regresión frente a la base (aula de 25 estudiantes, 1200 s a 20×, DVR OFF)

Arnés existente `scripts/collaboration-classroom.ts`; base `59ba951` ejecutada con su propio arnés; Entrega 8 medida en
`7fd999c` (las correcciones posteriores solo tocan el ejecutor de Claude, que este escenario no usa).
Resúmenes en [`classroom/`](classroom/).

| Métrica | Base (2 corridas) | Entrega 8 (2 corridas) |
| --- | --- | --- |
| Digest económico final | `27f84255…` | `27f84255…` (idéntico) |
| ACK p50 | 45.4 / 44.9 ms | 46.8 / 46.5 ms |
| ACK p95 | 88.7 / 92.3 ms | 94.1 / 91.5 ms |
| CPU segmento 1 / 2 | 30.9–30.9 % / 48.2 % | 31.4–32.1 % / 48.5–48.6 % |
| Heap máximo segmento 2 | 183–184 MB | 203–246 MB |
| RSS máximo segmento 2 | 379–383 MB | 428–473 MB |
| Estado persistido | 4 882 050 bytes | 4 923 274 bytes (+0.8 %) |

Latencia y CPU quedan dentro de la variación entre corridas. La memoria pico del proceso aumentó (SDK cargado,
estado nuevo por empresa y variación del recolector); se documenta como riesgo a vigilar en el equipo del aula.
La economía del escenario es idéntica bit a bit.
