# Auditoría de fidelidad del motor

Fecha: 18 de octubre de 2026. Repositorio: `imanderrrrr/flow-war`. Base local inspeccionada: `ded62dc`. Rama de trabajo: `codex/auditoria-fidelidad-motor`.

Esta entrega contiene diagnóstico y propuesta de implementación. No modifica el motor ni la interfaz. Los documentos 01–04 describen el diseño objetivo; no se consideran evidencia de comportamientos implementados. El documento 05 ya reconoce varias simplificaciones.

## 1. Resultado y base que se conserva

El prototipo tiene servidor autoritativo, permisos por rol/empresa, grafos conectados, cambios inmutables al enviarlos, reservas de capital, pipeline y persistencia SQLite. Esta base permite mejorar el motor por escenarios sin reconstruir pantallas.

La principal brecha está en que no existe una entidad de solicitud en ejecución. `inventoryBatch` calcula resultados de un lote mediante presencia y posición de algunas piezas. `step` combina tasas, redondeos y resultados inmediatos; `reportFor` aplica fixtures y fórmulas. No hay intercalado temporal de lecturas/escrituras, colas de solicitudes, deadlines ni claves de compra que permitan rastrear cada consecuencia.

Se conserva la dirección visual, los componentes, las rutas y los estilos arcade. Los cambios futuros del cliente se limitarán a consumir estados y resultados reales en las representaciones existentes. El diagnóstico y los fixtures son documentación de desarrollo; no se agregarán ayudas ni recomendaciones a los jugadores.

## 2. Problemas verificados

### F1. La carrera de inventario se presupone, no se ejecuta

**Archivos:** `server/engine.ts:79`, `shared/types.ts:14`, `tests/engine.test.ts:16`.

- Sin Atomic o Lock en ciertas posiciones, cualquier lote con stock positivo completa toda su demanda. Con esas piezas, se aplica `min(demand, stock)`.
- No existen lectura almacenada por solicitud, versión del SKU, orden de escrituras, propietario de lock ni vencimiento. Dos compras secuenciales también se consideran concurrentes si se entregan en el mismo lote.
- `Stock Validation` no interviene en el resultado de inventario. Atomic ignora la cantidad configurada y Lock ignora el TTL.
- Retry produce `floor(completed × 0.08)` duplicados; no existe un timeout ni un pago repetido identificado. Idempotency es una condición de posición sin claves ni registros.

**Reproducción:** `inventoryBatch(initialGraph('backend'), 2, 1)` devuelve dos completadas y una sobreventa. Insertar Validation antes de Write no cambia el resultado. Con demanda 40/stock 20, Atomic con valor 1 o 3 devuelve las mismas 20 completadas; Lock antes de Read con TTL 1 o 5000 también devuelve las mismas 20.

**Cambio necesario:** un ejecutor determinista con solicitudes identificadas, contexto de lectura y efectos de escritura separados. El primer corte cubrirá exclusivamente la carrera básica y su contraste con Atomic. Locks, reintentos e idempotencia tendrán escenarios posteriores.

### F2. Hay solicitudes sin resultado y resultados comerciales que no llegan a los contadores

**Archivos:** `server/engine.ts:216`, `server/engine.ts:224`, `server/engine.ts:239`, `shared/types.ts:17`, `src/App.tsx:47`.

