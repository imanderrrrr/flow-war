# FLOW WAR — Entrega 2: tráfico individual, FIFO y abandono

Base verificada: `codex/auditoria-fidelidad-motor`, commit `eae4bbf` (54 pruebas). Implementación en `codex/entrega-2-trafico-colas-abandono`. No se modifica ni fusiona `main`.

## 1. Alcance implementado y archivos

El tráfico ordinario dejó de resolverse mediante tasas de éxito/error, una cola numérica y sprites sintéticos. Cada llegada del servidor tiene identidad, recorrido, versión, esperas, operaciones y un resultado terminal. No se aplica el cálculo agregado anterior a estas mismas solicitudes.

| Corte | Implementación y evidencia |
| --- | --- |
| A — Contratos | `shared/types.ts`: solicitudes, resultados, visitas FIFO, servicios, recibos, escenario congelado y esquema 3. |
| B — Operación | `server/traffic.ts`: admisión, capacidad fraccional, FIFO, procesamiento, rechazo y vencimiento. `server/requests.ts`: intérprete de inventario/pago compartido con Entrega 1. |
| C — Conciliación | Resultado único, contabilidad por cohorte/clase, ventanas observadas, reservas pendientes de resolución y recibos auditables. |
| D — Empresas | `server/engine.ts`: cinco flujos independientes, demanda progresiva, presupuesto, escalamiento, despliegues y presión/reputación. |
| E — Arena | `src/TrafficCanvas.tsx`, `src/trafficGeometry.ts`, `src/App.tsx`: muestras reales, posiciones FIFO, resultados y métricas confirmadas. |
| F — QA/recuperación | `server/load.ts`, `server/persistence.ts`, `server/storage.ts`, `server/index.ts`: carga aislada, migraciones y escritura transaccional de snapshot/recibos/comandos. |
| G — Ensayos | `scripts/traffic-benchmark.ts`, `scripts/traffic-examples.ts`, `scripts/connection-benchmark.ts` y resultados en `docs/benchmarks/entrega-2.json`. |

Pruebas nuevas en `tests/ordinary-traffic.test.ts` y `tests/traffic-integration.test.ts`; ampliaciones en `tests/traffic.test.ts`, `tests/scenario-server.test.ts`, `tests/persistence.test.ts` y adaptación de las aserciones de Entrega 1 a cohortes separadas en `tests/concurrency.test.ts`. `package.json` añade `bench:traffic`; `tsconfig.json` comprueba también los scripts. No hay dependencias nuevas. `src/styles.css`, `src/icons.tsx` y `src/GraphEditor.tsx` permanecen intactos.

## 2. Contrato y transiciones

Se reutilizan `PurchaseRequest`, `RequestResult` y las operaciones de Entrega 1. `TrafficRequest` añade empresa, visitante, intención cuando compra, tipo (`browse`, `query`, `purchase`), clase legítima/maliciosa, servicio, fase, tiempos y visitas FIFO. Los nombres existentes son `id`, `deadline` y `accounted`; no se duplican con alias `requestId`, `deadlineAt` o `effectsAccounted` dentro del motor.

`arrivalAt`, `admittedAt`, `startedAt`, `finishedAt`, `queueEnteredAt`, `queueExitedAt` y `latencyMs` son observaciones del reloj del servidor. `waits` conserva **cada** ingreso/salida, servicio, posición inicial y motivo; `trace` conserva operaciones, tiempo y stock/versión en inventario. `executionVersion` y el recorrido quedan fijados al llegar, incluidos los controles de seguridad evaluados para esa versión. Los recorridos se comparten por versión para evitar copiar grafos por solicitud.

Transiciones ordinarias: admisión → `QUEUED` → `PROCESSING` → siguiente cola o resultado. `PENDING` identifica el contexto creado antes de intentar admisión. Resultados excluyentes: `COMPLETED`, `REJECTED`, `ABANDONED`, `FAILED`. Un contexto finalizado no vuelve a operar ni a contabilizarse. La llegada a una cola llena registra `QUEUE_FULL`; los deadlines registran `DEADLINE`, servicio y operación pendiente. El vencimiento tiene precedencia sobre un efecto que se intentaría ejecutar en ese mismo tick.

