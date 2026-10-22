# Entrega 7 — QA, CTO y asistentes por empresa

## Base y auditoría inicial

Base de integración consultada mediante `git fetch origin`: `c57bfb7a64bf429bfa44dca4b5ead170a197372e` (`origin/develop`). PR [#1](https://github.com/imanderrrrr/flow-war/pull/1) abierto, en borrador, dirigido a `develop`, sin fusionar; dependencia `codex/entrega-6-backend-security-ai` en `e79a53e5c18bb3562365180c7e0095494c90a617`. La rama `codex/entrega-7-qa-cto-team-ai` parte de esa dependencia. El PR de esta entrega se dirige temporalmente a Entrega 6. No se autoriza ni realiza ninguna fusión o modificación de `main`.

Se inspeccionaron `server/engine.ts`, `qa.ts`, `collaboration.ts`, `claude.ts`, `ai-service.ts`, `security.ts`, `artifacts.ts`, `index.ts`, `persistence.ts`; `shared/actions.ts`, `collaboration.ts`, `simulation.ts`; y `src/App.tsx`, `GraphEditor.tsx`, `SecurityEditor.tsx`, `ClaudeAssistant.tsx`, `OperationsPanel.tsx`.

Hallazgos reutilizados:

- `createTestJob` ya crea una copia aislada y ejecuta el motor real de compras y tráfico. `testReport` calcula resultados a partir de solicitudes terminadas. No se añadió un motor alternativo.
- La combinación Backend/Seguridad ya tiene digests comprobados en QA, autorización y despliegue; los módulos de ejecución contienen defectos internos que nunca se envían a Claude.
- `beginSecurityReview` permitía sustituir entregas previas. Faltaba bloquear borradores, módulos y aceptación de propuestas después de entregar.
- El proveedor Anthropic ya utilizaba JSON Schema, pero solo aceptaba solicitudes Backend/Seguridad; el gateway rechazaba llamadas al superar dos activas globales. No había hilos persistentes ni planificador justo.
- El contrato económico existente reserva al autorizar y cobra al publicar. Se conserva ese momento de gasto y la recuperación transaccional SQLite.

## Laboratorio QA

La interfaz principal de QA es una conversación por hilo. Una solicitud `qa.interpret` produce un `TestScenario` validado o una aclaración neutral sobre parámetros faltantes. El modelo recibe instrucciones para interpretar lenguaje informal y referencias a pruebas anteriores, sin explicar defectos ni sugerir soluciones. No se usan diccionarios de frases memorizadas en producción.

El estudiante inspecciona los parámetros y confirma. El servidor comprueba sesión, empleo activo, empresa, generación, rol, versión y estado; inicia un trabajo QA en la copia aislada. Los escenarios admiten hasta 500 solicitudes, inventario 0–2000, concurrencia hasta el número de solicitudes, cinco fallos de transporte/reintentos configurables y contextos de sesión, propiedad, automatización e inyección. El tráfico permanece dentro del simulador.

La evidencia conserva empresa, generación, autor, versión funcional, revisión de protección, digest de combinación, petición original, escenario interpretado, semilla, tiempos, resultados y secuencia de operaciones. Las identidades `qa-N` son sintéticas. Los reclamos visibles derivan exclusivamente de estados rechazados o abandonados. Las cifras de cobro, sobreventa, ataques y latencia se calculan con solicitudes terminadas. Los campos explícitos de sesión, propiedad, entrada y automatización se respetan aunque el escenario no tenga etiqueta de ataque; un rechazo adversarial no se registra como falso positivo, incluso en la suite de carga. La respuesta final de la conversación se construye en el servidor con esas cifras; nunca se acepta prosa del modelo como resultado del laboratorio.

El visor permite seleccionar pruebas, inspeccionar solicitudes, reproducir y desplazar la secuencia de eventos, y repetir la misma combinación y semilla. Una repetición conserva otro ID y su referencia `repeatOf`; una versión archivada recupera su estado anterior al terminar la reproducción y no adquiere permisos para aprobarse o editarse. Las suites históricas siguen disponibles y la configuración manual queda en un panel avanzado. Una suite rápida que corre en staging registra su corrida igual que un caso manual, así que se puede seleccionar como evidencia con las mismas validaciones del servidor; las fixturas históricas de Concurrencia y Carga sobre una versión sin módulos ni controles producen solo un reporte, y el visor lo dice.

Los eventos y solicitudes completos se guardan una vez en los reportes persistentes del cambio. Los snapshots llevan resúmenes; el visor obtiene el detalle mediante `GET /api/qa/runs/:id`, autorizado por la empresa de la sesión y la generación actual. La evidencia QA también persiste con DVR apagado.

## Cartas y bloqueo por funcionalidad

`purchase-flow` es actualmente la única funcionalidad ejecutable. `backendLock` identifica esa funcionalidad y el cambio congelado; el contrato permite ampliar el mapa de funcionalidades en otra entrega. El servidor rechaza `draft.save`, `change.submit`, `module.create`, `module.revise`, aceptación de IA y preparación de nuevas propuestas Backend mientras exista el bloqueo. Esto incluye conexiones, parámetros y módulos enlazados. Seguridad no puede modificar lógica Backend.

La carta `qa.return` es redactada por el estudiante. Se exigen destinatario, asunto, problema, pasos, observado, esperado y gravedad. Se conservan exactamente sus textos. Autor, momento, empresa y versiones proceden del servidor. Las referencias adjuntas se comprueban contra pruebas reales terminadas de la combinación correspondiente; se pueden adjuntar observaciones previas de Seguridad. La plataforma no escribe conclusiones o cartas mediante IA.

| Transición | Estado y permisos resultantes |
| --- | --- |
| Backend entrega | `SECURITY_PENDING`; Backend bloqueado |
| Seguridad entrega | `QA_PENDING`; Backend y protección entregada congelados |
| QA ejecuta | `QA_RUNNING` en staging; después `QA_PENDING` |
| QA aprueba | `CTO_PENDING`; se conserva evidencia seleccionada, fallos y riesgos escritos |
| CTO pide evidencia o rechaza | vuelve a `QA_PENDING` con motivo persistente; Backend permanece bloqueado |
| CTO autoriza | `AUTHORIZED`, reserva financiera y autorización de 60 segundos |
| Autorización vence | `EXPIRED`; libera la reserva del cambio; CTO puede reevaluar o QA devolver/cancelar |
| QA devuelve a Backend | original conservado; desbloquea borrador copiado y enlaza la siguiente revisión |
| QA devuelve a Seguridad | original conservado; crea cambio sucesor con igual versión Backend y nueva revisión de protección; Backend sigue bloqueado |
| QA cancela formalmente | transición terminal auditada con motivo y confirmación; libera la entrega y su reserva |
| Despliegue | cobra una vez al completarse; la funcionalidad sigue congelada hasta nueva devolución QA |
| Fin/reinicio de partida | libera compromisos y termina la generación; la nueva generación empieza sin hilos ni bloqueos heredados |

Una observación de Seguridad no desbloquea Backend. Una orden de inversión tampoco lo desbloquea. Una devolución repetida del mismo cambio se rechaza. Las gráficas y los reportes originales permanecen disponibles para auditoría.

Las acciones históricas `qa.approve` y `cto.authorize` siguen funcionando como decisiones manuales explícitas para compatibilidad con clientes anteriores; generan registro de decisión y referencias a resultados reales. La nueva interfaz usa evaluación escrita y confirmación del CTO. `qa.reject` ya no sustituye una carta cuando existe implementación compartida.

## CTO, órdenes y contabilidad

El CTO consulta capital, presupuesto operativo, compromisos, costos de cambios, evidencia, decisiones y órdenes. El contexto contiene solo la empresa de la sesión y proyecciones sin defectos secretos. El modelo extrae `query`, `authorize`, `reject`, `evidence` o `investment`. Las consultas se presentan con datos del servidor. Las otras intenciones son propuestas pendientes: únicamente `ai.confirm` del CTO, con confirmación explícita, puede ejecutar la decisión; su estado, parámetros y saldo se validan nuevamente. Un fallo del proveedor nunca ejecuta decisiones.

`cto.decide` conserva el motivo escrito por el estudiante. Una petición de evidencia aparece en QA; el estudiante decide qué prueba ejecutar. Las evaluaciones QA conservan todos los IDs fallidos conocidos además de la selección de evidencia: aprobar no borra resultados.

Las órdenes contienen ID, empresa, CTO, departamento Backend/Seguridad, objetivo y justificación del CTO, máximo, reserva, gasto, estado, fecha, vencimiento y cambio relacionado opcional. Flujo: `REQUESTED → AUTHORIZED → IN_PROGRESS → COMPLETED`; cancelación desde un estado abierto. Crear y autorizar son decisiones explícitas. El destinatario inicia su trabajo y vincula la entrega mediante `investment.link`; no elige soluciones desde el documento de inversión.

Contrato económico:

- Disponible = capital menos presupuesto operativo menos reservas. Crear una orden no cobra; autorizarla reserva su máximo.
- Una orden financia una implementación vinculada. Al autorizar el cambio se reutiliza la reserva de la orden; se prohíbe exceder el máximo y reservar dos veces el mismo costo.
- El capital se debita únicamente al completarse el despliegue real. La orden registra cuánto de su reserva financió ese cargo. No hay cargos arbitrarios, premios ni rentabilidad prefijada.
- Completar la orden requiere el despliegue correspondiente y libera sobrantes. Cancelar/vencer libera fondos no gastados; los gastos previos no se reembolsan ficticiamente.
- No se cancela la financiación de una publicación autorizada/en curso sin una transición formal de QA. La reserva vinculada no vence durante esa publicación.
- Una orden vencida, cerrada o una autorización ya usada no puede cobrar otra vez. El despliegue vuelve a validar respaldo financiero; si deja de existir, falla sin publicar ni debitar.

Las órdenes de investigación que no producen una implementación publicada pueden cancelarse y liberar su reserva; esta entrega no inventa costos de mano de obra ni pagos por resultados inexistentes. Los departamentos futuros pueden ampliar el contrato; no se implementa un laboratorio DevOps nuevo ni rollback.

## Cinco asistentes, memoria y contexto

Hay cinco espacios lógicos, almacenados en `CompanyRuntime`. Los hilos incluyen `companyId`, generación, actor, rol e ID de conversación. Los snapshots públicos excluyen presupuesto operativo y reservas; la empresa los consulta en su vista privada y el docente conserva su acceso autorizado. La empresa se obtiene de la sesión; el cliente no puede elegir otra. Las propuestas y aceptaciones verifican autor, generación y versión. Los mensajes privados de otro rol no se utilizan como historia, aunque ciertos artefactos del equipo sean compartidos por permisos.

Se conserva el texto humano incluso cuando el proveedor falla. Las respuestas, referencias y resultados del motor son persistentes. Un reinicio marca solicitudes pendientes como `INTERRUPTED`; no las reenvía silenciosamente ni ejecuta acciones a posteriori. El alumno puede reintentar con la misma intención y revisar el estado. Las solicitudes de una generación cerrada no pasan a la siguiente. Cierre de sesión, cancelación, fin y reinicio cancelan trabajo pendiente; una respuesta tardía también se revalida antes de almacenarse.

El contexto del proveedor incluye los últimos ocho mensajes (máximo 1200 caracteres por mensaje), hasta seis resúmenes reales de pruebas, doce cambios, tres cartas y ocho órdenes. Los textos de artefactos se resumen a campos de hasta 400 caracteres con sus referencias; los originales siguen disponibles. Se rechaza un contexto que exceda 48,000 caracteres antes de contactar al proveedor. No envía 5000 clientes, estado interno de defectos ni reportes masivos. Los resúmenes son proyecciones deterministas de datos guardados; no se inventa memoria mediante otra respuesta generativa. Se conservan los originales. Los snapshots muestran las últimas veinte entradas por hilo; `GET /api/ai/conversation/:id?before=N` permite consultar páginas anteriores de cuarenta entradas con los mismos permisos. Límite actual: ocho hilos por usuario, 800 mensajes por hilo, 240 propuestas y 480 intentos por empresa y generación; al alcanzarse se informa y no se eliminan originales.

Los textos de tickets, bloques y mensajes son datos no confiables, no autoridad para cambiar reglas. La salida del proveedor usa un schema cerrado y validación adicional del servidor. No hay herramientas, comandos, ejecución de código ni acceso de red entregados al modelo.

## Planificación y fallos del proveedor

`AiScheduler` mantiene cinco colas, máximo una llamada activa por empresa y un límite global configurable (5 por defecto). La selección round robin evita que una ráfaga de una empresa monopolice los turnos. Una empresa lenta retiene su propio cupo; las demás pueden avanzar. El límite global no garantiza capacidad contratada de Anthropic.

- Un trabajo pendiente por usuario; ocho intentos/minuto por usuario, 32/minuto por empresa; hasta seis trabajos en cola por empresa y treinta globales por defecto.
- Estados visibles: cola, ejecución, completada, fallida, cancelada, timeout e interrumpida tras reinicio. Consulta y cancelación solo ven al actor autenticado; el operador ve métricas.
- Timeout de cola y ejecución por defecto 30 s; proveedor con deadline total 20 s y cancelación propagada al transporte.
- Como máximo un reintento para 429, 529, 502 o 503. Se respeta `retry-after` numérico de hasta 5 s; si exige una espera mayor se devuelve el error sin reintento inmediato. No hay bucles ilimitados ni fallback a mocks.
- Una cancelación no libera el cupo del proveedor hasta que el transporte termina; así un transporte que ignora abort no permite abrir llamadas ilimitadas.
- Métricas de espera, duración, latencia, reintentos y tokens de entrada/salida reales cuando el proveedor los devuelve. Las métricas recientes del planificador son acotadas; propuestas, mensajes y auditoría se conservan con el juego.

## Operación de Anthropic

Copiar `.env.example` a `.env` local y configurar `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` y, si la credencial lo requiere, `ANTHROPIC_WORKSPACE_ID`. `npm run dev` y `npm start` cargan ese archivo mediante Node; `.env` está ignorado. No usar variables `VITE_` para credenciales.

Configuraciones: `FLOW_AI_CONCURRENCY` (1–20, aunque el máximo útil inicial son cinco empresas), `FLOW_AI_QUEUE_LIMIT` (1–120), `FLOW_AI_TIMEOUT_MS` (1–120000 ms); valores inválidos usan el predeterminado. Conservar los límites reales de solicitudes y tokens de la cuenta; reducir capacidad cuando corresponda.

`GET /api/ai/status` para operador distingue `MISSING_CREDENTIALS`, `MISSING_MODEL`, `UNVERIFIED`, `AVAILABLE`, `AUTHENTICATION_ERROR`, `RATE_LIMIT`, `TIMEOUT`, `INVALID_OUTPUT` y fallos de proveedor. `AVAILABLE` solo se obtiene después de una respuesta real válida de Anthropic; la mera presencia de variables no lo establece. `POST /api/ai/diagnose` requiere operador y hace una solicitud pequeña sin modificar la simulación. La consola del docente permite consultar y ejecutar este diagnóstico. Nunca devuelve claves, cabeceras privadas ni el cuerpo del error remoto.

`npm run verify:anthropic` registra estado seguro en `docs/benchmarks/entrega-7/anthropic.json`. Si existen credenciales, prueba interpretación Backend, compilación Seguridad, escenario QA, ejecución del motor y rechazo de referencia de otra empresa; mide tokens y latencia. Sin credenciales termina con `not_run`, sin contactar a un proveedor ficticio.

Referencias oficiales verificadas: [JSON estructurado](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [autenticación y workspace](https://platform.claude.com/docs/en/api/overview), [límites y Retry-After](https://platform.claude.com/docs/en/api/rate-limits).

## Verificación y rendimiento

Los resultados y comandos definitivos están en `docs/benchmarks/entrega-7/README.md`. Las pruebas de IA sin credenciales inyectan transportes explícitos; validan contratos, privacidad, fallos y ejecución, pero no demuestran comprensión lingüística de un modelo real. Los escenarios informales del smoke real solo se certifican cuando se ejecuta con credenciales.

La ruta de latencia histórica contiene `structuredClone` del juego para rollback, serialización del snapshot con 5000 clientes y transacción SQLite `synchronous=FULL` por cada ACK. Una ráfaga serializa ese trabajo durable en el event loop; además el broadcast prepara proyecciones por identidad. Las llamadas a Claude son asíncronas y no mantienen transacciones abiertas mientras esperan red. Esta entrega conserva la durabilidad por comando. El detalle QA se descarga bajo demanda para evitar multiplicar snapshots y el historial enviado al proveedor está acotado. No se atribuyen mejoras a Wi-Fi ni se afirma eliminar el costo de la serialización transaccional.

## Límites y riesgos

Sin credenciales no se certifica disponibilidad, interpretación semántica real ni cuota de Anthropic. La calidad lingüística del modelo y las aclaraciones requieren prueba de aula con la cuenta del operador. Los límites de memoria y el máximo de 500 solicitudes son deliberados y visibles. La visualización reproduce eventos registrados; el staging avanza en trabajos acotados del motor, no en navegadores o tráfico de Internet. Las pruebas locales usan loopback, sin validar Wi-Fi ni FPS de treinta navegadores. El proveedor podría producir una interpretación válida pero distinta de lo pedido; el alumno ve los parámetros antes de confirmar.

La evidencia y las cartas son datos privados de la generación; el operador debe conservar la base SQLite y sus permisos. El nuevo estado es aditivo al schema 6 y se guarda con la misma transacción; servidores de versiones anteriores no deben abrir una partida de Entrega 7. No hay fusión automática del PR dependiente ni promoción a producción.

Vite advierte que el bundle principal supera 500 kB. No impide compilar; queda pendiente dividir el frontend si una medición de dispositivos de aula lo justifica. No se atribuyen garantías de rendimiento a estas capturas de navegador.
