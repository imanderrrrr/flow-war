# Plan de implementación — arquitectura construible

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cada empresa arranque con solo la entrada y la tienda web, y que los equipos construyan el resto del sistema colocando piezas que explican para qué sirven.

**Architecture:** Cada empresa gana un cuarto grafo, el *plano*, con las piezas que hoy son la capa de servicios cableada en `server/traffic.ts`. El motor deriva de ese plano el recorrido de cada solicitud, la capacidad de cada servicio y qué tipos de tráfico puede atender; el grafo de bloques actual queda intacto como la lógica interna de inventario y pagos. Se entrega en dos etapas: primero el motor (jugable con el plano manejado por comandos), después el lienzo.

**Tech Stack:** TypeScript, Node 25, `node:test` vía `tsx --test`, React 19, `@xyflow/react`, Socket.IO, `node:sqlite`.

**Spec:** [docs/24-arquitectura-construible.md](../../24-arquitectura-construible.md)

## Global Constraints

- Código e identificadores en inglés; documentación y **todo texto que ve el estudiante**, en español.
- `develop` es la rama de integración. No tocar `main`, no hacer force-push, no borrar ramas históricas.
- `npm test` y `npm run build` deben pasar antes de presentar la entrega.
- Conservar: motor determinista, cinco empresas, 5 000 clientes, aislamiento entre empresas, FlowSlack privado, recuperación transaccional, snapshots optimizados y DVR configurable.
- Capital inicial Q10 000; publicación Q100; operación Q0.50 por segundo por servidor.
- Tráfico regular: 70% navegación, 30% compra. Ingreso Q45 por unidad, solo en compra.
- Servidores de aplicación: rango 1–8, y solo `web` y `checkout` escalan con ellos.

## Decisiones que este plan fija

La especificación dejó cuatro puntos abiertos. El plan los cierra así, y cada uno es revisable sin rehacer el resto:

1. **El plano del rival es público.** `PublicCompany.modules` ya expone hoy los tipos de nodo de la ruta de producción de las cinco empresas, así que el plano es estrictamente menos información que la que ya circula, y el proyector lo necesita para dibujar.
2. **El orden dibujado se respeta.** El motor recorre el plano en el orden del equipo y muestra la consecuencia; no hay órdenes prohibidos.
3. **El costo de publicar el plano es Q100 más el costo de las piezas que entran en esa publicación**, no del plano entero. Cobrar el total en cada publicación castigaría construir de a poco, que es justo lo que se busca.
4. **Costos por pieza** (calibración, fáciles de mover): salida Q50, checkout Q150, inventario Q200, pagos Q250, seguridad Q300. El servidor de aplicación no tiene costo de publicación: sigue pagándose con el presupuesto de operación que DevOps ya maneja. Llegar a vender cuesta Q650 en piezas más Q100 de publicación.

## Review Focus

Entradas que la especificación implica y que conviene fijar con una prueba, de la más probable a la menos:

1. **Plano con ciclo o con la salida inalcanzable.** Un equipo conecta pagos de vuelta a checkout: `validateGraph` debe rechazarlo con el mensaje que ya usa para ciclos, no colgar el recorrido. → Tarea 1.
2. **Piezas quitadas después de cerrar el montaje.** La protección de clientes no vuelve y el ciclo completo sigue exigiéndose. → Tarea 5.
3. **Solicitudes en vuelo cuando se publica un plano nuevo.** `traffic.paths` se cachea por versión; una solicitud que ya iba caminando el plano anterior debe terminar con ese plano y no mezclarse. → Tarea 3.
4. **Recuperación de una partida de esquema 6 con solicitudes en vuelo.** `server/persistence.ts:70` lee `company.traffic.paths[request.executionVersion]`; la migración debe dejar ese cache coherente con el plano sintetizado. → Tarea 8.
5. **Prueba de control lanzada justo cuando la empresa cierra su montaje.** El rechazo por montaje y la habilitación deben decidirse con el mismo estado, sin ventana ambigua. → Tarea 7.

---

# Etapa 1 — Motor

## Task 1: El plano en el modelo

**Files:**
- Create: `shared/plan.ts`
- Modify: `shared/types.ts` (`Domain`, `Company`, `PublicCompany`), `server/engine.ts:37-41` (`initialGraph`), `server/engine.ts:42-52` (`createGame`), `server/engine.ts:58-90` (`validateGraph`)
- Test: `tests/plan-model.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `shared/plan.ts`: `type PlanPiece = 'entry'|'security'|'web'|'checkout'|'inventory'|'payment'|'exit'|'server'`; `PLAN_PIECES: Record<PlanPiece, { label: string; service?: ServiceId; owner: Role | null; cost: number; text: string }>`; `PLAN_SLOTS: Record<PlanPiece, { x: number; y: number }>`; `PLAN_REQUIREMENTS: Record<TrafficRequest['type'], ServiceId[]>`.
  - `shared/types.ts`: `Domain` gana `'plan'`; `Company.plan: Graph`. `PublicCompany` lo hereda sin omitirlo — es la decisión 1 — así que `project` no lo destructura para descartarlo como hace con `backend`, `security` y `product`.
  - `server/engine.ts`: `initialGraph('plan')` devuelve entrada + tienda web unidas por una conexión.

`PLAN_SLOTS` lleva las coordenadas que hoy están en `src/trafficGeometry.ts:7-9` (`ENTRY`, `GATE`, `WEB`, `CHECK`, `STOCK`, `PAY`, `OUT`) para que el servidor y el proyector usen una sola fuente, más una **bahía de servidores** bajo la tienda web. El solar de servidores es el único que admite varias piezas apiladas; los otros siete, una sola. `PLAN_REQUIREMENTS`: `browse: ['web']`, `query: ['web','inventory']`, `purchase: ['web','checkout','inventory','payment']`.

- [ ] **Step 1: Escribir las pruebas que fallan** en `tests/plan-model.test.ts`

```ts
test('una empresa nueva arranca con entrada y tienda web, nada más', () => {
  const game = createGame();
  for (const c of game.companies) {
    assert.deepEqual(c.plan.nodes.map(n => n.type).sort(), ['entry', 'web']);
    assert.equal(c.plan.edges.length, 1);
  }
});

