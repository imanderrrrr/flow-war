# Entrega 5 — informe final de verificación y benchmarks

Base exacta: `d4c26036b0c2663e584d7d4287f7ffbc5858cd22`. Rama: `codex/entrega-5-crisis-flowslack-dvr`. Motor y escenario final medidos: `1d29aee66706f001dfc1599f67b2c87a674b7468`. SHA-256 del manifiesto completo de servidor/shared y escenario: `b8531edace82afd7fb50a7afbc8bd4b5f5390f22bfd5430c100bbfe7faaec7d3`. El JSON adjunto incluye los archivos. Documentación/capturas posteriores no cambian esas fuentes. Hardware: Apple M5; Node v25.9.0.

213/213 pruebas: 181 anteriores conservadas y 32 nuevas. Build correcto; advertencia Vite por bundle de unos 525 kB. Se ejecutaron `npm test`, `npm run build`, `npm run bench:traffic`, `npm run bench:actions`, `npm run bench:connections`, `npm run bench:chat` y `npm run bench:entrega5`.

Resultados: [JSON resumido](entrega-5-resultados.json). Los JSON extensos, recibos y bases temporales quedan fuera de Git. Tráfico/mercado se midieron en el corte 07102a7 (su manifiesto coincide exactamente con ese commit); acciones coinciden con el manifiesto del corte 922bdeb; las diferencias posteriores son proyección de generación, recuperación del buffer, consultas/métricas forenses y escenario de verificación. Las partidas nuevas completas se midieron con el manifiesto final arriba. Se conservan ambas huellas, sin afirmar que un reporte antiguo ejecutó fuentes posteriores.

## Regresión respecto de 4A

Los resultados empresariales de las **42 ejecuciones heredadas** coinciden exactamente con 4A: 24 de tráfico/mercado y 18 de acciones/controles, incluidas economía, clientes, reputación, presión y disponibilidad reportada. Dos escenarios heredados H-empty finalizan antes por eliminación total; se conservan esos resultados, sin llamarlos partidas completas. Las 18 ejecuciones de acciones y las 22 nuevas sí alcanzan 1,200/1,500 segundos.

| Grupo | Mayor p95 tick, 4A → 5 (ms) | Mayor p95 guardado, 4A → 5 (ms) |
| --- | ---: | ---: |
| Tráfico (6) | 3.08 → 3.05 | 51.30 → 49.16 |
| Mercado y controles (18) | 2.68 → 2.89 | 53.11 → 73.80 |
| Acciones y controles (18) | 2.61 → 3.10 | 53.57 → 85.38 |

La persistencia agrega hechos, inputs, chat y checkpoints; su aumento es una regresión medida. No se declara rendimiento perfecto. Las cadencias heredadas son un segundo simulado para tráfico y diez para mercado/acciones; el servidor guarda normalmente cada segundo real y al confirmar comandos. Las mediciones son locales, con variación de GC, disco y actividad del equipo. Algunos tiempos totales de reloj incluyen pausas largas del host; no se presentan como tiempo puro de CPU. No se atribuye cada diferencia a una instrucción.

## 22 partidas nuevas y replay exacto

| Escenario | Minutos | Tick p95 ms | Persistencia p95 ms | SQLite MiB | Salto máximo ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| A-crisis | 20 | 3.08 | 77.34 | 340.72 | 776.39 |
| B-recovery | 20 | 2.66 | 60.47 | 556.07 | 1126.55 |
| C-complaints | 20 | 2.73 | 62.58 | 556.65 | 1107.60 |
| D-hidden-traffic | 20 | 2.74 | 61.32 | 556.65 | 1122.36 |
| E-maint60 | 20 | 2.68 | 58.85 | 554.43 | 1096.26 |
| F-maint120 | 20 | 2.71 | 59.02 | 553.00 | 1111.11 |
| G-orders | 20 | 2.55 | 59.18 | 554.56 | 1104.82 |
| H-domino | 20 | 2.83 | 60.85 | 556.56 | 1241.53 |
| J-replay | 20 | 2.57 | 59.71 | 556.08 | 1110.09 |
| K-defect-maint | 20 | 2.78 | 60.90 | 540.65 | 1190.01 |
| L-equivalent | 20 | 2.58 | 59.95 | 556.06 | 1122.27 |
| A-crisis | 25 | 3.06 | 79.41 | 413.66 | 703.73 |
| B-recovery | 25 | 2.65 | 64.43 | 704.72 | 1124.04 |
| C-complaints | 25 | 2.71 | 65.21 | 706.02 | 1160.77 |
| D-hidden-traffic | 25 | 2.69 | 64.70 | 706.02 | 1172.06 |
| E-maint60 | 25 | 2.58 | 62.55 | 704.16 | 1161.53 |
| F-maint120 | 25 | 2.63 | 64.63 | 704.08 | 1138.84 |
| G-orders | 25 | 2.55 | 59.43 | 704.13 | 1161.02 |
| H-domino | 25 | 2.69 | 64.29 | 706.41 | 1305.07 |
| J-replay | 25 | 2.59 | 63.92 | 704.73 | 1171.40 |
| K-defect-maint | 25 | 2.60 | 66.54 | 684.53 | 1173.45 |
| L-equivalent | 25 | 2.56 | 61.69 | 704.72 | 1140.54 |

