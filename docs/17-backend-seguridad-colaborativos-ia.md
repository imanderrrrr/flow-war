# Entrega 6 — Backend y Seguridad colaborativos con Claude

## Base y alcance

Base: `origin/develop`, SHA `c57bfb7a64bf429bfa44dca4b5ead170a197372e`.
Su antecesor `6289e902eb8a4a114fcfe204fe19379ff1ca50db` es la referencia de Entrega 5.5.
Rama de trabajo: `codex/entrega-6-backend-security-ai`. No se modifica `main` ni se realizan merges.

## 1. Arquitectura anterior

Backend y Seguridad mantenían grafos independientes y enviaban cambios directamente a QA.
Los artefactos operativos existentes ya congelaban módulos, defectos y configuración de ejecución.
El intérprete local de Entrega 4A utilizaba órdenes de fixture, sin integración de Anthropic.

## 2. Modelo compartido

Cada entrega funcional nueva identifica `purchase-flow`, `companyId`, `backendVersion`,
`backendAuthor`, IDs de bloque y un digest del grafo. Seguridad recibe ese mismo grafo.
Las posiciones, conexiones, módulos y parámetros operativos pertenecen a Backend.
Las instrucciones de protección, observaciones y reglas compiladas pertenecen a Seguridad.

La revisión se conserva en `Company.runtime.collaboration.reviews[changeId]`.
Las propuestas de IA tienen autor, empresa, generación, tipo, modelo, proveedor y revisión de borrador.
Ninguna propuesta cambia producción por sí sola.

## 3. Versionado y migración

El contador funcional es independiente de `Company.version`, que identifica releases publicados.
Los IDs de nodos se conservan al guardar, aceptar propuestas y publicar. Los nodos nuevos usan UUID.
Cada entrega posterior invalida las revisiones pendientes anteriores de la funcionalidad, marca sus
reportes obsoletos y libera reservas. Conserva autores, observaciones y evidencia histórica.
No se aceptan nuevas entregas Backend mientras exista un despliegue en curso.

La persistencia mantiene el esquema 6 con campos aditivos opcionales. No reinterpreta releases
históricos ni solicitudes en vuelo. Los cambios históricos sin `implementation` conservan su contrato.
Las importaciones de esquemas 1–5 usan las migraciones existentes y no inventan revisiones de Seguridad.
La interpretación compilada y sus referencias se recuperan sin llamadas a Claude.

El contrato estructurado `security.prepare` se conserva como adaptador de compatibilidad:
revisa el grafo Backend actualmente publicado, vincula su configuración a esa versión y requiere QA,
CTO y DevOps. Ya no aparece como formulario de controles en la interfaz del estudiante.
`change.submit` de Seguridad rechaza reconstrucciones de grafos; la interfaz utiliza revisiones por bloque.

## 4. Backend manual

El editor permite mover piezas, agregar operaciones, conectar, guardar borradores incompletos y
entregar una ruta ejecutable completa. Al entregar, todos los nodos deben estar conectados;
se rechazan ciclos, referencias ajenas, múltiples salidas por puerto y operaciones fuera del catálogo.
El motor ejecuta el orden de las conexiones.

El inspector conserva `data.config` y `data.module`. Presenta parámetros propios de cada operación:
TTL/recurso/adquisición de locks; capacidad de colas; intentos/espera de retry; TTL de idempotencia;
TTL/capacidad/invalidación de caché; mínimo/validación de entrada; cantidad de actualización atómica.
No recomienda configuraciones ni identifica defectos ocultos.
Los artefactos de negocio existentes siguen disponibles y también pasan por Seguridad.

## 5. Inspector de Seguridad

La bandeja permite seleccionar la versión Backend y cualquier bloque de su diagrama.
No permite arrastrar, eliminar, reconectar o editar operaciones funcionales.
El área **PROTECCIÓN DE: [bloque]** empieza vacía y contiene texto libre, guardar/cancelar,
asistencia de Claude y una observación libre para solicitar corrección a Backend.
No contiene checkboxes de controles, soluciones predefinidas, puntuación ni sugerencias de incidentes.

Guardar preserva la autoría y utiliza control de revisión optimista. Entregar requiere una decisión
explícita y confirmación en la interfaz. Se puede entregar sin reglas adicionales.
Solo se entregan las instrucciones previamente guardadas; los cambios locales deben guardarse antes.

## 6. Texto libre → interpretación → motor

Al guardar un texto no vacío, la interfaz solicita `security.compile` al servidor. Claude devuelve una
interpretación estructurada que se valida y almacena como recibo privado. `security.save` solo acepta
ese recibo si coinciden autor, texto exacto, bloque, cambio, generación y revisión del borrador.
Un cliente no puede enviar reglas compiladas directamente en `security.save`.

