# Contrato de agentes IA — frontera de Entrega 4B

## Estado implementado

4A incluye `AgentInterpreter`, `AgentInput`, la unión `AgentInterpretation`, `AgentResult`, `LocalFixtureInterpreter`, validadores estrictos y `executeInterpretation`. No incluye SDK de Anthropic, proveedor remoto, API key ni llamadas facturables. La implementación está en `shared/agents.ts`, `shared/actions.ts`, `server/agents.ts` y `server/action-validation.ts`.

La futura integración reemplaza el intérprete local, conservando **exactamente** `parseAction` → `applyCommand` → autorización/ejecutor/estado/auditoría. El modelo no recibe una función para editar `GameState`. No recibe privilegios de Docente.

## Entrada del intérprete

```typescript
type AgentInput = {
  version: 1;
  id: string;            // ID estable por intención del usuario, máximo 100
  fixture?: string;      // Solo adaptador local
  rawText?: string;      // Máximo 2,000 caracteres en este contrato
  changeId?: string;
};
type AgentContext = {
  identity: Identity;    // Resuelta en el servidor desde la sesión
  generation: number;
  tick: number;
};
interface AgentInterpreter {
  interpret(input: AgentInput, context: Readonly<AgentContext>):
    AgentInterpretation | Promise<AgentInterpretation>;
}
```

El futuro endpoint obtiene la cookie y resuelve sesión, puesto, empresa y generación antes de interpretar; al volver del proveedor debe volver a verificarlos. Nunca copia un `role`, `actorId` o `companyId` del navegador como autoridad. Las acciones incluyen empresa para verificar aislamiento, no para permitir escoger otra identidad.

Una petición debe corresponder a una instrucción humana concreta. El historial enviado al proveedor se limita al rol/empresa y a datos proyectables. No se envían población, defectos, semilla interna de generación, credenciales, sesiones, access.json, SQLite ni paquetes congelados de ejecución.

## Salida estricta

```typescript
type AgentInterpretation =
  | { version: 1; intent: 'EXECUTE_ACTION' | 'PREPARE_CHANGE' | 'RUN_TEST';
      action: SimulatedAction }
  | { version: 1; intent: 'REQUEST_INFORMATION' | 'OUT_OF_ROLE' |
      'OUT_OF_SCOPE' | 'AMBIGUOUS' | 'UNSUPPORTED'; action?: SimulatedAction };
```

Solo se aceptan `version`, `intent` y `action`. Una acción ejecutable requiere parámetros de su unión discriminada y `action.id === input.id`. Las propiedades inesperadas, JSON mal formado, versión desconocida o acción no implementada producen error técnico/unsupported sin efectos comerciales ni sanción. Un texto del modelo afirmando éxito carece de autoridad.

Ejemplo para un DevOps autenticado:

```json
{
  "version": 1,
  "intent": "EXECUTE_ACTION",
  "action": {
    "version": 1,
    "id": "orden-123",
    "companyId": 0,
    "source": "agent",
    "type": "infra.restart_all",
    "parameters": { "duration": 20 }
  }
}
```

El servidor confirma el reinicio y entonces responde «Reinicio iniciado». Un Backend enviando esa acción recibe rechazo de rol e infracción comprobada; una interpretación incompleta no se convierte en esa acción.

## Herramientas por rol

El esquema de herramientas que reciba Haiku se deriva de `ACTION_CATALOG` filtrado por la identidad real. La lista de herramientas mejora la interpretación, pero el despachador vuelve a validar cada llamada.

| Rol | Herramientas disponibles |
| --- | --- |
| Backend | Crear/revisar los cinco tipos de módulo, guardar/enviar grafo Backend |
| Seguridad | Preparar controles auth/authorization/WAF/bot/origen/rate, guardar/enviar su grafo |
| QA | Elegir cambio, suite/caso estructurado, ejecutar, consultar evidencia, aprobar/rechazar por instrucción humana explícita |
| CTO | Autorizar/rechazar cambio, reservar presupuesto, elegir prioridad, autorizar/rechazar campaña |
| DevOps | Reinicios, servicios, escala/balanceador, despliegue con autorización vigente y estrategia elegida |
| Producto | Propuesta de funcionalidad, propuesta/activación de campaña financiada |