- El tráfico ordinario incrementa `successes` antes de comprobar si una compra tiene stock. Una compra no atendida puede sumar éxito y pérdida potencial simultáneamente.
- La ráfaga incrementa `requests` y sus rechazos incrementan `errors`, pero sus completadas nunca incrementan `successes`.
- La ráfaga usa stock ficticio local de 20: su resultado no actualiza `c.stock`, ni ingresos, ni pérdidas por compra rechazada. Sí genera multas por sobreventa/duplicados.
- La ráfaga evita capacidad, presupuesto operativo, seguridad, cola y disponibilidad de despliegue. Puede producir sobreventa con el servicio sin capacidad.
- La cola es un acumulador numérico acotado. Al llegar a su máximo se recorta sin registrar solicitudes rechazadas por desborde; no contiene trabajos que se drenen después.
- No hay estado de abandono/timeout por solicitud. `pressure` y migración de mercado no sustituyen ese resultado.
- `active` y latencia son estimaciones; no cuentan clientes únicos pendientes ni tiempos observados. La tasa visible usa errores acumulados sobre solicitudes acumuladas y mezcla rechazos comerciales con fallos técnicos.
- Los ataques generan accesos indebidos y sprites por otra vía, sin una contabilidad explícita equivalente de solicitudes hostiles.

**Reproducción de ráfaga:** partida inicial en ejecución; `tick=450.9`; empresa 0 con ocho servidores y balanceador, `stock=5`; avanzar un paso de 0.1 s. En la variante Atomic se inserta la pieza antes de Write. En la variante sin servicio se establece `infraBudget=0`.

| Variante | Solicitudes | Éxitos | Errores | Sin resultado contabilizado | Sobreventa | Stock posterior |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Insegura | 41 | 1 | 0 | 40 | 20 | 17 |
| Atomic | 41 | 1 | 20 | 20 | 0 | 17 |
| Sin servicio | 41 | 0 | 1 | 40 | 20 | 17 |

El stock posterior es 5 + 12 de reposición ordinaria; no refleja las compras de la ráfaga. Las tres variantes registran cero ingresos en ese paso.

**Reproducción sin stock:** partida inicial, `stock=0`, `processedRemainder=0.9`, avanzar diez pasos. Resultado de la empresa 0: una solicitud, un éxito, cero errores, Q45 perdidos y un sprite de compra exitosa.

**Cambio necesario:** finalización única por solicitud y ledger de efectos por intención de compra. Para cada universo de tráfico y cohorte de motor:

```text
generadas = en_curso + completadas + rechazadas + abandonadas + fallidas
```

Las categorías terminales son excluyentes; sobreventa, fraude y duplicados son anomalías de efectos y no nuevas solicitudes. Una respuesta exitosa con sobreventa debe poder conservar esa anomalía sin generar una venta legítima adicional. Ataques, intentos de retry e intenciones comerciales necesitan denominadores explícitos. La migración de clientes es una operación distinta del abandono de una solicitud.

### F3. Las animaciones no representan de forma fiable los resultados

**Archivos:** `server/engine.ts:233`, `server/engine.ts:238`, `server/engine.ts:292`, `shared/types.ts:13`, `src/TrafficCanvas.tsx:67`, `src/trafficGeometry.ts:27`.

- La elección browse/purchase de los sprites no usa la intención comercial procesada; el motor estima 30% de compras, mientras el renderer recibe rutas calculadas a partir del tick y un índice.
- El resultado del sprite solo deriva del fallo agregado, no del inventario o pago. La reproducción sin stock de F2 muestra un éxito visual para una compra perdida.
- No hay sprites ligados a las 40 solicitudes de la ráfaga.
- Todas las compras con `kind='error'` terminan en Checkout y todas las navegaciones fallidas en Web, cualquiera que sea el punto real del fallo.
- Canvas fabrica una partícula inicial cuando el servidor no tiene partículas. Su nacimiento no corresponde a una solicitud registrada.
- Reducir la muestra visual es válido; lo que falta es la relación verificable entre cada sprite muestreado y su operación real.

**Cambio necesario:** proyección estable por `requestId`, etapa, resultado, motivo y tiempos del servidor. Canvas seguirá dibujando edificios, calles y sprites existentes; interpolará etapas confirmadas. El muestreo visual no decidirá resultados ni consumirá aleatoriedad operativa.

### F4. No existe fidelización persistente ni identidad de clientes migrados

