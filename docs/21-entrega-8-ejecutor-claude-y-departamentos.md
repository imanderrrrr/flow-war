# Entrega 8 — Claude como ejecutor de órdenes y departamentos completos

## Base, rama y etapas

- Rama única: `codex/flow-war-integracion-entrega-8`, PR #5. Base: `59ba9510a3a089ef094180ed106176eb42810daf`
  (contiene `develop`, Entregas 6 y 7 y los PR #3 y #4). No se tocó `main` ni `develop`; no se crearon ramas ni PR.
- Commits por etapa:

| Etapa | Commit | Contenido |
| --- | --- | --- |
| 1 | `425d195` | Auditoría y matriz de brechas ([doc 20](20-entrega-8-auditoria-y-brechas.md)). |
| 2 | `6596c72` | Ejecutor estricto: herramientas por rol, verificación de valores, respuestas fijas; retiro de propuestas de Claude. |
| 3 | `aade411` | SDK oficial con *tool calling*, endpoint `/api/ai/execute`, consumo y concurrencia, consola por rol. |
| 4 | `924e25f` | DevOps/SRE: alcance del CTO, solicitudes, escalado, servidores, staging, despliegue, rollback; consola CTO. |
| 5 | `543aa23` | Producto/UX opcional con catálogo neutral y pipeline completo. |
| 6 | este commit | Pruebas adversariales, verificación real (Test I), benchmarks y documentación. |

## 1. Claude no opina: tres capas

La regla está implementada en el prompt, en las herramientas y en el servidor. Las dos últimas no dependen de que
el modelo obedezca.

1. **Prompt** (`EXECUTOR_SYSTEM`, `server/executor.ts`): Claude solo traduce órdenes explícitas a llamadas de
   herramientas. No responde con texto, no recomienda, no evalúa y no completa valores. Ante decisiones delegadas
   o datos faltantes llama `solicitar_dato`; ante consejo, otro rol o temas ajenos, `rechazar_instruccion`.
2. **Herramientas**: cada rol recibe un catálogo exclusivo con esquemas estrictos (`strict: true`,
   `additionalProperties: false`). No existen herramientas de otros departamentos, de FlowSlack, de sala, SQL,
   código ni estado. Una herramienta fuera del catálogo del rol se rechaza y **no** genera infracción.
3. **Servidor**: cada valor que llega en una llamada debe estar escrito por el estudiante. El modelo copia los
   fragmentos (`citas`); `server/grounding.ts` comprueba que cada cita exista literalmente en la instrucción y que
   el valor aparezca en ella (cifras o números escritos en español, montos, minutos/segundos/milisegundos,
   estrategias, bloques, controles, IDs). Si no, la operación no se ejecuta y se pide el dato. Las instrucciones
   previas del mismo hilo solo cuentan cuando la orden se refiere a ellas ("los parámetros que te indiqué").

El texto del modelo nunca llega al estudiante. Todas las respuestas las compone el servidor a partir del
resultado del motor:

| Situación | Respuesta del servidor |
| --- | --- |
| Operación ejecutada | Hecho factual: "Servidor agregado · 2 en servicio.", "Revisión CH-004 enviada a Seguridad…". |
| Rechazo del motor | El error del motor: "Presupuesto operativo insuficiente.", "No existe autorización vigente." |
| Decisión delegada | "No puedo elegir una solución por vos. Indicá qué modificación querés realizar." |
| Falta un dato | "Falta indicar la estrategia (ROLLING o RESTART REPLACE). No se ejecutó nada." |
| Pedido de consejo | "No doy recomendaciones ni evaluaciones. Puedo mostrar los datos registrados; la elección corresponde a {rol}." más datos objetivos si se pidieron. |
| Otro departamento | "Esa operación no pertenece a {rol}. No se ejecutó nada." |

Se retiraron `backend.propose` (Claude diseñaba grafos), `security.propose` (Claude redactaba protecciones),
la inyección de defectos `ai-variation-1`, `qa.interpret` y `cto.interpret`. Los borradores de Claude guardados
por versiones anteriores ya no pueden aplicarse. `security.compile` se conserva porque interpreta el texto que
escribió el estudiante; ahora descarta reglas cuyos umbrales u orígenes no estén en ese texto.

## 2. Flujo obligatorio

`POST /api/ai/execute` (`server/index.ts`, `server/executor-service.ts`):

1. El estudiante envía la orden (y su selección en pantalla, que resuelve "este cambio", "este bloque").
2. Empresa, usuario, rol y partida salen de la cookie de sesión; el cuerpo no puede elegirlos.
3. Se registra la orden humana de forma durable antes de cualquier red y se arma solo el contexto autorizado
   del rol (sin defectos, otras empresas, incidentes futuros ni credenciales).
4. Claude interpreta mediante *tool calling* (fuera de toda transacción; la simulación sigue corriendo).
5. Llamadas válidas → planes; cualquier llamada sin respaldo, delegada o ajena anula toda la orden.
6. Se revalida sesión y generación, y que el recurso objetivo no cambió durante la llamada (estado del cambio,
   versión de producción, servidores; las revisiones de borradores las valida el propio motor).
7. Cada operación entra por el **mismo pipeline de comandos que la interfaz** (`action.execute` con
   `source: 'agent'` y `correlationId`): permisos, validación, idempotencia y group commit.
8. El ACK llega después del COMMIT. Los ID de operación derivan del ID de la orden: un reintento no ejecuta dos veces.
9. La respuesta factual, el estado y el consumo de tokens se guardan en el hilo del estudiante.

## 3. Integración Anthropic

`server/claude.ts` usa `@anthropic-ai/sdk` 0.132.0 (fijado; publicado hace más de dos semanas).

| Variable | Defecto | Uso |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | — | Solo en el entorno del servidor. Nunca llega a logs, respuestas, snapshots ni frontend. |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | Modelo con *tool calling* estricto. |
| `ANTHROPIC_WORKSPACE_ID` | — | Cabecera de workspace si la credencial lo requiere. |
| `FLOW_AI_EFFORT` | `low` | Esfuerzo del razonamiento adaptativo (las órdenes son cortas). |
| `FLOW_AI_MAX_TOKENS` | 4096 | Límite por respuesta. |
| `FLOW_AI_CONCURRENCY` / `FLOW_AI_COMPANY_CONCURRENCY` | 5 / 2 | Llamadas simultáneas totales y por empresa, con cola round-robin. |
| `FLOW_AI_QUEUE_LIMIT` | 30 | Cola total (6 por empresa). |
| `FLOW_AI_TIMEOUT_MS` / `FLOW_AI_PROVIDER_TIMEOUT_MS` | 30000 / 20000 | Espera total y plazo del proveedor. |
| `FLOW_AI_TOKEN_BUDGET` / `FLOW_AI_COMPANY_TOKEN_BUDGET` | 3 000 000 / 600 000 | Techo de tokens por partida y por empresa. |
| `FLOW_AI_FALLBACKS` | 1 | Reintento del servidor de Anthropic en otro modelo si un clasificador rechaza. |

- Herramientas estrictas, `tool_choice: auto` (los modelos actuales rechazan el uso forzado), prompt de sistema
  con `cache_control`, sin prefill. Una respuesta sin llamadas ejecuta nada.
- Errores tipados del SDK → códigos (`AUTHENTICATION_ERROR`, `RATE_LIMIT`, `TIMEOUT`, `REFUSED`,
  `INVALID_OUTPUT`, `PROVIDER_ERROR`); el cuerpo remoto nunca se reenvía. Un reintento para 429/502/503/529 si
  `Retry-After` ≤ 5 s.
- Cancelación por logout, reinicio o fin de sala; una llamada cancelada retiene su cupo hasta que el transporte termina.
- Consumo real (`input/output/cache tokens`) por empresa, persistido con la partida y visible para el docente.
- `POST /api/ai/diagnose` (docente) verifica que el modelo devuelve una llamada de herramienta.

## 4. Herramientas por rol

| Rol | Herramientas de ejecución | Datos (`consultar_datos`) |
| --- | --- | --- |
| Backend | agregar/quitar bloque, conectar, insertar antes de, desconectar, fijar parámetro, guardar, entregar | borrador, bloques, devoluciones |
| Seguridad | agregar/quitar control (Auth, Role Check, WAF, Bot Detection, IP Block, Rate Limit) en un bloque, entregar a QA, observación literal a Backend | revisión, controles |
| QA | ejecutar suite nombrada, escenario con cantidades explícitas, repetir prueba, aprobar por orden explícita, carta de devolución con textos literales | cambios, pruebas, suites |
| CTO | decidir cambio, autorizar infraestructura, rechazar solicitud, autorizar rollback, priorizar | finanzas, cambios, decisiones, solicitudes, versiones, incidentes |
| DevOps/SRE | escalar, balanceador, solicitar presupuesto, desplegar, rollback, detener/iniciar servidor, reiniciar, detener/recuperar servicio, modo de mantenimiento | infraestructura, presupuesto, despliegues, estrategias, staging, rollback |
| Producto/UX | crear borrador del catálogo, enviar a QA | embudo, catálogo, borradores, campañas |

Comunes a todos: `consultar_datos`, `solicitar_dato`, `rechazar_instruccion`. Ninguna herramienta escribe en
FlowSlack ni actúa sobre otra empresa.

## 5. Departamentos

### Backend
Ediciones explícitas sobre el borrador con revisión optimista (`draft.save`). Agregar un bloque no lo conecta;
quitarlo no reconecta otros bloques; conectar desde un bloque que ya tiene salida se informa y no se ejecuta.
Los parámetros usan los rangos de `server/blocks.ts`. Entregar sigue el pipeline existente Backend → Seguridad →
QA. El editor visual ya no sobrescribe cambios locales sin guardar cuando el servidor tiene una revisión nueva.

### Seguridad
Nuevo comando `security.configure` (interfaz y Claude): controles estructurados por bloque. El texto guardado
describe exactamente las reglas. Una configuración defectuosa conserva sus consecuencias en QA y producción.

### QA
Sin cambios en el motor de pruebas. Claude ejecuta la suite nombrada (`qa.execute` con el escenario de esa suite)
o un escenario con cantidades escritas por el estudiante; el informe final lo escribe el servidor con los datos
del motor. Aprobar requiere una orden explícita y registra el texto del estudiante y todos los fallos conocidos.
La carta de devolución solo acepta textos literales del estudiante.

### CTO
Consola con capital, reservado, presupuesto operativo, disponible, gasto operativo por minuto, reputación,
mercado, incidentes observados, bandeja de cambios aprobados por QA, solicitudes de DevOps, alcance de
infraestructura, autorización de rollback e historial de decisiones. Autorizar reserva o mueve dinero; no
despliega. Priorizar solo cambia la prioridad registrada.

### DevOps / SRE
- **Alcance**: escalar y configurar el balanceador exige una autorización vigente del CTO con monto, duración,
  operaciones y máximo de servidores. La inicial es idéntica para las cinco empresas y cubre solo la
  infraestructura mínima (un servidor, sin operaciones). `cto.budget` heredado crea un alcance completo hasta el
  final de la partida. Al vencer, los servidores ya aprovisionados siguen funcionando con su costo.
- **Solicitudes**: `infra.request_budget` (monto, duración, operaciones, máximo); el CTO autoriza o rechaza.
- **Infraestructura visual**: ENTRADA → BALANCEADOR → SERVIDORES → SERVICIOS/DATOS con estado real por servidor
  (ONLINE, REINICIANDO, DETENIDO, SIN TRÁFICO sin balanceador, SIN CAPACIDAD), capacidad, utilización y costo.
- **Servidores**: detener deja el servidor aprovisionado y con costo, sin capacidad; iniciar tarda lo mismo que
  un reinicio (10 s). Quitar servidores no devuelve dinero gastado.
- **Staging**: cambio, artefacto, revisiones, versión base, evidencia QA y estado de autorización del CTO.
  Staging son copias aisladas del motor: no genera dinero, clientes ni ventas.
- **Despliegue**: sin estrategia preseleccionada. ROLLING (6 s, capacidad (n−1)/n o 12 % con un servidor) y
  RESTART REPLACE (3 s, capacidad cero), como el motor ya definía. Blue-Green no se ofrece.
- **Rollback real**: el CTO autoriza una versión publicada concreta con un monto (reservado, vigente 60 s);
  DevOps lo ejecuta con la estrategia que elige y sus tiempos. Al completar, una versión nueva restaura los
  grafos y el bundle de ejecución de la versión objetivo, cobra una vez y marca obsoleto el trabajo pendiente.
  No devuelve dinero, clientes ni reputación, y no puede publicar un artefacto que no pasó por QA.
- **Mantenimiento**: reinicios, detención/recuperación de servicios y modos de servicio existentes, con duración
  y efecto real. Claude no fija duraciones: usa las del motor.

### Producto / UX
- Interruptor del docente `room.product`, solo en LOBBY y para las cinco empresas; se conserva al reiniciar la
  sala. Desactivado, sus órdenes devuelven `PRODUCT_DISABLED` sin infracción.
- Embudo observado del tráfico legítimo de producción (visitas, entradas a checkout, compras, abandonos,
  rechazos, motivos de salida) en ventanas de 10 s con tamaño de muestra; satisfacción derivada de experiencias
  atendidas y fidelidad media de clientes propios. El tráfico de QA nunca cuenta.
- Catálogo neutral, ordenado por ID: PROMO-01 (todos) y PROMO-02 (clientes nuevos), con los parámetros y efectos
  que el motor ya implementa. Costo de publicación Q100 + presupuesto.
- `product.draft` y `product.submit`: enviar a QA congela la configuración en un cambio `product`. QA lo prueba
  en staging con la promoción aplicada; CTO autoriza; DevOps despliega y recién entonces la promoción se activa.
  Los atajos `campaign.*` se rechazan. Una promoción mal planificada puede vender por debajo del costo y saturar
  colas.

## 6. Comunicación, disciplina y aislamiento

Claude no participa en FlowSlack y no envía mensajes por iniciativa propia; solo la observación de Seguridad y la
carta de QA, con texto literal y orden explícita. Las infracciones siguen saliendo exclusivamente de comandos
reales rechazados por rol o empresa: una interpretación de Claude nunca suma una infracción. Cinco infracciones
expulsan sin reemplazo. El contexto enviado al proveedor contiene solo la empresa y el rol de la sesión.

## 7. Persistencia y rendimiento

Todo el estado nuevo es aditivo al esquema 6 y se guarda en la misma transacción. Las partidas guardadas antes de
Entrega 8 conservan un alcance de infraestructura permisivo (comportamiento previo). DVR OFF sigue siendo el modo
principal; los proyectos DVR anteriores se leen sin cambios. Resultados en
[benchmarks/entrega-8](benchmarks/entrega-8/README.md).

## 8. Pruebas obligatorias

| Prueba | Dónde |
| --- | --- |
| A instrucción concreta, una sola vez | `tests/executor.test.ts` (Test A), `tests/executor-service.test.ts`, `tests/executor-server.test.ts` |
| B decisión delegada | `tests/executor.test.ts` (Test B), servidor real |
| C pedido de consejo | `tests/executor.test.ts` (Test C) |
| D mala decisión válida | `tests/executor.test.ts` (Test D) |
| E sin autorización | `tests/executor.test.ts` (Test E), servidor real |
| F resultado QA | `tests/executor.test.ts` (Test F), `tests/executor-service.test.ts` |
| G aislamiento | `tests/executor.test.ts` (Test G), servidor real |
| H concurrencia | `tests/executor-service.test.ts` (Test H), `npm run bench:executor`, `npm run bench:ai` |
| I Anthropic real | `npm run verify:anthropic` — **pendiente: este entorno no tiene credenciales** |

Además: adversariales (inyección, citas inventadas, valores ausentes, verbos contradictorios, más de cuatro
llamadas), disciplina, FlowSlack, equivalencia exacta entre órdenes por Claude y por panel, DevOps (alcance,
reembolsos, servidores, rollback, vencimientos, privacidad) y Producto (interruptor, staging, devolución,
consecuencias económicas, embudo, órdenes por Claude).

## 9. Bloqueos y riesgos pendientes

- **Anthropic real no verificado aquí**: no hay `ANTHROPIC_API_KEY`. Las pruebas usan transportes simulados o un
  servidor local que imita la API de Messages; demuestran el contrato, no la comprensión del modelo. Ejecutar
  `npm run verify:anthropic` con credenciales (Test I: casos A–H, ejemplos obligatorios, latencia, tokens y
  ausencia de la clave en las salidas).
- **Verificación léxica**: depende de que el modelo copie las citas. Si no lo hace, la orden se rechaza y se pide
  el dato (falla segura). Expresiones numéricas poco comunes pueden requerir reformular.
- **Fórmulas no definidas** (no inventadas): costo y duración propios de rollback (los fija el CTO y la
  estrategia), Blue-Green, funcionalidades de Producto sin efecto en el motor, costo de un servidor detenido
  (se mantiene Q0.50/s).
- **Memoria**: el pico de memoria del proceso subió en el benchmark de aula (ver benchmarks); latencias y CPU
  quedaron dentro del ruido.
- Las promociones activas no se cancelan con un rollback (son eventos comerciales separados de los grafos).

## 10. Verificación

```sh
npm test
FLOW_GROUP_COMMIT=0 npm test
npm run build
npm run bench:ai
npm run bench:executor -- --speed=20 --model-ms=800 --rounds=4
npx tsx scripts/collaboration-classroom.ts --students=25 --duration=1200 --speed=20 --dvr=off --label=mi-aula
npm run verify:anthropic   # requiere ANTHROPIC_API_KEY en .env
```