Se ejecutaron **29700** comprobaciones explícitas de población y **176** reconstrucciones exactas tras cerrar/reabrir SQLite. Los hashes comparan empresas completas (sin outbox transitorio), mercado individual, cambios, acciones y chat. Los puntos incluyen tiempos entre checkpoints, 08:30.5 y el final. No se alteró la partida original. Una prueba de proceso real termina una partida, consulta un punto, reinicia Node y vuelve a comparar exactamente ese estado histórico.

Tick p50/p95/p99 y persistencia p50/p95/p99 están desglosados por caso en el JSON. Picos medidos: heap hasta **418.52 MiB** (proceso/GC, no memoria exclusiva por sala); snapshot privado hasta **171948 bytes**. Lectura de puntos DVR: **0.52–1.05 ms**; saltos completos hasta **1305.07 ms**. El endpoint visual también lee marcadores/proyecciones y añade serialización/red, por lo que leer puntos no representa toda su latencia.

Archivo SQLite completo: **340.72–706.41 MiB**. Journal más checkpoints: hasta **121.98 MiB**. El campo journalBytes mide payloads de hechos y checkpoints, no índices/páginas completas. Los recibos detallados heredados dominan el resto del almacenamiento. Se conservan por integridad y se documenta su costo. No hay snapshots de 5,000 clientes por tick.

## Evidencia de escenarios

A declara reputación inicial 34 y ninguna intervención; B declara la misma condición inicial y recupera operación mediante el pipeline normal. Se registran activación y recuperación de crisis. No se presenta esa condición de fixture como pérdida inventada durante el juego. C publica reclamaciones con causas reales y D conserva síntomas sin diagnósticos automáticos de ataques. L mantiene resultados económicos/clientes iguales entre las cinco empresas; chat y animaciones no dan ventaja.

Rechazos por mantenimiento de NOVA (20/25 min): total 60 s **2323 / 1824**; total 120 s **4753 / 3744**; selectivo **1183 / 953**. El cierre total comprueba cero admisiones nuevas a servicios protegidos en la ventana, sin borrar trabajo previo. Selectivo comprueba navegación terminada; el generador heredado emite browse/purchase, no query. La solicitud query explícita se prueba con el mismo motor en la suite y termina correctamente bajo suspensión selectiva.

K interviene a los 200 segundos y reabre a los 260: la tentativa anterior a los 600 encontró la empresa ya insolvente por sus pérdidas reales. El escenario no altera capital ni reglas de eliminación. K demuestra que D02 permanece publicado y se activa antes y después de reabrir: 20 min: 24 antes / 90 después; 25 min: 32 antes / 88 después. No se repara al cerrar el gateway. H conserva transferencias reales y crecimiento de demanda del receptor. J incluye pausa/chat, recuperación y comparación temporal completa.

El primer intento integral se detuvo al exigir queries que el generador heredado nunca emite; se corrigió el escenario para contrastar tráfico de lectura generado y se repitió completo. También se congelaron las muestras con structuredClone. La admisión se comprueba estrictamente después del tick del comando: solicitudes generadas en ese mismo tick antes de recibir el cierre son trabajo previo válido. No se redujeron ni retiraron pruebas.

## Conexiones y comunicación humana

Benchmark heredado: **27** conexiones, confirmación p95 **62.42 ms**, máximo **75.12 ms**, snapshot máximo **132267 bytes**. Referencia 4A publicada: p95 70.231 ms y 124,132 bytes de snapshot; la dispersión local impide prometer esa mejora en una red de aula.