Para la cohorte ordinaria completa y para cada clase se exige:

```text
generated = pendientes sin resultado + completed + rejected + abandoned + failed
```

Una anomalía no incrementa `generated`. `attempt=0` es explícito: aún no se generan retries automáticos. Una futura implementación deberá vincular intentos distintos a la misma intención sin duplicar efectos. Los IDs incluyen generación de sala, empresa y ordinal; restablecer la sala cambia el namespace.

## 3. Capacidad y escenario `traffic-2.0`

Un solo servidor Node avanza pasos de 100 ms. Los frames, las conexiones y la selección de empresa no ejecutan solicitudes. Cada servicio acumula créditos de inicio de operación, consume uno al extraer FIFO y conserva su fracción. No acumula crédito durante una caída; el crédito ocioso tiene límite para impedir ráfagas ilimitadas posteriores. La operación iniciada finaliza después de su demora mínima cuando el servicio está disponible. Una caída suspende los efectos pendientes; el deadline sigue corriendo.

| Servicio | Inicios/s | Buffer de espera | Demora mínima |
| --- | --- | --- | --- |
| Seguridad | 120 compartidos | 240 | 100 ms |
| Web | 12 por servidor accesible | 40 por servidor accesible | 200 ms |
| Checkout | 12 por servidor accesible | 40 por servidor accesible | 100 ms |
| Inventario | 64 operaciones compartidas | 40 | 200 ms |
| Pago | 24 operaciones compartidas | 40 | 200 ms |

Sin balanceador solo un servidor es accesible. Escalar mantiene el aprovisionamiento inmediato existente; no borra elementos ni modifica su orden FIFO. Inventario/pago no se multiplican al escalar aplicación. Sin capital, presupuesto o disponibilidad no hay nueva ejecución. Restart corta capacidad durante 3 s. Rolling dura 6 s y reduce la capacidad accesible según los servidores existentes; con uno conserva el factor 0.12 ya utilizado por el juego.

Paciencia inicial: navegación **4 s**, consulta **6 s**, compra **10 s**. Cada solicitud guarda su deadline absoluto. Reposición ordinaria: **24 unidades/s**, hasta stock 200. Escenario y parámetros se copian al estado persistente; modificar los valores por defecto del código no cambia la configuración de una partida guardada.

Estos son parámetros de este juego, no estándares universales. Los ensayos con inventario 8 operaciones/s y pago 10/s hacían imposible absorber el máximo de 18 compras/s por empresa aun con ocho servidores: una compra utiliza varias operaciones de inventario. Se fijaron 64/24 y reposición 24 para permitir una empresa saludable sin quitar la saturación real de aplicación a 12/s por servidor. El umbral de latencia saludable quedó en 1,000 ms, con techo de penalización 3,000 ms: la cadena mixta sin cola ya ronda 700 ms, por lo que heredar 500 ms de la fórmula anterior penalizaba incluso un servicio saludable. Los ensayos finales de las secciones 8–9 verifican ambas condiciones.

La cola básica de infraestructura está implementada. **La pieza configurable `Queue` del editor no está implementada** como una cola con alcance propio: conectarla no concede capacidad ni protección artificial; los bloques avanzados alcanzables sin intérprete terminan explícitamente con `UNSUPPORTED_BLOCK`. Los bloques desconectados no intervienen.

## 4. Inventario, economía y presión

Las lecturas y escrituras son operaciones separadas. Una escritura insegura puede usar una lectura anterior; registra compromisos y sobreventa, manteniendo stock físico no negativo. `Atomic Update` antes de Write transforma ese compromiso en una comprobación/decremento indivisible del **stock actual**. Una lectura preliminar antigua no rechaza una compra si aún hay unidades suficientes. Atomic desconectado o posterior a Write no corrige lo ya comprometido. Se conservan las pruebas de dos compras/una unidad de Entrega 1 y se añade el caso de dos Atomic con stock suficiente.