**Archivos:** `shared/types.ts:11`, `shared/types.ts:14`, `server/engine.ts:276`, `src/TrafficCanvas.tsx:70`, `server/index.ts:24`.

- Solo se guardan cantidades por empresa; no hay `Customer`, origen inmutable, propietario individual ni mezcla de fidelidad.
- La migración crea un sprite exitoso sin ejecutar una visita posterior en la empresa receptora.
- El color se mezcla en Canvas según progreso de animación hasta 85%, incluso sin una compra/visita completada por el motor. No se conserva para la siguiente visita.
- Una migración posterior toma `from.color`, perdiendo cualquier origen o mezcla anterior. Los eventos de migración se podan a los 20 s.
- La asignación ordinaria conserva población, pero no puede aplicar cooldown individual. La eliminación redistribuye cantidades sin registrar las mismas migraciones visuales ni `migratedOut` del origen.

**Cambio necesario:** clientes persistentes con `id`, `originCompanyId`, `currentCompanyId` o pool sin servicio, `loyaltyMix[5]` y `lastMigrationTick`. La mezcla cambia por visitas legítimas satisfactorias confirmadas; fallos y tiempo de animación no la modifican. Se conserva en remigración y reinicio. Los contadores agregados se derivan de pertenencia, evitando dos fuentes de verdad.

**Dependencia:** vincular solicitudes a clientes y disponer de resultados fiables. Un snapshot antiguo no contiene información suficiente para reconstruir el origen de cada cliente; no se inventará retrospectivamente.

### F5. QA comparte helpers, pero no ejecuta producción en un entorno aislado equivalente

**Archivos:** `server/engine.ts:88`, `server/engine.ts:177`, `shared/types.ts:9`, `tests/engine.test.ts:31`.

- QA comparte `inventoryBatch` y `evaluateSecurity`, pero no el procesamiento completo de `step`. El trabajo espera cuatro segundos y luego calcula el informe de una vez.
- La latencia del informe es una fórmula; no hay tiempos observados. La suite Carga consulta los servidores de producción existentes al finalizar.
- Los informes no fijan semilla propia, versión del motor, fixture ni infraestructura de staging. El cambio conserva `baseVersion` y copia del grafo; faltan los demás identificadores de evidencia.
- Seguridad evalúa 100 legítimas y 60 ataques, pero informa `requests=100` sin separar esos denominadores.
- En producción, un rechazo de `evaluateSecurity` se convierte en admisión parcial de 12%; QA cuenta el rechazo completo. Las ráfagas omiten la evaluación de seguridad.

**Reproducción:** mismo cambio, grafo y versión base, suite Carga con Cache conectado: cambiar servidores de uno a ocho modifica la latencia informada de 1852 a 452 ms. No cambió el artefacto. La suite Seguridad inicial informa 100 solicitudes, 100 completadas y 60 accesos indebidos correspondientes a los ataques adicionales.

**Cambio necesario:** el escenario de concurrencia usará exactamente el mismo ejecutor en QA y producción, con estado aislado y fixture congelado. La evidencia registrará artefacto/base, versión de motor, fixture, semilla y observaciones. QA conserva la decisión humana; no se aprobarán ni elegirán suites automáticamente.

### F6. El pipeline obligatorio funciona; debe preservarse y reforzarse al introducir solicitudes

**Archivos:** `server/engine.ts:100`, `server/engine.ts:124`, `server/engine.ts:152`, `server/engine.ts:177`, `server/index.ts:82`, `tests/server.test.ts:12`.

Verificado por código y pruebas: Backend/Seguridad envían snapshot; QA necesita al menos un informe terminado; CTO autoriza y reserva; solo DevOps inicia despliegue. Guardar, probar, aprobar o autorizar no publica. Hay expiración, invalidación por cambio de base y deduplicación persistente de comandos.