test('el plano acepta una pieza por solar y rechaza la repetida', () => {
  const plan = initialGraph('plan');
  plan.nodes.push({ id: 'p-exit', type: 'exit', position: PLAN_SLOTS.exit, data: { label: 'Salida' } });
  assert.ok(validateGraph(plan, 'plan', false));
  plan.nodes.push({ id: 'p-exit-2', type: 'exit', position: PLAN_SLOTS.exit, data: { label: 'Salida' } });
  assert.throws(() => validateGraph(plan, 'plan', false), /solar/i);
});

test('el plano rechaza un ciclo', () => {
  const plan = initialGraph('plan');
  plan.edges.push({ id: 'back', source: 'plan-web', target: 'plan-entry' });
  assert.throws(() => validateGraph(plan, 'plan', false), /Ciclo|Dirección/);
});

test('el plano rechaza una pieza que no está en el catálogo', () => {
  const plan = initialGraph('plan');
  plan.nodes.push({ id: 'p-lock', type: 'lock', position: { x: 0, y: 0 }, data: { label: 'Lock' } });
  assert.throws(() => validateGraph(plan, 'plan', false), /Nodo inválido/);
});
```

- [ ] **Step 2: Correr las pruebas y verificar que fallan**

Run: `npx tsx --test tests/plan-model.test.ts`
Expected: FAIL — `initialGraph` no acepta `'plan'`.

- [ ] **Step 3: Implementar `shared/plan.ts`** con los cuatro valores exportados del bloque Interfaces, y los textos didácticos en español de la tabla de la sección 2 de la especificación.

- [ ] **Step 4: Extender `initialGraph`, `createGame` y `validateGraph`** en `server/engine.ts`

`validateGraph(input, 'plan', complete)` reusa la validación estructural que ya existe (identificadores, posiciones finitas, una salida por nodo, sin ciclos, dirección de conexiones) y agrega: el tipo debe estar en `PLAN_PIECES`; **un solar admite una sola pieza** (al repetir un tipo distinto de `server`, el mensaje contiene la palabra "solar"); con `complete` en `false` no exige ninguna pieza presente. `createGame` da a cada empresa `plan: initialGraph('plan')`.

- [ ] **Step 5: Correr las pruebas y verificar que pasan**

Run: `npx tsx --test tests/plan-model.test.ts`
Expected: PASS

- [ ] **Step 6: Correr la batería completa**

Run: `npm test`
Expected: PASS — ninguna prueba existente cambia de resultado.

- [ ] **Step 7: Commit**

```bash
git add shared/plan.ts shared/types.ts server/engine.ts tests/plan-model.test.ts
git commit -m "feat(plan): add the service plan to the company model"
```

## Task 2: El recorrido derivado del plano

**Files:**
- Modify: `server/graphs.ts`
- Test: `tests/plan-route.test.ts`

**Interfaces:**
- Consumes: `PLAN_REQUIREMENTS` de la Tarea 1; `route(graph)` que ya existe en `server/graphs.ts:3`.
- Produces: `planServices(plan: Graph): ServiceId[]` — servicios del recorrido, en orden, sin repetir; `missingFor(plan: Graph, type: TrafficRequest['type']): ServiceId | 'exit' | null` — el **primer** faltante en el orden de `PLAN_REQUIREMENTS`, `'exit'` si el recorrido no termina en la salida, y `null` si se puede atender; `sellCapable(plan: Graph): boolean` que es `missingFor(plan,'purchase') === null`.

- [ ] **Step 1: Escribir las pruebas que fallan** en `tests/plan-route.test.ts`

```ts
const withPieces = (...types: string[]) => { /* entrada → …types… → salida, en cadena */ };

test('el plano inicial no atiende nada: falta la salida', () => {
  assert.equal(missingFor(initialGraph('plan'), 'browse'), 'exit');
  assert.equal(sellCapable(initialGraph('plan')), false);
});

test('con la salida puesta ya se navega, pero no se compra ni se consulta', () => {
  const plan = withPieces('web');
  assert.equal(missingFor(plan, 'browse'), null);
  assert.equal(missingFor(plan, 'query'), 'inventory');
  assert.equal(missingFor(plan, 'purchase'), 'checkout');
});

