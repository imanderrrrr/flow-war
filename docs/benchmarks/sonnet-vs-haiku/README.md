# Haiku 5.5 o Sonnet 5.5 para el ejecutor

El ejecutor traduce una orden explícita a una llamada de herramienta y el servidor verifica todo lo demás (alcance de
la empresa, palabras del estudiante, permisos del rol; [docs/27](../../27-inicio-avisado-y-claude-acotado.md)). La pregunta
del docente: ¿es Haiku 5.5 el modelo adecuado, o conviene Sonnet 5.5?

## Lo que dice cada modelo (datos de la plataforma, octubre de 2026)

| | Haiku 5.5 (`claude-haiku-5-5`) | Sonnet 5.5 (`claude-sonnet-5-5`) |
| --- | --- | --- |
| Precio por millón de tokens, entrada / salida | US$0,10 / US$0,50 (prompts de hasta 100K tokens) | US$2 / US$10 |
| Lectura de caché | US$0,01 (0,1× la entrada) | US$0,20 |
| *Tool calling* estricto (`strict: true`) | Sí | Sí |
| Respaldo del servidor cuando un clasificador de seguridad rechaza | No: un rechazo queda rechazado | Sí (`fallbacks: "default"`, solo en la API de Claude) |
| Clasificadores que pueden rechazar | cyber, bio, frontier_llm, general_harms | los mismos más reasoning_extraction |
| Esfuerzo | Por defecto `medium`; FLOW WAR envía `low` | Por defecto `high` (niveles recalibrados); FLOW WAR envía `low` |
| Español | Sí | Sí |

El vocabulario neutral del juego (control, perímetro, tráfico anómalo simulado) existe porque las palabras de
ciberseguridad ya activaron un filtro de seguridad antes. Con Sonnet, si un clasificador rechaza, el servidor de
Anthropic reintenta en otro modelo; con Haiku el estudiante recibe un error técnico y no se ejecuta nada.

## Lo medido

Haiku 5.5, Test I (19 casos, `npm run verify:anthropic`), dos corridas reales del 2026-10-22
([detalle](../haiku/README.md)): **19/19** las dos veces, latencia por orden p50 2,1–2,4 s y p95 5,5–6,3 s, sin
reintentos.

Por orden, Haiku usó en promedio unos 400 tokens de entrada sin caché, 3.400 leídos de caché y 320 de salida. Con ese
mismo perfil:

| | Por orden | Clase de 25 con unas 500 órdenes |
| --- | --- | --- |
| Haiku 5.5 | ≈ US$0,00023 | ≈ US$0,12 |
| Sonnet 5.5 | ≈ US$0,0047 | ≈ US$2,30 |

Sonnet podría escribir más o menos tokens de salida que Haiku; la cifra real sale de la corrida pendiente de abajo.
Las escrituras de caché (1,25× la entrada, una por rol cada vez que la caché vence) suman poco en los dos casos.

Para una clase de 25, el cuello de botella es la capacidad local (`FLOW_AI_CONCURRENCY=5`, 2 por empresa, cola de 30,
plazo de 20 s por llamada), no el modelo: 25 estudiantes rara vez ordenan a la vez.

## Recomendación y decisión

- **Recomendación: Haiku 5.5.** Lo que impide actuar sobre otra empresa o responder fuera del juego está en el
  servidor, no en el modelo, así que Sonnet no agrega seguridad. Haiku ya pasó 19/19 dos veces con latencia mediana de
  unos 2 s y cuesta unas 20 veces menos por token.
- Lo que gana Sonnet: el respaldo automático ante rechazos de seguridad y, quizá, elegir mejor el motivo de rechazo en
  las frases que el filtro deja al modelo.
- **Decisión del docente: Sonnet 5.5** (`DEFAULT_MODEL` en `server/claude.ts`). Para volver a Haiku:
  `ANTHROPIC_MODEL=claude-haiku-5-5` en `.env`.

## Corrida real pendiente

No había clave configurada en la máquina al escribir esto, así que todavía no se midió Sonnet. Con la clave en `.env`
(`npm run setup:anthropic`) y sin ningún `ANTHROPIC_BASE_URL`:

```bash
env -u ANTHROPIC_BASE_URL FLOW_SCOPE_MODELS=claude-haiku-5-5,claude-sonnet-5-5 npm run verify:scope
```

```bash
env -u ANTHROPIC_BASE_URL ANTHROPIC_MODEL=claude-sonnet-5-5 FLOW_SMOKE_OUT=docs/benchmarks/sonnet-vs-haiku/test-i-sonnet-5-5.json npm run verify:anthropic
```

La primera escribe `scope-<modelo>.json` en esta carpeta, con 22 órdenes por modelo. Cada caso registra qué eligió el
modelo antes del filtro, qué recibió el estudiante y si el juego cambió. La segunda repite el Test I con Sonnet. Las
dos juntas cuestan menos de US$0,25.