Docente sigue fuera del agente de estudiantes. `employee.correct` exige sesión operator y justificación; ningún modelo puede elevar roles ni ejecutar la corrección en nombre de un jugador.

Los grafos deben conservar conexiones válidas, límites y referencias de artefactos propios. No hay herramienta `update_state`, ejecución JS, shell, SQL o acceso a archivos para el modelo.

## Intenciones y disciplina

`EXECUTE_ACTION`, `PREPARE_CHANGE` y `RUN_TEST` necesitan una acción validada. `REQUEST_INFORMATION` devuelve únicamente hechos del panel autorizado. No inicia cambios. `AMBIGUOUS` y `UNSUPPORTED` no ejecutan ni sancionan. Para dudas legítimas sobre alcance, pedir concreción; no adivinar una orden prohibida.

`OUT_OF_ROLE` por sí solo no añade una infracción: el servidor debe confirmar una acción conocida incompatible con el rol. Si el modelo clasifica como ajena una acción que sí está permitida, se responde AMBIGUOUS y no se ejecuta. La clasificación no sustituye la decisión del alumno.

`OUT_OF_SCOPE` tampoco sanciona por una etiqueta del modelo. 4A solo confirma una regla exacta, anclada y versionada para «Escribe un poema»/«Write a poem» y sus variantes explícitas implementadas. Otras solicitudes fuera del juego se rechazan sin sanción automática hasta tener una política verificable. El texto original y el ID deben corresponder a la instrucción auténtica del usuario.

No suman faltas: timeout, desconexión, proveedor caído, salida mal formada, interpretación dudosa, funcionalidad no implementada, error interno, retry idéntico o decisión mala dentro del rol. Cinco infracciones confirmadas expulsan al empleado; el proveedor no puede crear ese estado directamente.

## Respuesta operativa

`AgentResult` incluye `version: 1`, `ok`, código/error cuando corresponda, `refs`, `status` y `message`. Los estados disponibles son:

`ORDER_RECEIVED`, `PREPARED`, `EXECUTED`, `SENT_TO_QA`, `PENDING_AUTHORIZATION`, `DEPLOY_STARTED`, `DEPLOY_COMPLETED`, `UNAUTHORIZED`, `OUT_OF_ROLE`, `OUT_OF_SCOPE`, `AMBIGUOUS`, `UNSUPPORTED`, `TECHNICAL_ERROR`.

4A emite los estados correspondientes a sus acciones confirmadas. Los estados de publicación completada deben derivarse de un cambio DEPLOYED/evento del motor; `deploy.start` solo permite DEPLOY_STARTED. El retorno inicial de un job QA significa que el job fue aceptado, no que sus pruebas pasaron. Su informe llega al terminar el ejecutor.

Ejemplos de mensajes permitidos: «Cambio preparado. Pendiente de pruebas QA», «Campaña preparada. Pendiente de autorización», «Reinicio iniciado», «Despliegue iniciado». Nunca se dice «publicado» al crear un artefacto. Los mensajes no recomiendan estrategia, pruebas, soluciones, reparaciones ni decisiones alternativas. Tampoco revelan defectos latentes.

## Errores, idempotencia y auditoría

Los códigos principales son `INVALID`, `VERSION`, `UNSUPPORTED`, `FORBIDDEN`, `EXPELLED`, `ID_CONFLICT`, `ROOM_PAUSED`, `LIMIT`, `INVALID_INTERPRETATION`, `TECHNICAL`. Las validaciones de estados heredadas también pueden devolver `ok:false` con error de precondición. La UI no debe tratar la falta de un código como éxito.