Las reglas admitidas son autenticación, pertenencia de compra, validación de entrada maliciosa,
rechazo de tráfico automatizado, bloqueo de origen sintético y ventanas fijas por origen/cliente.
Los límites se validan: 1–10,000 solicitudes y 1–300 segundos, hasta 12 reglas por bloque.
La salida del proveedor no ejecuta código ni tiene herramientas o acceso a archivos.

Una interpretación no ejecutable se guarda con reglas vacías y un mensaje neutral. Una afirmación
universal no tiene una regla universal equivalente. No se completa con controles no especificados.
Sin proveedor disponible se conserva el texto como borrador sin interpretar; no adquiere protección.

Las reglas se evalúan al admitir solicitudes que atravesarán el bloque correspondiente.
Una protección en pagos no se aplica a la navegación que no pasa por pagos. Las decisiones se congelan
en la solicitud admitida. QA y producción usan el mismo evaluador y ejecutor económico.
Los controles pueden rechazar clientes legítimos; su eficacia se observa a través de las pruebas.
Los controles internos de módulos y sus defectos siguen teniendo efectos propios.

## 7. Claude en ambos departamentos

`POST /api/ai` admite exclusivamente `backend.propose`, `security.propose` y `security.compile`.
Backend recibe un grafo ejecutable revisable. Seguridad recibe texto revisable para el bloque elegido.
Las propuestas muestran origen de IA y requieren aceptar o rechazar. Aceptar solo modifica un borrador.
Después se pueden editar manualmente y deben recorrer el pipeline completo.

La IA recibe únicamente el grafo funcional autorizado y la solicitud actual. No recibe incidentes
ocultos, defectos internos, estado de otras empresas, historial de FlowSlack, claves ni políticas secretas.
El prompt restringe la asistencia al trabajo pedido y trata los textos y etiquetas como datos no confiables.
La validación y los permisos del servidor siguen siendo la autoridad, aunque el modelo ignore el prompt.

El intérprete `agent.fixture` se conserva para pruebas locales del contrato previo y se rechaza en
la interfaz Socket.IO del servidor. No constituye un fallback de producción para Claude.

## 8. Defectos plausibles

La política `ai-variation-1` usa SHA-256 de semilla, empresa, generación y solicitud versionada.
`FLOW_AI_VARIATION_PERCENT` (0–100; defecto 35) controla la frecuencia. Puede omitir una operación
atómica/idempotente o variar parámetros de caché, retry o cola presentes en una propuesta.
Las variaciones son parámetros y conexiones ordinarios, visibles, corregibles y ejecutables.
No se agregan defectos imposibles de corregir ni sanciones por usar IA. Si no hay una operación apta,
no se fuerza un defecto. Los módulos existentes conservan `defects-1`; no se agrega un catálogo oculto paralelo.
Repetir exactamente la misma solicitud confirmada conserva la propuesta; solicitudes distintas pueden variar.

## 9. Pipeline y combinación inmutable

`Backend → SECURITY_PENDING → Seguridad → QA_PENDING → QA_RUNNING → QA_PENDING → CTO_PENDING → AUTHORIZED → DEPLOYING → DEPLOYED`.

Seguridad congela sus reglas con el grafo Backend y los artefactos. Un digest vincula empresa,
funcionalidad, versión, grafo, ejecución, referencias y revisión de Seguridad.
QA, CTO y DevOps verifican esta combinación. La publicación copia el contexto congelado.
Los borradores posteriores no alteran releases publicados ni solicitudes admitidas.
QA requiere una prueba terminada; aprobar resultados imperfectos sigue siendo una decisión humana.
No se obliga a implementar un control específico para autorizar.

Los reportes de QA distinguen intentos, bloqueos, ataques exitosos y rechazos de clientes legítimos.
QA puede configurar sesión, propiedad y automatización separadamente del tipo de entrada.

## 10. Proveedor real de Anthropic