Estados transaccionales: `NONE` → `RESERVED` al comprometer → `CONFIRMED` al pagar. Sobreventa o reserva sin pago al finalizar: `PENDING_RESOLUTION`. El vencimiento no devuelve inventario ni elimina pagos confirmados. La cuenta `unresolvedCount` y los recibos mantienen esas obligaciones; **no existe todavía un resolutor de compensaciones**. El inventario visible ordinario corresponde al ledger `REGULAR`; cuando hay ráfaga también se muestra el SKU `LAST-UNIT` con sus propios compromisos. No se mezclan ambos stocks.

Se mantienen Q45 por unidad legítima pagada y respaldada, Q3 de contribución al capital, Q8 de compensación por sobreventa y Q0.50 por servidor/s. Los costos de publicación siguen el catálogo. Rechazo/abandono sin pago puede registrar Q45 de oportunidad perdida; **no lo descuenta del capital**. Navegación, consulta y ataques no generan ventas ni oportunidades comerciales legítimas. Una compra pagada cuyo cliente deja de esperar conserva su venta y no registra a la vez una venta perdida. Cada resultado se concilia una vez mediante `accounted`.

Errores y latencia visibles provienen de resultados legítimos de los últimos 10 s; sin observaciones se muestra “—”. La utilización es un índice de ocupación/saturación observado de los servicios, con ventana temporal, que puede superar 100%; no es un porcentaje de CPU. Presión (0–300) y reputación integran con `dt` errores, latencia, saturación, indisponibilidad, accesos indebidos y consistencia. Un ataque correctamente rechazado no se convierte en comprador legítimo insatisfecho. El contador técnico histórico `errors` sí incluye terminales hostiles rechazados: no se utiliza como tasa de insatisfacción legítima.

La migración comercial sigue agregada, con conversión exponencial acotada y conservación de 5,000 clientes. Se rota el orden de propuestas/desempates para evitar privilegiar un ID fijo cuando las empresas son equivalentes. Los visitantes identificados en las solicitudes no constituyen una base persistente de fidelización.

## 5. Convivencia con LAST-UNIT y permisos

Las dos cohortes tienen IDs, inventarios, colas/contextos y agregados independientes. Comparten `executePurchaseOperation` y la conciliación terminal, no una misma llegada. La ráfaga LAST-UNIT conserva su fixture, calendario, intercalado y pruebas; no consume la cola ordinaria de infraestructura. Esta separación es un límite explícito: aún no se ensaya la ráfaga dentro del mismo planificador de capacidad ordinario.

La demanda ordinaria usa la curva progresiva existente, la cuota actual y acumuladores persistentes; la mezcla determinista es 70% navegación/30% compra. Consulta está soportada y probada pero no se añade artificialmente a esa mezcla. Las cinco empresas reciben una solicitud inicial real al comenzar; se descuenta del primer acumulador. Reanudar/reconectar no repite esa llegada. Los ataques se generan aparte desde el 12% de la duración, con ordinales reproducibles.

Se mantiene **Backend/Seguridad → QA → CTO → DevOps → producción**. El borrador, envío y corrida QA no publican ni modifican solicitudes en curso. La publicación cambia la versión para nuevas llegadas; las anteriores conservan su ruta. El servidor valida rol, empresa, etapa, versión base, reserva y expiración. La decisión QA sigue siendo humana y requiere evidencia terminada vigente. No se añade recomendación ni elección automática de suite/pieza.

## 6. QA Carga

`load-fifo-1`: semilla 7357, staging aislado con un servidor, sin balanceador, stock 100, mismo ejecutor ordinario y contexto inmutable del artefacto. Ofrece 40 solicitudes/s durante 8 s, luego drena/vence hasta 24 s. Buffer Web 80: permite observar tanto espera que vence como rechazo por saturación. Un tick de partida ejecuta diez pasos internos de 100 ms del fixture; tarda 2.4 s de juego y se congela al pausar.