El despliegue actual sustituye el grafo al terminar un temporizador. Restart deja capacidad cero; Rolling reduce una capacidad agregada y con un servidor conserva 12%, sin instancias ni drain. No existe versión fijada por solicitud. `DEPLOY_FAILED` figura en el tipo pero no tiene transición implementada.

**Cambio necesario en el primer corte:** conservar las barreras y cargos actuales, fijar versión de ejecución al admitir cada solicitud y comprobar que publicar no modifica operaciones ya admitidas. No se ampliarán simultáneamente estrategias de despliegue, rollback ni infraestructura.

## 3. Revisión de acciones y parámetros por rol

Los hallazgos de esta tabla provienen de los handlers y sus consumidores; no equivalen a una prueba de navegador de cada control.

| Rol / control actual | Consecuencia verificada | Brecha y tratamiento |
| --- | --- | --- |
| Backend: añadir/conectar/guardar/enviar | Guarda revisiones, valida rutas, congela cambio y calcula costo; no publica directamente. | Conservar. Mover coordenadas no debe cambiar ejecución. |
| Validation | Aumenta ruta/costo/latencia estimada. | No valida stock; implementar cuando tenga escenario propio. |
| Atomic / Lock | Reducen completadas del lote por presencia/posición. | Cantidad/TTL ignorados; Atomic entra en el primer escenario, Lock después. |
| Retry / Idempotency | Activan o suprimen duplicados porcentuales por posición. | Sin timeout, número real de intentos, claves ni TTL; escenario posterior de pagos. |
| Queue | Aumenta límite del acumulador global. | Sin FIFO, drenaje ni alcance según posición; migrar con colas reales. |
| Cache | Multiplica capacidad global por 1.35 si está en ruta con valor positivo. | TTL no expira; incluso después de Payment aporta capacidad. Sin clave ni lectura almacenada. |
| Seguridad: editar/guardar/enviar | Mismo pipeline; conectividad y orden Auth/Role sí cambian evaluación. | Conservar. |
| Auth / Role / WAF | Bloqueos por clase de tráfico y orden Auth/Role. | Valores del inspector no se consumen; faltan principal, permisos y payload real. |
| IP Block | Bloquea bots según paridad del ordinal. | No usa IP ni cantidad configurada. |
| Rate Limit | Compara ordinal módulo 25 con valor. | No representa solicitudes/s por IP ni ventana o bucket persistente. |
| Bot Detection | Compara ordinal módulo 100 con umbral. | Valor tiene efecto, pero sin señales por solicitud ni desafíos. |
| QA: suites/aprobar/rechazar | Genera informes y transiciones reales. | Ejecutar escenario común y congelado; no automatizar juicio. |
| CTO: autorizar/rechazar/presupuesto | Reservas y presupuesto cambian de verdad. | Mantener límites; probar que nuevos efectos no dupliquen cargos. |
| CTO: prioridad Seguridad/Concurrencia | Solo inserta texto en eventos. | Control sin estado de prioridad ni consumidor. Definir prioridad persistente y su consecuencia de coordinación antes de implementarlo; no conceder bonificaciones artificiales ni alterar decisiones de QA/DevOps. |
| DevOps: ±servidor/balanceador | Cambian servidores, capacidad agregada y costo operativo. | Escalamiento inmediato; sin provisión/drain. La vista marca ONLINE aunque no haya presupuesto/capacidad. |
| DevOps: estrategia/desplegar | Cambia duración, degradación y publicación final. | Conservar autorización; fijar versión por solicitud. Fidelidad de instancias en corte posterior. |
| Producto | Vista de métricas/eventos, sin comandos de modificación. | Rol de lectura explícito en este prototipo; no hay un botón de propuesta funcional que auditar. Ampliación fuera del primer corte. |
| Docente: iniciar/pausar/reanudar/velocidad/reset/finalizar | Modifican estado/reloj y controlan avance. | Conservar. Probar pausa/reanudación y finalización con solicitudes pendientes; nunca descartar trabajo sin resultado. |