El ID lógico sobrevive a reintentos HTTP/proveedor/socket. El servidor conserva digest y recibo por empleado/ID, junto con auditoría, snapshot y efectos. La tabla de comandos protege además el ID de transporte. Un mismo ID con otro contenido falla antes de operar. Un timeout después de enviar al motor requiere consultar/repetir **ese mismo ID**, no inventar uno y ejecutar otra vez.

Audit conserva actor/empresa/rol reales, tick, tipo, contrato, fuente/correlación, resultado, referencias y deltas; las operaciones diferidas emiten confirmaciones del motor. Las infracciones se confirman una vez. Una clave API, prompt con secretos o respuesta cruda del proveedor nunca debe guardarse en este audit visible. 4B debe guardar métricas de proveedor separadas con retención acotada.

## Timeouts y fallos del proveedor: implementación exigida para 4B

Estas políticas de integración remota son contrato de la siguiente entrega, **no un proveedor que ya exista en 4A**:

1. Usar cancelación y timeout de interpretación (propuesta inicial 10 s), sin mutar el juego durante la espera. Tras resolver, validar de nuevo sesión, expulsión, empresa, estado/generación y precondiciones actuales.
2. Si el proveedor falla antes del despacho, devolver TECHNICAL_ERROR sin acción, dinero ni infracción. La simulación sigue avanzando con sus reglas locales.
3. Reintentar como máximo una vez errores transitorios de interpretación, con el mismo ID lógico; no repetir una acción confirmada. Respetar cancelación y descartar respuestas de una generación restablecida.
4. Para timeout posterior al despacho, consultar el recibo idempotente. No inferir éxito ni fallo a partir del texto del proveedor.
5. Un parser/sanitizador del servidor debe imponer el contrato antes de cada llamada a herramientas. La confianza declarada por el modelo no concede permisos.

## Límites de peticiones y costos

Hoy existen JSON/socket de 80 KB, 20 comandos/s por conexión, 12,000 órdenes auditadas por partida y límites de recursos del motor/QA. 4B debe añadir límites **por empleado, empresa y sala**, cola limitada de interpretaciones, máximo de llamadas concurrentes y máximo de tokens de entrada/salida. Los valores deben configurarse y probarse con 25–30 participantes; no heredar la limitación por socket como protección de costos.

El presupuesto del proveedor es independiente del capital ficticio del juego. Debe tener un techo monetario/partida, estimación antes de despachar, contadores reales por respuesta y corte al agotarse. No se deben convertir costos del proveedor en ventas, reputación, pruebas o sanciones. No se fija aquí una tarifa de Haiku: la versión, precio vigente y SDK deben verificarse al implementar 4B.

La clave se configura solo en el servidor, fuera del repositorio, y nunca llega al navegador. 4A no pide ni utiliza una. Las pruebas deben inyectar proveedor falso, timeouts, respuestas malformadas y límites agotados sin consumir créditos.

## Operación sin conexión y fixtures

`LocalFixtureInterpreter` admite `coupon20`, `restart_all`, `rate20`, `qa200`, `information`, `ambiguous`, `poem`; no comprende lenguaje natural general. `qa200` necesita un `changeId`. La entrada `agent.fixture` llama ese adaptador desde `applyCommand`; la acción resultante vuelve al mismo despachador.

```typescript
applyCommand(game, authenticatedIdentity, {
  id: 'transporte-001',
  type: 'agent.fixture',
  payload: { version: 1, id: 'orden-001', fixture: 'restart_all' }
});
```

El modo sin proveedor conserva UI y formularios de acciones ya implementados, fixtures para pruebas y simulación completa. No debe fingir que una orden libre fue comprendida cuando no lo fue. No existe chat Claude en esta entrega ni un director autónomo de incidentes.

La frontera tiene pruebas de entradas falsas, fuente sin autoridad, denegaciones, idempotencia, interpretación ambigua, fallo técnico, estados reales y proceso de servidor. Cambiar el intérprete permite incorporar Haiku sin cambiar permisos, motor económico, QA, disciplina ni publicación.
