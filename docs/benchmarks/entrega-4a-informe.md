# Entrega 4A — verificación y benchmarks

Código del motor verificado: `a1c4433` (el commit posterior solo añade esta evidencia/documentación). Base exacta: `b3996dfd1650aefcc85b4b4ce95042b8cfb2b185`.

**181/181 pruebas**, incluidas las 115 originales. `npm run build` correcto. Vite emite el aviso de bundle JavaScript de aproximadamente 507 KB; no es un fallo del build.

## Reproducción y datos

```sh
npm test
npm run build
npm run bench:traffic
npm run bench:actions
npm run bench:connections
```

Los scripts avanzan ticks reales del motor, no simulan resultados por nombre. Tráfico/mercado aportan 24 regresiones; se reprodujeron las mismas 24 en la base. Acciones añade 16 partidas completas (ocho escenarios por cada duración) y dos controles de migración: **18 ejecuciones nuevas alcanzan exactamente 1,200/1,500 segundos**. Las dos regresiones heredadas H-empty terminan antes por eliminación total, conforme a su regla original; no se presentan como partidas completas de 20/25 minutos.

Equipo: `Apple M5`, Node `v25.9.0`. Semilla de acciones: `8`. Las regresiones mantienen `7357`. La huella SHA-256 de las fuentes efectivamente ejecutadas es `67cdf09bedaa1ba5a96a188138a034c0ee5f02d91f49b8c65ac4df4ef0f47cce`; el JSON incluye el manifiesto y el verificador exige la misma huella.

- [Base reproducida: tráfico y mercado](entrega-4a-base.json)
- [Regresiones de Entrega 4A](entrega-4a-regresion.json)
- [Acciones: comandos, estados, muestras y rendimiento](entrega-4a-acciones.json)
- [Comprobación independiente de efectos A–H](entrega-4a-acciones.verified.json)
- [27 conexiones: base y Entrega 4A](entrega-4a-conexiones.json)

Cada paso comprueba conciliación de solicitudes e ingresos; cada segundo y la recuperación comprueban conservación del mercado. Los recibos archivados se contrastan contra el número de filas SQLite. Las muestras históricas son copias inmutables. Los resultados incluyen infraestructura, empleados, capital, ingresos, reputación, presión, colas, abandonos, migraciones, pruebas y activaciones reales de defectos.

## Comparación con Entrega 3

Los resultados empresariales completos de las seis estrategias de tráfico y los 16 escenarios de mercado coinciden **exactamente** con la base reproducida: clientes, ingresos, capital, presión y demás campos publicados por esos ensayos. No se sustituyeron decisiones por resultados precalculados.

| Grupo | Ensayos | Mayor p95 tick (ms) | Mayor p95 guardado (ms) | Pico de heap (MiB) |
| --- | ---: | ---: | ---: | ---: |
| Base b3996df | 24 | 3.727 | 67.711 | 226.0 |
| 4A, regresión | 24 | 3.075 | 53.112 | 220.7 |
| 4A, acciones A–H y controles | 18 | 2.614 | 53.571 | 279.2 |

Tráfico guarda cada segundo simulado; mercado/acciones cada 10 segundos y las acciones guardan también sus confirmaciones. Se conserva esa diferencia de cadencias al comparar cada grupo con su base. El valor histórico cercano a 92 ms no se trata como garantía.

En el caso heredado E-recovery de 25 minutos el p95 de tick sube de 2.206 a 2.679 ms (aprox. 21%); es una regresión medida de 0.473 ms, dentro del presupuesto de tick de 100 ms. No todos los casos empeoran: los máximos por grupo de tick y guardado son menores que los máximos reproducidos de la base. Las nuevas partidas con artefactos/QA retienen más heap; el pico incluye resultados de casos sucesivos, asignaciones y GC, y no equivale al tamaño residente de una sola sala.

Se eliminó trabajo innecesario del ledger para intenciones de tráfico que ya son únicas por construcción; los pagos con reintento, intención compartida o módulo de compras conservan el registro necesario. No se introdujo infraestructura adicional ni se alteró la transacción SQLite.

| Duración | Estrategia heredada | Tick base → 4A (ms p95) | Guardado base → 4A (ms p95) |
| --- | --- | ---: | ---: |
| 20 min | baseline | 2.893 → 2.916 | 39.149 → 42.409 |
| 20 min | scaled | 2.738 → 2.732 | 47.700 → 48.059 |
| 20 min | protected-scaled | 2.216 → 2.277 | 30.947 → 30.885 |
| 25 min | baseline | 2.976 → 2.944 | 42.585 → 51.300 |
| 25 min | scaled | 3.727 → 3.075 | 59.741 → 48.960 |
| 25 min | protected-scaled | 2.319 → 2.236 | 30.295 → 30.920 |

## Causas y resultados de A–H