Resultado reproducible para el grafo inicial:

| Generadas | Completadas | Rechazadas | Abandonadas | Fallidas | Pendientes | Cola máxima total | Latencia terminal media |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 320 | 100 | 111 | 109 | 0 | 0 | 86 | 2,495 ms |

La latencia de este informe incluye todas las solicitudes terminales, incluso rechazos; la arena muestra la ventana legítima de producción. La cola máxima suma las colas de los servicios, no solo Web. QA no gasta presupuesto, mueve clientes ni consume inventario de producción. Su ejecución pendiente también se recupera.

Concurrencia mantiene el ejecutor individual LAST-UNIT. **Regresión, Seguridad e Integración conservan los fixtures agregados anteriores** y no prueban capacidad, FIFO ni deadlines del nuevo ejecutor. El perfil automatizado protegido utiliza Seguridad como validación heredada dentro del pipeline; sus resultados no se presentan como evidencia de la nueva cola.

## 7. Persistencia, auditoría y retención

Se acepta esquema 1 → 2 → 3. El servidor conserva el JSON anterior en `game_migrations` antes de actualizar. La migración no inventa solicitudes históricas: conserva dinero, mercado, contadores y LAST-UNIT; empieza una cohorte ordinaria nueva. Las estimaciones antiguas de activos/cola/latencia/utilización quedan en `legacyMetrics`, sin mostrarse como solicitudes pendientes reales. Una sala antigua aún en lobby sí genera su primera solicitud al iniciar. Los informes Carga anteriores quedan históricos; una autorización sustentada únicamente en evidencia obsoleta vuelve a QA y libera su reserva.

SQLite guarda en la **misma transacción** los recibos terminales, snapshot comprimido y resultado de comando deduplicado. El outbox solo se limpia después del commit. Una falla revierte el conjunto y conserva los recibos para reintentar. Los contextos pendientes mantienen orden FIFO, crédito fraccional, timestamps, deadline, versión, escenario, seed y acumuladores; el servidor recupera una partida en curso en **PAUSED**.

Los contextos terminales completos permanecen 3 s para la animación; las ventanas observadas duran 10 s. Las rutas se conservan mientras exista una solicitud de esa versión. Los recibos históricos salen de RAM hacia `request_receipts`, con clave primaria por ID. Pendientes no se descartan por muestreo ni por retención. El tamaño histórico en disco crece con la partida y no tiene aún política de purga/exportación.

Las proyecciones públicas y privadas envían resúmenes y hasta 48 sprites por empresa, hasta 12 representantes deterministas por cola. Cada sprite conserva `requestId`, empresa, tipo, etapa/recorrido y resultado confirmado. La cola visual usa posición y profundidad reales; la animación terminal no decide el resultado. Ya no se generan compradores ficticios de migración ni un personaje inicial en Canvas.

Para auditar un ID, `GET /api/requests/:id` devuelve el contexto/recibo propio al participante autenticado o cualquier empresa al docente. Sin sesión: 403; empresa ajena: 404. Esta ruta no añade una pantalla ni ayudas. Las credenciales y los grafos privados no se publican en la muestra visual.

**Límite de durabilidad:** snapshot cada segundo de tiempo real, por comando confirmado y al cerrar ordenadamente. No hay journal completo de ticks. Una caída abrupta pierde el tiempo simulado posterior al último snapshot; a velocidad 20× puede abarcar aproximadamente 20 s simulados, además de retrasos del host. No se promete recuperar ese intervalo exacto. Los efectos anteriores al snapshot y sus recibos se recuperan juntos, sin duplicación.

## 8. Ejemplos cortos reproducibles

```sh
node --import tsx scripts/traffic-examples.ts
```

`fifo-eight-1`, semilla 7357: ocho navegaciones simultáneas, Web 1/s y paciencia 30 s, parámetros fijados antes de admitirlas. A los 2 s: 2 iniciadas en Web, 6 esperando, 1 completada. A los 4 s, sin cambio: 4 esperando y 3 completadas. Escalando a cuatro servidores con balanceador a los 2 s: 0 esperando y 8 completadas a los 4 s. El escalamiento no vacía la cola en el momento de ejecutarse.