Todos los parámetros nuevos se validarán en servidor según su unidad. Los controles existentes no recibirán ayudas ni recomendaciones. Corregir parámetros requerirá pruebas que varíen su valor y observen una consecuencia, no únicamente la existencia de una pieza.

## 4. Archivos afectados y dependencias técnicas

Los nombres de archivos nuevos son propuestos, no cambios ya realizados.

| Archivo | Cambio previsto | Cuándo |
| --- | --- | --- |
| `shared/types.ts` | Solicitudes, inventario versionado, resultados, proyección y evidencia de ejecución; posteriormente clientes/fidelidad. | Contrato mínimo del primer corte; ampliar por etapa. |
| `server/engine.ts` | Integrar ejecutor en incidente y QA, reducir contadores a partir de resultados únicos, conservar comandos/pipeline. | Primer escenario; retirar agregados progresivamente. |
| `server/requests.ts` y `server/scenarios.ts` nuevos | Estado/avance determinista del escenario y fixtures; operaciones Read, Atomic, Write, Payment y finalización. | Primer escenario, sin reescritura general del motor. |
| `server/index.ts` | Carga versionada de snapshots y persistencia de solicitudes/versión/contexto; conservar transacción de comandos. | Antes de persistir el nuevo esquema. |
| `src/TrafficCanvas.tsx` | Dibujar la muestra autorizada y etapas/resultados, después colores persistentes. | Primer escenario; fidelidad en su etapa. |
| `src/trafficGeometry.ts` | Seleccionar punto de espera/finalización según etapa real usando las calles existentes. | Primer escenario. |
| `src/App.tsx` | Ajustar únicamente vínculos de métricas e informes existentes cuando cambie su contrato. | Según escenario; sin reconstruir componentes. |
| `src/GraphEditor.tsx` | Reutilizar editor; ajustar validación/unidades solo cuando se implemente cada parámetro. | Posterior, salvo necesidad contractual demostrada. |
| `tests/engine.test.ts`, `tests/server.test.ts`, `tests/traffic.test.ts` | Regresiones, pipeline y coherencia de la proyección. | Cada corte. |
| `tests/concurrency.test.ts`, `tests/persistence.test.ts`, `tests/customers.test.ts` nuevos | Escenario determinista, recuperación y fidelización. | Respectivamente primer corte, persistencia y clientes. |
| `docs/03-motor.md`, `docs/05-prototipo.md` | Actualizar comportamiento y límites realmente entregados. | Al cerrar cada corte. |

No se necesitan librerías nuevas para iniciar: TypeScript, `node:test`, tsx y SQLite actuales cubren motor y pruebas. Se preservan `src/styles.css`, `src/icons.tsx`, fuentes y geometría de edificios/calles. La verificación visual futura comprobará fidelidad del dato y ausencia de regresiones en las pantallas existentes.

Dependencias que deben resolverse junto al primer escenario:

1. **Modelo y semántica:** IDs estables, orden de eventos, unidad de tiempo, stock/versión y finalización única antes de derivar métricas.
2. **Separación de inventario:** la ráfaga necesita SKU/estado compartido persistente dentro del escenario; no un `20` local desconectado del stock mostrado. La reposición debe ser un evento previo a las compras.
3. **Coexistencia:** cada solicitud tendrá un único ejecutor y una única fuente de resultados. El corte migra solo el escenario acordado; el tráfico todavía agregado conserva contabilidad identificada como legado internamente. No se suman el viejo `inventoryBatch` y los nuevos efectos para la misma ráfaga. Las rutas con piezas aún no soportadas necesitan una política explícita de compatibilidad; no se ignorarán silenciosamente.
4. **Persistencia:** guardar solicitudes pendientes, lectura, versión de ejecución, stock, ledger y orden determinista. `GameState.schema` hoy es 1 y la carga hace `JSON.parse` sin migración. Debe haber lectura/migración versionada antes de usar el nuevo esquema.
5. **Datos históricos:** no convertir los huecos de F2 en solicitudes pendientes inventadas. Mantener acumulados legados separados de la contabilidad verificable nueva. Tampoco atribuir origen individual ficticio a clientes de partidas antiguas; conservar su snapshot y establecer una política explícita de compatibilidad antes de la etapa de clientes.
6. **Evidencia QA:** no reutilizar informes del motor anterior como validación del nuevo intérprete. Conservarlos como históricos y exigir nueva ejecución según versión de motor/fixture.
7. **Proyección:** no enviar al público contexto privado de grafos ni listas completas de clientes; muestrear sin alterar efectos, pertenencia o PRNG operativo.