| Caso | 20 minutos | 25 minutos |
| --- | --- | --- |
| A-equivalent | 1,000 clientes por empresa; un módulo por empresa; economía y presión idénticas | 1,000 clientes por empresa; un módulo por empresa; economía y presión idénticas |
| B-restart | Capacidad 0 al reiniciar; abandonos 0 → 123 entre las muestras anterior/posterior | Capacidad 0 al reiniciar; abandonos 0 → 148 entre las muestras anterior/posterior |
| C-insufficient | Unitarias pasan; CH-011 desplegado; D02 se activa 117 veces | Unitarias pasan; CH-011 desplegado; D02 se activa 121 veces |
| D-exhaustive | Integración observa Q28.80 frente a Q36 esperados; QA humano rechaza CH-011 | Integración observa Q28.80 frente a Q36 esperados; QA humano rechaza CH-011 |
| E-campaign | 18,094 llegadas frente a 6,817 del competidor equivalente; cola 494 | 17,793 llegadas frente a 6,655 del competidor equivalente; cola 494 |
| F-expulsion | 29 empleados activos; DevOps expulsado; empresa continúa | 29 empleados activos; DevOps expulsado; empresa continúa |
| G-migration | Receptor: 38,355 llegadas vs. 32,669; 755 errores vs. 37; presión 107.7% vs. 0.02% | Receptor: 48,235 llegadas vs. 40,836; 421 errores vs. 36; presión 106.7% vs. 0.03% |
| H-recovery | Recupera reinicio y expulsión; prueba de 500 solicitudes termina con un solo informe | Recupera reinicio y expulsión; prueba de 500 solicitudes termina con un solo informe |

C y D crean la misma configuración de cupón con la misma semilla y versión. C solicita un cupón y no cubre la combinación; D solicita dos. El rechazo de D es un comando humano explícito, no una consecuencia automática del informe. G se compara además con una partida sin la actualización defectuosa, conservando las mismas decisiones de infraestructura; el receptor capta demanda adicional y se satura sin capacidad ficticia.

Las 18 ejecuciones nuevas registran 24,300 comprobaciones explícitas de población, además de las del motor, y 4,570,400 recibos archivados/conciliados. La población se mantiene en 5,000; no se incluyen clientes de QA en producción.

| Caso | Duración | Tick p95 (ms) | Guardado p95 (ms) | Heap pico (MiB) |
| --- | ---: | ---: | ---: | ---: |
| A-equivalent | 20 min | 2.179 | 52.275 | 156.0 |
| B-restart | 20 min | 2.614 | 49.784 | 141.8 |
| C-insufficient | 20 min | 2.553 | 51.835 | 158.4 |
| D-exhaustive | 20 min | 2.394 | 48.125 | 162.0 |
| E-campaign | 20 min | 2.456 | 53.571 | 156.6 |
| F-expulsion | 20 min | 2.377 | 47.248 | 165.3 |
| G-migration | 20 min | 2.483 | 50.988 | 138.6 |
| H-recovery | 20 min | 2.535 | 48.945 | 165.1 |
| A-equivalent | 25 min | 2.471 | 51.007 | 161.7 |
| B-restart | 25 min | 2.524 | 49.380 | 164.0 |
| C-insufficient | 25 min | 2.464 | 51.458 | 176.2 |
| D-exhaustive | 25 min | 2.403 | 52.303 | 209.7 |
| E-campaign | 25 min | 2.450 | 52.051 | 237.9 |
| F-expulsion | 25 min | 2.495 | 51.074 | 255.8 |
| G-migration | 25 min | 2.453 | 51.338 | 235.7 |
| H-recovery | 25 min | 2.496 | 48.061 | 251.8 |
| G-migration control | 20 min | 2.400 | 47.176 | 279.2 |
| G-migration control | 25 min | 2.377 | 46.951 | 228.8 |

## Conexiones

| Medida | Base | 4A |
| --- | ---: | ---: |
| Conexiones | 27 | 27 |
| Snapshots recibidos | 1701 | 1701 |
| Snapshot máximo (bytes) | 122977 | 124132 |
| Confirmación p95 (ms) | 55.598 | 70.231 |
| Confirmación máxima (ms) | 57.603 | 74.493 |

Se repitió la medición 4A tres veces: p95 entre 60.328 y 72.968 ms; la tabla presenta la corrida mediana. El máximo individual de todas las repeticiones fue 179.108 ms, conservado en el JSON. El p95 mediano de confirmación sube de 55.598 a 70.231 ms (aprox. 26%); el pico de 179.108 ms es una regresión observable de cola de latencia y queda documentado. Esta dispersión impide atribuir cada diferencia a una sola instrucción del motor.

Son 25 sesiones de roles técnicos, Docente y un proyector anónimo. Los 5,000 registros de clientes no viajan en snapshots. La prueba usa comandos secuenciales del operador y difusión a los 27 sockets; no demuestra un caudal ilimitado de comandos simultáneos ni sustituye un ensayo en la red del aula. Las mediciones son locales y tienen variación de CPU, GC y sistema de archivos.

## Verificación visual y aceptación

Se inició una sala temporal y se creó un descuento desde el formulario de Backend: apareció CH-001 en QA_PENDING, con un artefacto versionado y auditoría, mientras la versión productiva seguía en 1. React Flow, sprites, calles, paleta, tipografías y arena se conservaron. [Captura](../images/entrega-4a-backend.png).

Las pruebas cubren los 12 casos de aceptación: creación sin publicación, cobertura insuficiente y pertinente, pipeline humano completo, disponibilidad real, rate limit, campañas, infracciones/expulsión, recuperación, mercado persistente y adaptador local. Las pruebas de proceso real verifican sesiones autenticadas, publicación, recibos, expulsión tras reiniciar, bloqueo de login y corrección del Docente. No se consumieron tokens ni créditos de Anthropic.