test('cuatro piezas alcanzan para vender', () => {
  const plan = withPieces('web', 'checkout', 'inventory', 'payment');
  assert.equal(missingFor(plan, 'purchase'), null);
  assert.equal(sellCapable(plan), true);
  assert.deepEqual(planServices(plan), ['web', 'checkout', 'inventory', 'payment']);
});

test('una pieza fuera del recorrido no cuenta', () => {
  const plan = withPieces('web', 'checkout', 'inventory', 'payment');
  plan.edges = plan.edges.filter(e => e.target !== plan.nodes.find(n => n.type === 'payment')!.id);
  assert.notEqual(missingFor(plan, 'purchase'), null);
});

test('el orden dibujado se respeta y se informa', () => {
  const plan = withPieces('web', 'checkout', 'payment', 'inventory');
  assert.equal(sellCapable(plan), true);
  assert.deepEqual(planServices(plan), ['web', 'checkout', 'payment', 'inventory']);
});
```

- [ ] **Step 2: Correr las pruebas y verificar que fallan**

Run: `npx tsx --test tests/plan-route.test.ts`
Expected: FAIL — `planServices` no existe.

- [ ] **Step 3: Implementar las cuatro funciones en `server/graphs.ts`** sobre `route(plan)`, sin recorrer el grafo por su cuenta.

- [ ] **Step 4: Correr las pruebas y verificar que pasan**

Run: `npx tsx --test tests/plan-route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/graphs.ts tests/plan-route.test.ts
git commit -m "feat(plan): derive the served request types from the plan route"
```

## Task 3: Motivos legibles y máquina de fases

**Files:**
- Modify: `shared/types.ts` (`TerminalReason`, `TERMINAL_LABELS`), `server/traffic.ts:66-93` (`admitTraffic`), `server/traffic.ts:118-135` (`completeOperation`)
- Verificar sin modificar: `server/requests.ts:55-62` (`finishRequest`) — una compra rechazada en la admisión es `commercial` y no está pagada, así que la venta perdida de Q45 por unidad ya sale sola. Si hiciera falta tocarlo, es señal de que el rechazo se puso en el lugar equivocado.
- Test: `tests/plan-traffic.test.ts`

**Interfaces:**
- Consumes: `missingFor`, `planServices` de la Tarea 2.
- Produces: `TerminalReason` gana `'NO_STOREFRONT' | 'NO_INVENTORY' | 'NO_CHECKOUT'`, con estas etiquetas exactas en `TERMINAL_LABELS`: `NO_STOREFRONT: 'La tienda no responde'`, `NO_INVENTORY: 'No se puede consultar el stock'`, `NO_CHECKOUT: 'Todavía no se puede comprar acá'`.

`admitTraffic` consulta `missingFor(company.plan, type)` al admitir: si no es `null`, la solicitud se termina con el motivo correspondiente (`'exit'` y `'web'` → `NO_STOREFRONT`, `'inventory'` → `NO_INVENTORY`, `'checkout'` y `'payment'` → `NO_CHECKOUT`) en vez de entrar a la cola. `completeOperation` deja de encadenar `security → web → checkout → backend` a mano y avanza por `planServices` del plano cacheado de esa versión.

La caché por versión que ya existe (`state.paths[company.version]`, `server/traffic.ts:73`) se extiende al plano: una solicitud en vuelo termina con el plano de **su** `executionVersion`, no con el publicado después.

- [ ] **Step 1: Escribir las pruebas que fallan** en `tests/plan-traffic.test.ts`

```ts
test('una empresa sin salida no responde nada y lo dice en español', () => {
  const game = createGame(); command(game, 'operator', 'room.start');
  const c = game.companies[0];
  for (let i = 0; i < 10; i++) admitTraffic(c, 0, i % 2 ? 'purchase' : 'browse');
  advanceGame(game, 1);
  const reasons = new Set(Object.values(c.traffic.requests).map(r => r.result?.reason));
  assert.deepEqual([...reasons], ['NO_STOREFRONT']);
  assert.equal(TERMINAL_LABELS.NO_STOREFRONT, 'La tienda no responde');
});

test('con tienda y salida se navega y la compra dice que todavía no se puede comprar', () => {
  // plano: entrada → tienda web → salida
  assert.equal(browseRequest.result!.reason, 'OK');
  assert.equal(purchaseRequest.result!.reason, 'NO_CHECKOUT');
});

test('con el plano completo el recorrido es el de siempre', () => {
  // plano sintetizado completo + grafo backend por defecto
  assert.deepEqual(planServices(c.plan), ['security', 'web', 'checkout', 'inventory', 'payment']);
  assert.equal(purchaseRequest.result!.reason, 'OK');
});