FlowSlack: **25 jugadores + Docente + proyector**, **125/125** mensajes entregados. Confirmación p50/p95/p99: **13.38/15.84/16.81 ms**. Entrega: **15.33/18.13/19.18 ms**. Verificados aislamiento en cada snapshot/consulta, deduplicación, lectura durante pausa, reconexión, reinicio y bloqueo de escritura tras finalizar. El chat no ejecutó herramientas ni generó infracciones.

## Capturas y prueba manual

- [Sirena, reputación 34 y siete hojas](../images/entrega-5-crisis.jpg)
- [FlowSlack privado](../images/entrega-5-flowslack.jpg)
- [Mantenimiento confirmado y temporizador](../images/entrega-5-mantenimiento.jpg)
- [DVR al minuto uno](../images/entrega-5-dvr.jpg)
- [Gráficas, marcadores y arquitectura histórica](../images/entrega-5-dvr-arquitectura.jpg)

[Arquitectura, límites y pasos manuales](../12-entrega-5-crisis-flowslack-mantenimiento.md). [Diseño y validación del DVR](../13-dvr-forense.md). Las capturas usan la fixture local explícita, independiente de la sala existente del usuario.

Limitaciones: almacenamiento considerable, replay síncrono, compatibilidad por versión del motor, intervalos antiguos no reconstruibles y ventana de pérdida desde el último COMMIT. MTTR no confirmado queda nulo y la corrección definitiva no se inventa. No hay calificaciones académicas ni migración de negocio financiero.

No se utilizó Anthropic, Claude, SDK, claves, créditos API ni Ruflo. Main permanece en `ded62dcba370b899b5295e4e81837a7276b0bc65`, sin merges.

## Archivos modificados

- Contratos y presentación derivada: shared/observability.ts, shared/crisis.ts, shared/types.ts y shared/actions.ts.
- Hechos, captura y reconstrucción: server/observability.ts, history.ts, storage.ts, persistence.ts, engine.ts, traffic.ts, scenarios.ts, market.ts y discipline.ts.
- Comunicación y operaciones: server/flowslack.ts, chat.ts, maintenance.ts, action-validation.ts, index.ts; costos demostrados en requests.ts y module-execution.ts.
- Forense: server/dvr.ts, postmortem.ts; interfaz en src/Dvr.tsx, Crisis.tsx, FlowSlack.tsx, Maintenance.tsx, App.tsx y styles.css.
- Validación: diez archivos nuevos de pruebas, cinco expectativas de esquema actualizadas; scripts chat-benchmark.ts, entrega5-benchmark.ts, entrega5-demo.ts y entrega5-report.mjs. README, documentos 12/13, informe, JSON resumido y cinco capturas.

## Commits por cortes

- 04e9875 feat(observability): add ordered confirmed facts and versioned capture contract (cut A)
- fb1fe88 feat(history): persist compressed checkpoints and deterministic input replay (cut B)
- f97a19b feat(crisis): persist hysteresis and deterministic simulated-time paper state (cut C)
- 2047044 feat(ui): add arcade siren ambient pulse and accessible paper stacks (cut D)
- 137a2ea feat(flowslack): derive sampled complaints and neutral alerts from confirmed facts (cut E)
- 8c628dd feat(chat): add private authenticated persistent FlowSlack conversations (cut F)
- ab06eb8 feat(maintenance): close simulated gateway and drain admitted work with audited recovery (cut G)
- 3339955 feat(maintenance): distinguish transaction suspension from full closure (cut H)
- a264abf feat(dvr): add authorized historical timeline architecture and request evidence browser (cut I)
- 5b408cd feat(forensics): derive evidence-based recovery pipeline and ledger metrics (cut J)
- 07102a7 fix(integration): preserve secret-free receipts and audit exact modeled defect costs (cut K)
- 922bdeb fix(recovery): retain pending facts and separate chat history across generations (cut K)
- e8b839c feat(forensics): reconcile operating spend and escaped defect evidence (cut J)
- fd341cc test(benchmarks): add complete delivery-5 replay and 27-connection chat scenarios (cut L)
- 93d42e8 fix(benchmarks): validate generated read traffic and freeze historical samples (cut L)
- 230d29f test(recovery): verify actual server replay restart and earlier defect intervention (cut L)
- 98d2b06 fix(benchmarks): respect admitted work at the maintenance command tick (cut L)
- 7e12edf fix(privacy): scope administrative replay markers to the affected company (cut K)
- 5ac48cc docs(delivery-5): document contracts replay privacy and visual verification
- 1d29aee docs(evidence): preserve browser screenshots with their actual JPEG format