## 5. Orden de implementación

Cada fila es una entrega separada. Las pruebas correspondientes forman parte de la entrega, no una fase final diferida.

| Orden | Entrega | Depende de | Condición de cierre |
| --- | --- | --- | --- |
| 0 — actual | Diagnóstico y selección del primer escenario. | Auditoría de código, pruebas y reproducciones. | Este documento; sin implementación funcional. |
| 1 — siguiente | Dos compras sobre la última unidad: solicitudes individuales, intercalado inseguro frente a Atomic, QA → CTO → DevOps → producción, contabilidad/proyección/persistencia del escenario. | Contratos mínimos y compatibilidad de snapshots. | Mismos efectos observados en QA y producción; stock, resultados y sprites conciliados. |
| 2 | Generalizar resultados a tráfico ordinario, colas acotadas, rechazos y deadlines/abandono. Vincular clientes únicos a solicitudes. | Entrega 1 estable. | Conservación de solicitudes, pérdidas una vez por intención, latencia y activos observados. |
| 3 | Clientes migrados persistentes, origen/pertenencia, fidelidad por visitas exitosas y remigración. | Identidad de cliente y finalización fiable de la entrega 2. | Conservación de 5,000 clientes, mezcla persistente y recuperación sin cambio de propietario/color. |
| 4 | Escenarios independientes para Lock/TTL, Queue/FIFO, Validation/Cache y Retry/Idempotency/pagos. | Ejecutor y ledger de efectos. | Cada pieza y cada parámetro cambia operaciones observables; nodos tardíos/desconectados no conceden beneficios globales. |
| 5 | Seguridad individual y parámetros; cerrar prioridad CTO y demás brechas de roles; fidelidad de infraestructura/despliegues. | Contextos de solicitud, colas y presupuestos. | Acciones con estado/consecuencia verificable y pipeline obligatorio preservado. |

La prioridad decorativa del CTO puede resolverse como entrega pequeña independiente después del primer escenario si se acuerda su semántica. No bloquea la carrera de inventario. No se agregarán Producto transaccional, Blue-Green, rollback, autoscaling ni nuevos diseños de pantalla en esta iteración inicial.

## 6. Primer escenario propuesto: dos compras, una unidad

Es una propuesta para la siguiente entrega; todavía no está implementada.

**Fixture:** empresa activa y financiada, sin ataques ni demanda de fondo en la ejecución aislada; dos intenciones legítimas distintas, mismo SKU con una unidad, cantidad uno, sin retries ni locks. El escenario usa las rutas y los controles existentes. El fixture pequeño demuestra el mecanismo; la ráfaga 40/20 será una parametrización de esa misma carrera, no otro motor.

**Intercalado inseguro observable:**

```text
R1: Read -> stock 1, versión v0
R2: Read -> stock 1, versión v0
R1: Write inseguro usando lectura previa -> compromiso 1
R2: Write inseguro usando lectura previa -> compromiso 2
Payment/Response de ambas solicitudes
```

Resultado: dos respuestas completadas, una unidad física disponible/consumida y una sobreventa identificada por el ledger. El stock visible no oculta el exceso de compromisos. La segunda operación no se reconoce como ingreso legítimo adicional por crear sobreventa; aplica la compensación definida por el escenario una sola vez.