Se guarda la cola a los 2 s en SQLite, se recupera pausada y se intenta avanzar 10 s: no cambia nada. Al reanudar, conserva FIFO y obtiene exactamente los agregados del control sin reinicio; 3 recibos archivados a los 4 s, sin duplicados. Otro fixture sin presupuesto admite una compra en t=0: abandona en t=10 en Seguridad, sin operaciones ni compromisos, ingreso Q0, oportunidad Q45 y capital Q10,000.

## 9. Partidas completas y comparación

```sh
npm run bench:traffic
node --import tsx scripts/connection-benchmark.ts
```

Se ensayaron 20 y 25 minutos, semilla 7357, cinco empresas simultáneas y tres estrategias guionadas por comandos validados. `baseline`: sin intervención. `scaled`: en t=300 CTO autoriza Q2,000 adicionales por empresa y DevOps escala a cuatro servidores con balanceador. `protected-scaled`: Backend entrega Atomic, QA Concurrencia aprueba, CTO autoriza y DevOps publica Rolling; Seguridad entrega Auth/WAF/Bot mediante QA Seguridad y el mismo pipeline; en t=300 se autorizan Q6,000 y se escala a ocho servidores/balanceador. Las primeras publicaciones suceden antes de las oleadas.

Resultados de la **cohorte ordinaria**, sumando las cinco empresas; al finalizar se resuelven como abandonadas las pendientes de cierre, preservando efectos previos:

| Minutos | Estrategia | Generadas | Completadas | Rechazadas | Abandonadas | Cola máxima por empresa | Presión final |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| 20 | baseline | 227,131 | 64,681 | 162,101 | 349 | 78 | 300 todas |
| 20 | scaled | 227,131 | 190,907 | 35,212 | 1,012 | 159 | 300 todas |
| 20 | protected-scaled | 227,130 | 163,165 | 63,775 | 190 | 2 | 0 todas |
| 25 | baseline | 283,909 | 80,863 | 202,674 | 372 | 78 | 300 todas |
| 25 | scaled | 283,908 | 240,192 | 42,686 | 1,030 | 159 | 300 todas |
| 25 | protected-scaled | 283,910 | 204,000 | 79,720 | 190 | 2 | 0 todas |

No hubo `FAILED` en estos perfiles. Los rechazos del perfil protegido son **ataques**, no compradores legítimos: en 25 min cada empresa tiene 40,836 llegadas legítimas, 40,800 completadas, 36 abandonadas, 0 rechazadas legítimas; 15,944 ataques rechazados y 2 abandonados. Las cinco terminan con 1,000 clientes, reputación 100, presión 0 y capital Q40,978. Persisten 3 transacciones ordinarias por empresa pendientes de resolución al cierre; no se ocultaron en los ingresos. Escalar sin proteger permite más tráfico hostil y sus efectos: throughput técnico no equivale a ventas legítimas ni a buen servicio.

Comparación capturada ejecutando el **código real de `eae4bbf`** con los mismos guiones/semilla y duración 25 min. Los contadores de esta tabla son globales, incluyendo LAST-UNIT:

| Versión/estrategia | Solicitudes | Completadas técnicas | Ingreso real | Oportunidades perdidas | Capital total final |
| --- | ---: | ---: | ---: | ---: | ---: |
| eae4bbf / baseline | 204,439 | 17,561 | Q239,310 | Q1,629,945 | Q61,164 |
| traffic-2.0 / baseline | 284,169 | 81,123 | Q1,046,295 | Q1,715,895 | Q114,963 |
| eae4bbf / scaled | 204,439 | 144,834 | Q1,957,455 | Q465,840 | Q166,707 |
| traffic-2.0 / scaled | 284,168 | 240,452 | Q2,633,310 | Q128,925 | Q211,764 |
| eae4bbf / protected-scaled | 204,440 | 204,309 | Q2,522,880 | Q245,070 | Q189,242 |
| traffic-2.0 / protected-scaled | 284,170 | 204,130 | Q2,757,600 | Q10,575 | Q204,890 |