Se utiliza la API REST Messages mediante `fetch` del servidor; no hace falta instalar un SDK.
Se verificaron la [API oficial](https://platform.claude.com/docs/en/api/overview) y las
[salidas estructuradas](https://platform.claude.com/docs/en/build-with-claude/structured-outputs).
Se envían `anthropic-version: 2023-06-01`, autenticación de servidor y
`output_config.format: {type: 'json_schema', schema: ...}`. Se valida también localmente.

Configuración, en el entorno del proceso servidor:

```sh
export ANTHROPIC_API_KEY='[secreto del entorno]'
export ANTHROPIC_MODEL='[ID explícito de un modelo con structured outputs habilitado en tu cuenta]'
export FLOW_AI_VARIATION_PERCENT=35
npm run build
npm start
```

No se incluyen valores reales en archivos versionados. No se usa `VITE_*` para secretos.
No se habilita un proveedor simulado por variable de producción. Sin clave o modelo, la API responde
`AI_UNAVAILABLE`; Backend y Seguridad siguen permitiendo edición manual y guardado de borradores.
Para ejecutar protecciones expresadas en lenguaje natural se necesita habilitar el proveedor real.

## 11. Costos, límites y errores

- Texto: hasta 4,000 caracteres; grafo: hasta 25 nodos/30 conexiones; cuerpo HTTP: hasta 80 KB.
- Ocho solicitudes HTTP por usuario/minuto; cuota adicional del gateway por usuario.
- Dos llamadas simultáneas globales y una solicitud en curso por usuario; no se crea una cola ilimitada.
- `max_tokens: 4096`; timeout de 15 segundos por intento; máximo dos intentos para estados transitorios.
- Respuesta del proveedor limitada a 80,000 caracteres; se rechazan truncamiento, tool calls y formas inválidas.
- Hasta 240 propuestas/interpretaciones por empresa y generación; recibos idempotentes ligados al contexto.
- Costos dependen del modelo contratado y los tokens; no hay un precio fijo codificado.
- Las auditorías registran tipo, proveedor, referencias y resultado. No guardan cadenas de razonamiento,
  claves ni cuerpos de errores del proveedor.

## 12. Seguridad operacional

El login admite hasta 60 intentos totales/IP/minuto para cubrir 31 identidades detrás de una IP compartida; mantiene un máximo de 30 credenciales fallidas.
Se usan las sesiones HttpOnly/SameSite y el control de origen existentes. Los permisos se verifican
antes y después del acceso a red. Expulsión, logout, cambio de generación, empresa o borrador invalidan
la respuesta pendiente. Las reglas aceptadas nunca conceden acciones administrativas o de otros roles.
Los recibos se persisten transaccionalmente antes de responder.

Las propuestas completas se devuelven solo al autor solicitante. Los snapshots contienen metadatos
acotados; las instrucciones privadas se proyectan a Seguridad de su empresa y las observaciones a
Backend/Seguridad. QA/CTO/DevOps reciben la funcionalidad, referencias y resultados de pruebas.
Los bundles ejecutables permanecen internos. FlowSlack mantiene su aislamiento anterior.

Con DVR ON, la recepción de una propuesta genera un checkpoint para reconstruirla sin repetir la
llamada externa. Con DVR OFF se mantiene la durabilidad operacional y no se generan tablas forenses.

## 13. Pruebas y evidencia

Se conservan los 264 casos de Entrega 5.5. Se actualizaron sus preparaciones para entregar explícitamente
la revisión de Seguridad; se mantienen las comprobaciones de economía, aislamiento y recuperación.
Se agregan pruebas de contratos de proveedor, aceptación/rechazo, variaciones reproducibles, políticas
por bloque, solicitudes legítimas/maliciosas, ventanas, revisiones obsoletas y confidencialidad.

Evidencia y resultados medidos: [carpeta Entrega 6](benchmarks/entrega-6/README.md).
Las pruebas de proveedor usan exclusivamente mocks con `provider: test` y transporte HTTP simulado.
No se ejecutaron llamadas reales a Anthropic en este entorno, que no dispone de clave ni modelo.

## 14. Rendimiento y límites pendientes

El harness `scripts/collaboration-classroom.ts` conserva el escenario de 1,200 segundos del benchmark
anterior y añade la entrega explícita a Seguridad. Permite 25 o 30 estudiantes, docente y proyector.
Mide ACK, distribución, bytes, memoria, CPU, mensajes privados y recuperación SIGKILL con referencia
exacta a fuentes. Los benchmarks no hacen llamadas reales a Claude ni 5,000 llamadas por tick.

Los clientes de benchmark son Socket.IO en loopback; no representan Wi-Fi ni FPS de 32 navegadores.
La interpretación semántica real depende del proveedor y debe verificarse con credenciales antes de una
clase. El lenguaje ejecutable es deliberadamente acotado al dominio del simulador; instrucciones fuera del
comportamiento soportado permanecen sin interpretar. La respuesta del modelo puede equivocarse y
la validación estructural no demuestra que haya entendido correctamente el texto.

No hay generación de sitios web, acceso arbitrario a herramientas ni un motor económico basado en IA.