test('una solicitud en vuelo termina con el plano de su versión', () => {
  // admitir una compra con el plano completo, publicar un plano sin pagos, avanzar
  assert.equal(inFlight.result!.reason, 'OK');
  assert.equal(afterPublish.result!.reason, 'NO_CHECKOUT');
});
```

- [ ] **Step 2: Correr las pruebas y verificar que fallan**

Run: `npx tsx --test tests/plan-traffic.test.ts`
Expected: FAIL — `NO_STOREFRONT` no existe.

- [ ] **Step 3: Agregar los tres motivos y sus etiquetas** en `shared/types.ts`.

- [ ] **Step 4: Rechazar en la admisión** en `admitTraffic`, según la correspondencia motivo↔faltante de arriba.

- [ ] **Step 5: Mover la máquina de fases al plano** en `completeOperation`, conservando dos reglas vigentes: la navegación termina al salir de la tienda web sin pasar por checkout, y la consulta vuelve desde inventario sin visitar pagos.

- [ ] **Step 6: Correr las pruebas y verificar que pasan**

Run: `npx tsx --test tests/plan-traffic.test.ts`
Expected: PASS

- [ ] **Step 7: Correr la batería completa y el banco de tráfico**

Run: `npm test && npm run bench:traffic`
Expected: PASS, y el banco sin regresión de rendimiento.

- [ ] **Step 8: Commit**

```bash
git add shared/types.ts server/traffic.ts tests/plan-traffic.test.ts
git commit -m "feat(plan): walk the request through the plan the team drew"
```

## Task 4: Capacidad de un servicio que todavía no existe

**Files:**
- Modify: `server/traffic.ts:42-52` (`serviceRates`), `server/traffic.ts:206-230` (capacidad de colas)
- Test: `tests/plan-capacity.test.ts`

**Interfaces:**
- Consumes: `planServices` de la Tarea 2.
- Produces: `serviceRates(company, deployment?)` devuelve `0` para todo servicio que no está en `planServices(company.plan)`, antes de aplicar `stoppedServices`.

- [ ] **Step 1: Escribir las pruebas que fallan** en `tests/plan-capacity.test.ts`

```ts
test('un servicio fuera del plano no tiene capacidad', () => {
  const c = createGame().companies[0];
  const rates = serviceRates(c);
  assert.equal(rates.web > 0, true);
  assert.deepEqual([rates.security, rates.checkout, rates.inventory, rates.payment], [0, 0, 0, 0]);
});

test('colocar pagos le da capacidad y no toca a los demás', () => {
  const before = serviceRates(c), after = serviceRates(withPaymentOnPlan(c));
  assert.ok(after.payment > 0);
  assert.deepEqual([after.web, after.inventory], [before.web, before.inventory]);
});

test('el servicio detenido por DevOps sigue en cero aunque esté en el plano', () => {
  c.infrastructure.stoppedServices = ['payment'];
  assert.equal(serviceRates(withPaymentOnPlan(c)).payment, 0);
});

test('solo tienda web y checkout escalan con los servidores', () => {
  const one = serviceRates(completeCompany(1)), four = serviceRates(completeCompany(4));
  assert.equal(four.web, one.web * 4);
  assert.equal(four.checkout, one.checkout * 4);
  assert.deepEqual([four.security, four.inventory, four.payment], [one.security, one.inventory, one.payment]);
});
```

- [ ] **Step 2: Correr las pruebas y verificar que fallan**

Run: `npx tsx --test tests/plan-capacity.test.ts`
Expected: FAIL — hoy los cinco servicios tienen tasa sin importar el plano.

- [ ] **Step 3: Filtrar por plano en `serviceRates`** y acotar la capacidad de cola a los servicios presentes.

- [ ] **Step 4: Correr las pruebas y verificar que pasan**

Run: `npx tsx --test tests/plan-capacity.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/traffic.ts tests/plan-capacity.test.ts
git commit -m "feat(plan): give capacity only to the services on the plan"
```

## Task 5: Fase de montaje y protección de clientes

**Files:**
- Modify: `shared/types.ts` (`Company`), `server/engine.ts:42-52` (`createGame`), `server/engine.ts:340-407` (`step`), `server/market.ts:88-102` (`recordCustomerExperience`)
- Test: `tests/plan-assembly.test.ts`

**Interfaces:**
- Consumes: `sellCapable` de la Tarea 2; los tres motivos de la Tarea 3.
- Produces: `Company.assembly: { active: boolean; closedAt?: number }`, que arranca `{ active: true }`.

Dos reglas:

1. **`step` cierra el montaje** la primera vez que `sellCapable(c.plan)` es verdadero: `assembly = { active: false, closedAt: g.tick }` y un evento de categoría `PIPELINE` que dice que la empresa ya acepta compras. **Irreversible**: quitar piezas después no reabre el montaje.
2. **`recordCustomerExperience` protege al cliente** cuando `company.assembly.active` y `result.reason` es uno de los tres motivos nuevos: no mueve `experiences`, `successfulVisits`, `failedVisits`, `dissatisfaction`, `consecutiveFailures`, lealtad, reputación ni migración. La venta perdida (`lostRevenue`) y el reclamo en `soporte-clientes` se conservan.

El retorno anticipado va **después** de `customer.activeRequests--` (`server/market.ts:94`), igual que el de `ROOM_FINISHED`: saltearlo antes dejaría solicitudes activas colgadas y la aserción de `server/market.ts:93` empezaría a tirar.

- [ ] **Step 1: Escribir las pruebas que fallan** en `tests/plan-assembly.test.ts`

```ts
test('durante el montaje la compra no atendida no castiga al cliente', () => {
  // plano con tienda web y salida; admitir una compra
  assert.equal(request.result!.reason, 'NO_CHECKOUT');
  assert.ok(request.result!.lostRevenue > 0);
  assert.equal(customer.failedVisits, 0);
  assert.equal(customer.dissatisfaction, 0);
  assert.equal(customer.currentCompanyId, 0);          // no migró
  assert.equal(company.reputation, 80);                 // intacta
  assert.equal(customer.activeRequests, 0);             // y no quedó colgada
});