**Contraste Atomic:** conectarlo antes de Write hace que la comprobación y compromiso sean indivisibles. Con el mismo fixture y orden, una compra completa y otra recibe rechazo observado por conflicto o falta de stock según el contrato fijado; cero sobreventa. Colocarlo después de Write o desconectarlo conserva el fallo. La cantidad configurada se consume realmente en la operación atómica.

**Recorrido multirrol:**

1. Backend envía el artefacto Atomic mediante el editor actual. Producción conserva su versión insegura.
2. QA elige Concurrencia y ejecuta el fixture aislado con el ejecutor común. Puede aprobar o rechazar manualmente el informe.
3. CTO autoriza el costo y reserva saldo; aún no cambia producción.
4. DevOps elige una estrategia existente y publica el artefacto autorizado. Las solicitudes ya admitidas conservan su versión; las nuevas usan la publicada.
5. La siguiente ejecución del mismo escenario en producción emite los resultados reales. Arena mantiene su aspecto y representa espera en inventario, salida o rechazo según la solicitud.

La configuración del fixture queda en motor/pruebas; no requiere controles nuevos ni consejos en pantallas de jugadores.

**Pruebas automatizadas requeridas en esa entrega:**

- Demostrar las dos lecturas previas a la primera escritura; distinguir del caso secuencial, que con una unidad solo permite una compra.
- Probar caso inseguro, Atomic correcto, tardío y desconectado; validar cantidad, stock, compromisos, resultados y compensación.
- Conciliar generadas/pendientes/terminales en cada paso, sin sumar sobreventas como solicitudes adicionales.
- QA y producción con mismo artefacto/base/fixture producen las mismas observaciones; el estado de QA no toca mercado, capital ni stock de producción.
- Pipeline real por sesiones Socket.IO separadas: prohibir saltos/roles ajenos, producción intacta hasta despliegue y un solo cargo ante reenvío de comando.
- Una solicitud admitida antes de publicar termina con su versión; la siguiente usa la nueva.
- Pausa congela lectura/escritura y trabajos; guardar/reiniciar con la carrera pendiente conserva el intercalado y no repite efectos.
- Cada sprite muestreado tiene solicitud real y termina/espera en la etapa confirmada; el tamaño de la muestra no cambia contadores.
- Sin capacidad o con rechazo de seguridad previo, no se ejecutan escrituras fantasma de la ráfaga.

Para entregas posteriores se agregarán casos de cola llena, abandono por deadline y pérdida única; fidelidad tras éxito/fallo/remigración/reinicio; TTL de locks/caché/idempotencia y pagos repetidos; así como pruebas de cada control de rol hoy simplificado.

## 7. Verificación realizada y límites de esta auditoría

- `npm test`: **19 pruebas aprobadas**, incluidas integración de servidor real, pipeline, deduplicación y geometría del tráfico.
- `npm run build`: **aprobado**, incluyendo comprobación TypeScript.
- Reproducciones aisladas mediante `node --import tsx --input-type=module` importando el motor local: inventario/valores, ráfaga con/sin capacidad, compra sin stock, prioridad CTO y variación de QA con infraestructura.
- Revisión estática de todos los handlers de comando y controles por rol, persistencia, proyecciones, Canvas y documentación objetivo.
- Las pruebas existentes comprueban el lote agregado y varios invariantes generales; no prueban intercalado real, conciliación de todos los resultados, fidelidad persistente ni equivalencia del intérprete QA/producción. Que pasen no valida esos comportamientos.
- No se realizó una nueva sesión manual de navegador ni medición de FPS/latencia; no se atribuye cobertura visual o de rendimiento a este diagnóstico.
- Los ensayos usaron estados en memoria y el directorio temporal de la prueba existente. No se modificaron credenciales ni datos de la partida local.