No es una comparación de throughput sobre la misma población contabilizada: antes los ataques ordinarios no tenían entradas individuales en el contador; ahora sí. Tampoco se compara la latencia de fórmula anterior con una medición real como si fueran equivalentes. El motor anterior no podía evidenciar FIFO, deadline, abandono individual ni conservación por IDs; “no observado” no significa cero. La comparación explica el cambio de semántica y balance, no demuestra por sí sola una mejora de ventas en una clase real.

Para repetir el contraste, extraer la base sin modificar el checkout actual:

```sh
mkdir -p /private/tmp/flow-war-e1-benchmark
git archive eae4bbf server shared | tar -x -C /private/tmp/flow-war-e1-benchmark
npm run bench:traffic -- --baseline=/private/tmp/flow-war-e1-benchmark
```

### Rendimiento medido

Equipo: Apple M5, 10 cores, 16 GB, Node v25.9.0. Se archivaron **1,533,119 recibos** en los seis ensayos y se verificaron **405,000 invariantes empresa/tick**, además de conciliación económica/cohortes en cada paso. Máximo observado: 438 contextos pendientes/recientes por empresa, 267 recibos en outbox entre guardados, heap del proceso 172.8 MB. Los contextos históricos se liberaron; los recibos se comprobaron contra SQLite. Esto demuestra retención acotada para estos escenarios y duraciones, no un ensayo indefinido ni una medición aislada del heap del motor.

Ticks p95: **1.221–1.927 ms**; peor tick observado **38.623 ms**. Guardado transaccional p95: **18.895–29.217 ms**. Los ensayos acelerados guardan cada segundo **simulado** (más frecuentemente que el servidor a 20×) y cierran sus bases temporales. Una partida de 25 min tardó entre 24.1 y 31.1 s de ejecución local según el perfil.

Ensayo del servidor real con **27 conexiones locales** (25 roles, docente y proyector): 1,701 snapshots en 6.79 s, snapshot máximo 100,764 bytes, ACK p95 31.67 ms y máximo 31.72 ms. Los tiempos y el tick final del ensayo de sockets varían por programación del host; el escenario interno conserva su determinismo por ticks/comandos. Se verificó visualmente arena 1280×720 y el informe de QA. No se midieron FPS ni red Wi-Fi con 27 dispositivos físicos; esos ensayos de aula siguen pendientes.

## 10. Pruebas y aceptación

Verificación final: **83/83 pruebas aprobadas**, sin omitidas; `npm run build` correcto (TypeScript + Vite). Se conservan los comportamientos de las 54 pruebas de Entrega 1.

| Requisito | Evidencia automatizada |
| --- | --- |
| T01–T03 | Admisión sin éxito anticipado, sobrecarga y orden FIFO en `ordinary-traffic`. |
| T04–T07 | Escalamiento sin vaciado, cero capacidad, deadline y `QUEUE_FULL`; fracción de 0.3 operaciones/s conservada. |
| T08–T10 | Conservación por clase/cohorte, oportunidad sin débito ni venta y conciliación única; pago/reserva preservados tras abandono. |
| T11–T12 | SQLite transaccional, FIFO/créditos/deadlines recuperados y pausa de dinero/QA/operaciones. |
| T13–T15 | Versión antes/después de publicación, permisos/aislamiento y determinismo con distinta frecuencia visual y batching. |
| T16–T17 | Cada sprite referencia una solicitud; rutas reales; ataque bloqueado no deteriora satisfacción legítima. |
| T18 | Suite `concurrency` de Entrega 1: carrera, secuencialidad, Atomic, orden, cantidad, costos y pipeline. |
| T19–T20 | Carga aislada, recuperación del trabajo QA, no duplicación de recibos/efectos y API auditada con sesiones reales. |