test('el montaje se cierra al quedar capaz de vender, una sola vez', () => {
  assert.equal(company.assembly.active, false);
  assert.equal(typeof company.assembly.closedAt, 'number');
  const closedAt = company.assembly.closedAt;
  // quitar pagos del plano y avanzar
  assert.equal(company.assembly.active, false);
  assert.equal(company.assembly.closedAt, closedAt);
});

test('cerrado el montaje, la compra no atendida sí castiga', () => {
  // cerrar montaje, quitar pagos, admitir una compra
  assert.equal(customer.failedVisits, 1);
});

test('el montaje no altera el castigo de los motivos de siempre', () => {
  // en montaje, una compra que termina en OUT_OF_STOCK cuenta como fallo normal
  assert.equal(customer.failedVisits, 1);
});
```

- [ ] **Step 2: Correr las pruebas y verificar que fallan**

Run: `npx tsx --test tests/plan-assembly.test.ts`
Expected: FAIL — `company.assembly` no existe.

- [ ] **Step 3: Agregar `Company.assembly`** en `shared/types.ts` y su valor inicial en `createGame`.

- [ ] **Step 4: Cerrar el montaje en `step`** con el evento en español.

- [ ] **Step 5: Proteger al cliente en `recordCustomerExperience`**, con el retorno anticipado después del decremento de `activeRequests`.

- [ ] **Step 6: Correr las pruebas y verificar que pasan**

Run: `npx tsx --test tests/plan-assembly.test.ts`
Expected: PASS

- [ ] **Step 7: Correr la batería completa y el banco de mercado**

Run: `npm test && npm run bench:traffic`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add shared/types.ts server/engine.ts server/market.ts tests/plan-assembly.test.ts
git commit -m "feat(plan): keep customers while a company is still assembling"
```

## Task 6: Comandos del plano y pipeline libre en montaje

**Files:**
- Modify: `shared/actions.ts` (permisos y parámetros), `server/engine.ts:229-245` (despacho de `draft.save`/`change.submit`)
- Test: `tests/plan-commands.test.ts`

**Interfaces:**
- Consumes: `PLAN_PIECES` (dueño y costo) de la Tarea 1; `validateGraph(_, 'plan', _)` de la Tarea 1; `sellCapable` de la Tarea 2; `Company.assembly` de la Tarea 5.
- Produces: `plan.save { graph, revision }` y `plan.publish { graph, revision }`, permitidos a `backend`, `security` y `devops`; `assertPlanOwnership(previous: Graph, next: Graph, role: Role): void` en `server/engine.ts`, que tira si cambió una pieza cuyo `PLAN_PIECES[type].owner` no es ese rol.

`plan.publish` cobra `100 + Σ PLAN_PIECES[type].cost` de las piezas **nuevas** respecto del plano en producción, contra el capital disponible. Durante el montaje publica directo. Cerrado el montaje, `plan.publish` se rechaza con código `PIPELINE_REQUIRED` y el cambio tiene que pasar por `change.submit` como cualquier otro.

- [ ] **Step 1: Escribir las pruebas que fallan** en `tests/plan-commands.test.ts`

```ts
test('Backend coloca la salida y publica directo durante el montaje', () => {
  const r = command(game, 'backend', 'plan.publish', { graph: planWith('web', 'exit'), revision: 0 });
  assert.equal(r.ok, true, r.error);
  assert.equal(game.companies[0].capital, 10000 - 100 - 50);
});

test('Backend no puede colocar el perímetro de seguridad', () => {
  const r = command(game, 'backend', 'plan.publish', { graph: planWith('security', 'web', 'exit'), revision: 0 });
  assert.equal(r.ok, false);
});

test('Seguridad sí puede colocar el perímetro', () => {
  const r = command(game, 'security', 'plan.publish', { graph: planWith('security', 'web', 'exit'), revision: 0 });
  assert.equal(r.ok, true, r.error);
  assert.ok(planServices(game.companies[0].plan).includes('security'));
});

test('solo se cobran las piezas nuevas de esa publicación', () => {
  // publicar salida; después publicar salida + inventario
  assert.equal(game.companies[0].capital, 10000 - 100 - 50 - 100 - 200);
});

test('cerrado el montaje, publicar el plano directo se rechaza', () => {
  const r = command(game, 'backend', 'plan.publish', { graph: planWith('web', 'checkout', 'inventory', 'payment', 'exit'), revision: 1 });
  assert.equal(r.code, 'PIPELINE_REQUIRED');
});

test('sin capital suficiente la publicación se rechaza y no cambia el plano', () => {
  game.companies[0].capital = 60;
  const before = structuredClone(game.companies[0].plan);
  const r = command(game, 'backend', 'plan.publish', { graph: planWith('web', 'exit'), revision: 0 });
  assert.equal(r.ok, false);
  assert.deepEqual(game.companies[0].plan, before);
  assert.equal(game.companies[0].capital, 60);
});
```

