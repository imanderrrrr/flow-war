# Entrega 8 — Etapa 1: auditoría y matriz de brechas

## Base auditada

- Rama de trabajo única: `codex/flow-war-integracion-entrega-8` (PR #5, borrador, base `develop`).
- HEAD auditado: `59ba9510a3a089ef094180ed106176eb42810daf`. Contiene por ascendencia `origin/develop`
  (`c57bfb7`), la Entrega 6, la Entrega 7 (`e6d37fe`) y las optimizaciones de los PR #3 y #4.
- Línea base de pruebas en ese HEAD: `npm test` → **327/327** en 54 s (Node 25.9, macOS).
- Sin credenciales de Anthropic en este entorno: no existe `.env`, `ANTHROPIC_API_KEY` ni perfil `ant`.

Se leyeron `server/{engine,claude,ai-service,ai-scheduler,workflow,collaboration,qa,infrastructure,
business,maintenance,discipline,action-validation,agents,artifacts,command-pipeline,index}.ts`,
`shared/{types,actions,simulation,workflow,collaboration,blocks}.ts`, la interfaz `src/{App,TeamConsole,
ClaudeAssistant,ClaudeStatus,OperationsPanel,GraphEditor,SecurityEditor,store}.tsx` y los documentos
01, 02, 03, 11, 17, 18 y 19.

## Hallazgos que contradicen la regla "Claude no opina"

| Ubicación | Comportamiento actual | Por qué viola Entrega 8 |
| --- | --- | --- |
| `server/claude.ts` `SYSTEM` + `backend.propose` | Claude genera un grafo Backend completo a partir de una petición libre. | Claude decide qué bloques usar y diseña la arquitectura. |
| `server/claude.ts` `proposalVariation` (`ai-variation-1`) | Inserta defectos deliberados en las propuestas de Claude. | Depende de que Claude proponga soluciones; deja de tener sentido sin propuestas. |
| `security.propose` | Claude redacta texto de protección para un bloque. | Recomienda qué protección usar. |
| `qa.interpret` | Completa con valores por defecto los parámetros no indicados. | Completa una decisión ambigua con criterio propio. |
| `cto.interpret` | Prepara decisiones a confirmar; el estudiante confirma con `ai.confirm`. | Correcto en intención, pero no usa herramientas ni ejecuta la orden explícita. |
| Proveedor | `output_config.format` (JSON) sin *tool calling*; `fetch` manual. | Entrega 8 exige herramientas estructuradas de ejecución. |

Ninguna respuesta libre del modelo llega hoy al estudiante: los mensajes los compone el servidor. Esa
propiedad se conserva.

## Matriz de brechas por área

| Área | Implementado y verificado | Incompleto | Ausente |
| --- | --- | --- | --- |
| Integración Anthropic | Clave/modelo por entorno, estados `MISSING_*`, diagnóstico de operador, *timeouts*, cancelación, reintento acotado, planificador round-robin por empresa, límites por usuario/empresa, recibos idempotentes, revalidación tras la red. | Sin SDK oficial; sin *tool calling*; sin presupuesto de tokens por partida/empresa; una sola llamada activa por empresa. | Ejecutor estricto con herramientas por rol; verificación de que cada parámetro aparece en la instrucción humana; mensajes operativos fijos. |
| Backend | Editor de grafo, borrador con revisión optimista, entrega a Seguridad, bloqueo `purchase-flow`, módulos 4A. | Claude solo genera grafos completos. | Herramientas para agregar/quitar bloque, conectar/desconectar, insertar antes de otro bloque, fijar parámetro explícito, guardar y entregar. |
| Seguridad | Protecciones por bloque en texto libre interpretado a reglas (`authenticated`, `owner`, `input`, `bot`, `origin`, `rate`), observaciones a Backend, entrega a QA. | `security.propose` recomienda texto. | Configuración estructurada de controles (Auth, Role Check, WAF, Bot Detection, IP Block, Rate Limit) por bloque, ejecutable por UI y por Claude. |
| QA | Bandeja, trabajos aislados con el motor real, evidencia por ejecución, repetición con semilla, cartas formales con bloqueo/desbloqueo, aprobación con riesgos escritos. | Claude prepara escenarios rellenando valores. | Ejecución de suites nombradas por instrucción, envío de carta con campos literales del estudiante, aprobación explícita sin dictamen de IA. |
| CTO | Decisiones con motivo, órdenes de inversión, presupuesto fijo +250/+500/+1000, prioridad. | Panel sin gasto operativo, reputación, mercado, incidentes ni historial de decisiones consolidado. | Autorización de infraestructura con monto, duración, operaciones y máximo de servidores; respuesta a solicitudes de DevOps; autorización de rollback a versión específica; herramientas de Claude. |
| DevOps/SRE | Escala ±1 (1–8), balanceador con efecto real en capacidad y colas, reinicio por servidor/total, detención/recuperación de servicios, modos de mantenimiento, despliegue Rolling (6 s) y Restart Replace (3 s) con capacidad real. | La vista marca ONLINE a servidores inaccesibles sin balanceador; sin capacidad, utilización ni costo por servidor; escalar solo exige saldo, no alcance autorizado. | Solicitud de presupuesto al CTO; alcance por operación y máximo de servidores; vista de staging; rollback; detención/arranque de un servidor; herramientas de Claude. |
| Producto/UX | Campañas con descuento, duración, presupuesto y multiplicador de demanda sobre clientes existentes; propuestas registradas. | Producto activa campañas directamente (salta QA y DevOps); sin interruptor de partida. | Activación simétrica antes de iniciar; embudo y satisfacción observados; catálogo neutral; borradores; cambios `product` por QA → CTO → DevOps; prueba QA con la promoción aplicada. |
| Disciplina | Cinco infracciones confirmadas expulsan; `OUT_OF_ROLE`/`CROSS_COMPANY` solo por comandos reales. | — | Garantía explícita de que una interpretación de Claude nunca crea una infracción. |
| Persistencia y rendimiento | Group commit, ACK después de COMMIT, idempotencia por identidad/ID, recuperación tras SIGKILL, DVR configurable. | — | Las operaciones de Claude deben entrar por el mismo pipeline de comandos. |

## Fórmulas existentes que se reutilizan sin inventar valores

- Operación de servidor: Q0.50/s por servidor aprovisionado (doc 03 §10; `engine.step`).
- Capacidad: web 12/s y checkout 5/s por servidor accesible; sin balanceador solo el servidor 1 es accesible.
- Restart Replace: capacidad de aplicación cero durante 3 s. Rolling: 6 s con capacidad `(n−1)/n` (0.12 con un servidor).
- Publicación: base Q100 más el costo de las piezas.
- Campaña: descuento 0–70 %, duración 10–300 s, presupuesto Q1–2,000, multiplicador de llegadas 1–4 sobre los clientes propios.
- Autorizaciones de cambio vigentes 60 s; órdenes de inversión 300 s.

## Bloqueos de especificación detectados

| Mecánica | Falta en la especificación | Decisión de esta entrega |
| --- | --- | --- |
| Costo de rollback | No hay fórmula; el diseño dice "monto independiente" autorizado por CTO. | El CTO fija el monto al autorizar. Se reserva y se cobra al completar. Sin monto, no hay rollback. |
| Duración de rollback | No definida. | Se ejecuta con la estrategia que elige DevOps y sus tiempos ya definidos (3 s / 6 s). |
| Blue-Green | Definido como posterior al MVP sin reglas de costo de la segunda generación. | No se ofrece como opción. |
| Funcionalidades de Producto distintas de promociones | Sin efectos definidos en el motor. | El catálogo solo contiene opciones con efectos implementados. |
| Satisfacción | Sin fórmula propia. | Se presenta derivada de experiencias atendidas: éxitos, fallos y abandonos observados con tamaño de muestra. |
| Costo de detener un servidor | No definido. | Un servidor detenido sigue aprovisionado y conserva el costo Q0.50/s existente. |

## Orden de implementación

1. Ejecutor estricto: prompt, herramientas por rol, verificación de parámetros contra la instrucción y
   mensajes fijos del servidor; retiro de `backend.propose`, `security.propose` y `ai-variation-1`.
2. SDK oficial, *tool calling*, presupuesto de tokens, concurrencia configurable por empresa y ejecución
   por el pipeline de comandos.
3. DevOps: alcance presupuestario, vista real de infraestructura, staging, rollback y operaciones por servidor.
4. CTO: panel completo, alcance de infraestructura, solicitudes y rollback.
5. Producto/UX con su pipeline.
6. Pruebas A–I, adversariales, economía, concurrencia, recuperación y rendimiento.