Los escenarios finales se cubren así: empresa saludable/saturada/reacción/mala gestión y competencia en los seis ensayos; interrupción y versiones de despliegue en pruebas de integración y servidor; recuperación en SQLite y proceso real; regresión LAST-UNIT en su suite original. No se afirma que los perfiles guionados sustituyan el balance con estudiantes.

## 11. Verificación manual con la interfaz existente

Usar una carpeta de ensayo para conservar la partida habitual:

```sh
FLOW_PORT=4177 FLOW_DATA_DIR=/private/tmp/flow-war-entrega2-manual npm run dev
```

1. **Docente:** usar las credenciales de esa carpeta en `/login`, iniciar una sala de 20/25 min. Antes del inicio no hay tráfico; al iniciar existe una solicitud legítima real por empresa. Pausar congela reloj, costos, colas y QA; reanudar no repite las iniciales.
2. **Arena:** observar navegación y compras por las carreteras actuales; seleccionar otras empresas no altera resultados. Acelerar desde Docente a 20× hasta media partida y regresar a 1× para inspeccionar saturación. Con un servidor Web se acumula espera; las etiquetas muestran el servicio y cantidad reales. Rechazos/abandonos no recorren una salida de compra exitosa. Las cifras son totales; los sprites son una muestra acotada.
3. **Backend:** conservar o editar el borrador, guardar y enviar a QA. Para repetir Entrega 1, conectar Atomic antes de Write. No aparece en producción por guardar/enviar.
4. **QA:** elegir el cambio y suite Carga, ejecutar. Observar completadas, rechazadas, abandonadas, latencia, cola máxima y pendientes. Aprobar o rechazar manualmente. Concurrencia observa aparte las dos compras LAST-UNIT. Ejecutar QA no cambia stock/capital de producción.
5. **CTO:** revisar el cambio aprobado y autorizar su costo. Autorizar presupuesto operativo adicional en los controles existentes. QA no puede hacerlo; CTO no dispone de DEPLOY.
6. **DevOps:** dentro del presupuesto usar `+1 SERVER` y `ACTIVAR BALANCEADOR`. La cola disminuye a medida que se atienden solicitudes, sin desaparecer al hacer clic. Servidores extra sin balanceador no multiplican capacidad accesible. Elegir Rolling o Restart Replace y pulsar DEPLOY solo después de QA/CTO. Durante Restart se detiene el avance operativo; las pendientes pueden vencer. La versión visible cambia al terminar.
7. **Seguridad:** guardar/enviar un artefacto y seguir el mismo ciclo QA/CTO/DevOps. Comparar bloqueos con resultados legítimos: bloquear hostiles no registra oportunidades legítimas perdidas.
8. **Recuperación:** mientras haya cola, detener ordenadamente el proceso y arrancarlo con la misma carpeta. La sala debe abrir pausada. Reanudar desde Docente y comprobar drenaje; las pruebas y el script corto contrastan los mismos IDs, orden, contadores e ingresos con una ejecución sin reinicio. Para una caída forzada se acepta únicamente lo contenido en el último snapshot.

Las credenciales de cada rol requieren sesiones separadas (otro perfil/incógnito o cerrar sesión entre roles). La auditoría de IDs se hace mediante la API autenticada descrita arriba; no existe una nueva pantalla de diagnóstico para jugadores.

## 12. Límites para siguientes entregas

Sin fidelización individual entre empresas, Producto/UX completo, nuevos incidentes, rollback, retries automáticos, semántica configurable de Queue/Lock/Cache/Idempotency ni resolución automática de reservas/compensaciones. Las tres suites heredadas siguen siendo agregadas. LAST-UNIT permanece como fixture independiente de capacidad. Las decisiones transaccionales pendientes son visibles en datos/recibos, sin inventar devolución o venta. La retención de recibos en disco, el journal de ticks, la medición de FPS/red de aula y el balance con participantes requieren trabajo posterior. Ninguna de estas limitaciones se disfraza como una funcionalidad terminada.