- [ ] **Step 2: Correr las pruebas y verificar que fallan**

Run: `npx tsx --test tests/plan-commands.test.ts`
Expected: FAIL — `plan.publish` no está autorizado para ningún rol.

- [ ] **Step 3: Registrar permisos y parámetros** de `plan.save` y `plan.publish` en `shared/actions.ts`.

- [ ] **Step 4: Implementar `assertPlanOwnership` y el despacho de los dos comandos** en `server/engine.ts`, con el cobro de piezas nuevas y el rechazo `PIPELINE_REQUIRED` fuera del montaje.

- [ ] **Step 5: Correr las pruebas y verificar que pasan**

Run: `npx tsx --test tests/plan-commands.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add shared/actions.ts server/engine.ts tests/plan-commands.test.ts
git commit -m "feat(plan): publish the plan freely while the company assembles"
```

## Task 7: El auditor espera a que la empresa venda

**Files:**
- Modify: `server/auditor.ts:67-75` (`auditCompanies`), `server/auditor.ts:132-148` (`auditCommand`)
- Test: `tests/plan-auditor.test.ts`

**Interfaces:**
- Consumes: `Company.assembly` de la Tarea 5.
- Produces: `AuditCompany` gana `assembling: boolean`; `audit.probe` contra una empresa en montaje devuelve `{ ok: false, code: 'ASSEMBLING' }` con un mensaje en español que dice que esa empresa todavía no acepta compras.

El rechazo y la lista de módulos se deciden con el mismo `company.assembly.active` dentro del mismo comando, así no hay ventana en la que la ficha diga una cosa y el comando otra.

- [ ] **Step 1: Escribir las pruebas que fallan** en `tests/plan-auditor.test.ts`

```ts
test('una empresa en montaje se ve en montaje y sin módulos auditables', () => {
  const view = project(game, { id: 'auditor-P1', role: 'auditor', companyId: null }).auditor!;
  assert.equal(view.companies[0].assembling, true);
  assert.deepEqual(view.companies[0].modules, []);
});

test('la prueba de control contra una empresa en montaje se rechaza', () => {
  const r = command(game, 'auditor', 'audit.probe', { companyId: 0, nodeId: 'backend-write', check: 'waf' });
  assert.equal(r.code, 'ASSEMBLING');
});

test('cerrado el montaje sin perímetro, los cinco controles figuran pendientes', () => {
  assert.deepEqual(view.companies[0].modules[0].pending.map(p => p.check).sort(),
    ['auth', 'bot_detection', 'rate_limit', 'role_check', 'waf']);
});

test('la ficha y el comando deciden con el mismo estado en el mismo tick', () => {
  // publicar el plano capaz de vender y avanzar un solo tick
  const view = project(game, auditorIdentity).auditor!;
  const r = command(game, 'auditor', 'audit.probe', { companyId: 0, nodeId: 'backend-write', check: 'waf' });
  assert.equal(view.companies[0].assembling, false);
  assert.notEqual(r.code, 'ASSEMBLING');
});
```

- [ ] **Step 2: Correr las pruebas y verificar que fallan**

Run: `npx tsx --test tests/plan-auditor.test.ts`
Expected: FAIL — `assembling` no existe en la vista.

- [ ] **Step 3: Exponer `assembling` y condicionar los módulos** en `auditCompanies`.

- [ ] **Step 4: Rechazar la prueba durante el montaje** en `auditCommand`, antes de resolver el módulo.

- [ ] **Step 5: Correr las pruebas y la batería del auditor**

Run: `npx tsx --test tests/plan-auditor.test.ts tests/auditor.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/auditor.ts shared/auditor.ts tests/plan-auditor.test.ts
git commit -m "feat(plan): open the audit once a company accepts purchases"
```

## Task 8: Esquema 7 y la opción de arrancar armado

**Files:**
- Modify: `server/persistence.ts:17` y final de la cadena, `shared/types.ts` (`GameState.schema`), `server/engine.ts` (`createGame`, comando `room.assembled`)
- Test: `tests/plan-migration.test.ts`

**Interfaces:**
- Consumes: `initialGraph('plan')` de la Tarea 1.
- Produces: `GameState.schema: 7`; `completePlan(): Graph` en `server/engine.ts`, el plano con los siete solares en el orden cableado hoy (entrada → seguridad → tienda web → checkout → inventario → pagos → salida); `room.assembled { enabled }` para el operador, solo en `LOBBY`, que arranca las cinco empresas con `completePlan()` y el montaje cerrado.

- [ ] **Step 1: Escribir las pruebas que fallan** en `tests/plan-migration.test.ts`

```ts
test('una partida de esquema 6 recupera con el plano completo y el montaje cerrado', () => {
  const recovered = recoverGame(JSON.stringify(schema6Fixture));
  assert.equal(recovered.schema, 7);
  for (const c of recovered.companies) {
    assert.deepEqual(planServices(c.plan), ['security', 'web', 'checkout', 'inventory', 'payment']);
    assert.equal(c.assembly.active, false);
  }
});

test('una solicitud en vuelo de esquema 6 sigue su recorrido tras recuperar', () => {
  // fixture con una compra a mitad de camino y su traffic.paths[version]
  assert.equal(recovered.companies[0].traffic.requests[id].result, undefined);
  advanceGame(recovered, 5);
  assert.equal(recovered.companies[0].traffic.requests[id].result!.reason, 'OK');
});

test('room.assembled arranca las cinco empresas vendiendo', () => {
  command(game, 'operator', 'room.assembled', { enabled: true });
  assert.ok(game.companies.every(c => sellCapable(c.plan) && !c.assembly.active));
});

test('room.assembled se rechaza con la partida en curso', () => {
  command(game, 'operator', 'room.start');
  assert.equal(command(game, 'operator', 'room.assembled', { enabled: true }).ok, false);
});
```

- [ ] **Step 2: Correr las pruebas y verificar que fallan**

Run: `npx tsx --test tests/plan-migration.test.ts`
Expected: FAIL — la versión 7 no está soportada.

- [ ] **Step 3: Implementar `completePlan` y el paso 6 → 7** en `server/persistence.ts`, siguiendo el estilo de los pasos que ya están: agregar `plan`, cerrar el montaje y dejar `traffic.paths` coherente con el plano sintetizado.

- [ ] **Step 4: Implementar `room.assembled`** en `server/engine.ts`, con el bloqueo fuera de `LOBBY` que ya usan `room.dvr` y `room.product`.

- [ ] **Step 5: Correr las pruebas y verificar que pasan**

Run: `npx tsx --test tests/plan-migration.test.ts`
Expected: PASS

- [ ] **Step 6: Correr la batería completa, el build y los bancos de snapshots**

Run: `npm test && npm run build && npm run bench:snapshots`
Expected: PASS, y el tamaño de snapshot sin crecimiento inesperado por el cuarto grafo.

- [ ] **Step 7: Commit**

```bash
git add server/persistence.ts server/engine.ts shared/types.ts tests/plan-migration.test.ts
git commit -m "feat(plan): migrate saved games to schema 7 with a complete plan"
```

---

# Etapa 2 — Lienzo

## Task 9: Tablero del plano, como lógica probable

**Files:**
- Create: `src/planBoard.ts`
- Test: `tests/plan-board.test.ts`

**Interfaces:**
- Consumes: `PLAN_PIECES`, `PLAN_SLOTS` de la Tarea 1; `missingFor` de la Tarea 2.
- Produces: `boardSlots(plan: Graph, role: Role): { piece: PlanPiece; position: { x: number; y: number }; placed: boolean; mine: boolean; text: string; reason?: string }[]` — un elemento por solar, con `reason` en español para el solar vacío que explica qué se pierde sin esa pieza; `addPiece(plan: Graph, piece: PlanPiece): Graph` y `connect(plan: Graph, source: string, target: string): Graph`, puras y sin mutar la entrada.

Los componentes de React quedan finos a propósito: la lógica del tablero vive acá, que es lo que `node:test` puede ejercitar — igual que `src/notices.ts`.

- [ ] **Step 1: Escribir las pruebas que fallan** en `tests/plan-board.test.ts`

```ts
test('el tablero marca mis piezas según mi rol', () => {
  const slots = boardSlots(initialGraph('plan'), 'devops');
  assert.equal(slots.find(s => s.piece === 'server')!.mine, true);
  assert.equal(slots.find(s => s.piece === 'checkout')!.mine, false);
});

test('el solar vacío explica qué falta, en español', () => {
  const slot = boardSlots(initialGraph('plan'), 'backend').find(s => s.piece === 'exit')!;
  assert.equal(slot.placed, false);
  assert.match(slot.reason!, /respuesta/i);
});

test('agregar una pieza no muta el plano original', () => {
  const plan = initialGraph('plan');
  const next = addPiece(plan, 'exit');
  assert.equal(plan.nodes.length, 2);
  assert.equal(next.nodes.length, 3);
});

test('cada pieza cae en su solar', () => {
  assert.deepEqual(addPiece(initialGraph('plan'), 'payment').nodes.at(-1)!.position, PLAN_SLOTS.payment);
});

test('conectar reemplaza la salida anterior de esa pieza', () => {
  const plan = addPiece(addPiece(initialGraph('plan'), 'exit'), 'checkout');
  const web = plan.nodes.find(n => n.type === 'web')!, checkout = plan.nodes.find(n => n.type === 'checkout')!;
  const next = connect(plan, web.id, checkout.id);
  assert.equal(next.edges.filter(e => e.source === web.id).length, 1);
  assert.equal(next.edges.find(e => e.source === web.id)!.target, checkout.id);
});
```

- [ ] **Step 2: Correr las pruebas y verificar que fallan**

Run: `npx tsx --test tests/plan-board.test.ts`
Expected: FAIL — `src/planBoard.ts` no existe.

- [ ] **Step 3: Implementar `src/planBoard.ts`.**

- [ ] **Step 4: Correr las pruebas y verificar que pasan**

Run: `npx tsx --test tests/plan-board.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/planBoard.ts tests/plan-board.test.ts
git commit -m "feat(plan): add the plan board rules as testable logic"
```

## Task 10: El editor del plano

**Files:**
- Modify: `src/GraphEditor.tsx`, `src/styles.css`
- Test: verificación manual con `npm run dev`; la lógica ya quedó cubierta en la Tarea 9.

**Interfaces:**
- Consumes: `boardSlots`, `addPiece`, `connect` de la Tarea 9; `plan.save`, `plan.publish` de la Tarea 6.
- Produces: `GraphEditor` acepta `domain: 'plan'`.

- [ ] **Step 1: Agregar el modo plano** a `src/GraphEditor.tsx`: solares en posición fija (`nodesDraggable={false}` con las piezas ancladas a `PLAN_SLOTS`), conexiones libres, piezas ajenas visibles y no seleccionables, y solares vacíos dibujados como fantasmas con su motivo.

- [ ] **Step 2: Poner el texto didáctico en la paleta** — la frase de `PLAN_PIECES[type].text` visible antes de arrastrar, no solo en el inspector.

- [ ] **Step 3: Abrir el editor de bloques desde el plano** al tocar inventario o pagos, para que no se perciba como una pestaña paralela.

- [ ] **Step 4: Verificar a mano**

Run: `npm run dev`
Expected: una empresa nueva muestra entrada y tienda web, cinco solares fantasma con su motivo, y colocar la salida más publicar deja la tienda atendiendo navegación.

- [ ] **Step 5: Correr el build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/GraphEditor.tsx src/styles.css
git commit -m "feat(plan): let each role place its own pieces on the plan"
```

## Task 11: Servidores de aplicación en el plano

**Files:**
- Modify: `src/DevOpsConsole.tsx`
- Test: verificación manual con `npm run dev`.

**Interfaces:**
- Consumes: `boardSlots` de la Tarea 9; `infra.scale` que ya existe.
- Produces: nada que otra tarea consuma.

- [ ] **Step 1: Mostrar los servidores como piezas del plano** en la consola, conservando presupuesto, estrategias, despliegue y el interruptor del balanceador.

- [ ] **Step 2: Decir en la pieza qué hospeda** — la tienda web y el checkout, que son los únicos que escalan con ella.

- [ ] **Step 3: Verificar a mano**

Run: `npm run dev`
Expected: colocar un segundo servidor sube la capacidad de tienda web y checkout, y deja iguales seguridad, inventario y pagos.

- [ ] **Step 4: Commit**

```bash
git add src/DevOpsConsole.tsx
git commit -m "feat(plan): place application servers on the plan"
```

## Task 12: El plano en el proyector

**Files:**
- Modify: `src/trafficGeometry.ts:7-9`, `src/TrafficCanvas.tsx`
- Test: `tests/plan-board.test.ts` (extiende la Tarea 9)

**Interfaces:**
- Consumes: `PLAN_SLOTS` de la Tarea 1; `plan` de `PublicCompany` (Tarea 1).
- Produces: `SERVICES` de `src/trafficGeometry.ts` se deriva de `PLAN_SLOTS`, con `AUTH` quedando como posición propia del dibujo.

- [ ] **Step 1: Escribir la prueba que falla**

```ts
test('el proyector y el editor comparten las siete posiciones', () => {
  for (const [piece, key] of [['entry','ENTRY'],['security','GATE'],['web','WEB'],['checkout','CHECK'],['inventory','STOCK'],['payment','PAY'],['exit','OUT']] as const)
    assert.deepEqual([PLAN_SLOTS[piece].x, PLAN_SLOTS[piece].y], [...SERVICES[key]]);
});
```

- [ ] **Step 2: Correr la prueba y verificar que falla**

Run: `npx tsx --test tests/plan-board.test.ts`
Expected: FAIL

- [ ] **Step 3: Derivar `SERVICES` de `PLAN_SLOTS`** sin tocar los valores, de modo que `TRAFFIC_PATHS` siga igual.

- [ ] **Step 4: Dibujar lo que falta** en `src/TrafficCanvas.tsx`: solar vacío donde no hay pieza y camino ausente punteado.

- [ ] **Step 5: Correr las pruebas, el build y verificar a mano**

Run: `npx tsx --test tests/plan-board.test.ts && npm run build && npm run dev`
Expected: PASS, y el proyector muestra cinco planos a medio construir legibles desde el fondo del aula.

- [ ] **Step 6: Commit**

```bash
git add src/trafficGeometry.ts src/TrafficCanvas.tsx tests/plan-board.test.ts
git commit -m "feat(plan): draw the half-built plan on the projector"
```

---

## Cierre de la entrega

- [ ] `npm test` y `npm run build` completos.
- [ ] `npm run bench:traffic`, `npm run bench:snapshots` y `npm run bench:classroom` sin regresión.
- [ ] Informar SHA base de `develop`, SHA final, ramas, pruebas corridas y riesgos pendientes, como pide `AGENTS.md`.
