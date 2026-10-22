# Consecuencias de la auditoría externa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un hueco de seguridad encontrado por un auditor externo deje de ser un contador y pase a destruir a la empresa de a poco, cada vez más rápido, hasta que Seguridad configure el control que falta.

**Architecture:** Un `AuditFinding` abierto es una fuga: mientras exista, cada solicitud anómala no contenida de su categoría le cuesta dinero y reputación a la empresa y alimenta las quejas de clientes. Como el tráfico anómalo crece durante la partida, la escalada no se programa: emerge de la curva. Encima, el auditor puede lanzar una prueba sostenida acotada que concentra el daño propio del módulo auditado. Todo entra por el pipeline de comandos existente.

**Tech Stack:** Node 25, TypeScript, React 19, Vite, Express 5, Socket.IO, node:sqlite. Pruebas con `tsx --test`.

**Spec:** [`docs/superpowers/specs/2026-10-22-consecuencias-auditoria-externa-design.md`](../specs/2026-10-22-consecuencias-auditoria-externa-design.md)

## Global Constraints

- Rama `codex/sala-pin-sorteo-equipos`, worktree `.claude/worktrees/sala-equipos`. No tocar `main` ni `develop`, sin force-push.
- Código, comentarios y mensajes de commit en inglés; documentación y todo texto que ve el estudiante, en español.
- Vocabulario de producto neutral: «prueba de control», «tráfico anómalo simulado», «controles pendientes», «hallazgo», «saturación». Nunca nombrar técnicas reales de ataque.
- Toda operación que cambie estado entra por el pipeline de comandos (`action.execute` → `dispatchCommand` → `executeCommand`), con validación estricta, idempotencia por ID y ACK después del COMMIT.
- Determinismo: ninguna decisión nueva puede usar `Math.random()`. El motor económico debe reproducirse igual al repetir una partida.
- Privacidad: la empresa nunca ve la identidad del auditor; el contador global de accesos indebidos sigue siendo solo del docente; `pendingControls` no lee defectos simulados ocultos.
- `npm test` y `FLOW_GROUP_COMMIT=0 npm test` deben pasar al final de cada tarea; `npm run build` al final del plan.

## Review Focus

- **Hallazgo duplicado:** dos pruebas seguidas sobre el mismo (empresa, módulo, control) no deben abrir dos hallazgos ni cobrar la multa dos veces (Task 2).
- **Empresa sin capital:** el sangrado no debe llevar el capital a negativo ni romper la contabilidad; debe detenerse en cero (Task 3).
- **Empresa eliminada o partida terminada:** hallazgos abiertos y pruebas sostenidas deben dejar de sangrar y de cobrar (Task 3, Task 4).
- **Reabastecimiento suspendido colgado:** si una ventana termina por cierre del hallazgo, eliminación o fin de partida, el reabastecimiento debe volver siempre a su estado normal (Task 5).
- **Avalancha de quejas:** muchas solicitudes no contenidas por segundo no deben producir una queja por solicitud; debe respetarse el agrupamiento que ya hace FlowSlack (Task 6).

---

### Task 1: Curva de tráfico más lenta

**Files:**
- Modify: `server/traffic.ts:248` (demanda), `server/traffic.ts:258-259` (tráfico anómalo)
- Modify: `server/engine.ts:348,350` (aviso de tráfico anómalo al 25 %)
- Test: `tests/traffic.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `generateTraffic(company, at, dt, duration)` conserva su firma; cambian solo los valores de la curva.

- [ ] **Step 1: Write the failing test**

En `tests/traffic.test.ts`, con `createGame()` (duración 1500, `customers` inicial 1000):

```ts
test('la demanda y el tráfico anómalo suben despacio al principio', () => {
  const g = createGame(), c = g.companies[0];
  const demand = (at: number) => (5 + 295 * (at / 1500) ** 2.5) * c.customers / 5000;
  assert.equal(Math.round(demand(600) * 10) / 10, 2.7);   // minuto 10
  assert.equal(Math.round(demand(1500) * 10) / 10, 12);   // minuto 25, sin cambios en el tope
  // El tráfico anómalo arranca al 25 % de la partida, no al 12 %.
  g.status = 'RUNNING'; advanceGame(g, 300);
  assert.equal(c.traffic.malicious.generated, 0, 'antes del minuto 6 no hay tráfico anómalo');
  advanceGame(g, 200);
  assert(c.traffic.malicious.generated > 0, 'después del minuto 6 sí');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/traffic.test.ts`
Expected: FAIL — hoy hay tráfico anómalo antes del minuto 6.

- [ ] **Step 3: Cambiar las dos curvas**

En `server/traffic.ts:248` el exponente de la demanda pasa de `1.25` a `2.5`. En `server/traffic.ts:258` la compuerta pasa de `duration * .12` a `duration * .25`, y en `:259` la tasa pasa de `2 + 18 * at / duration` a `2 + 18 * (at / duration) ** 2.5`. En `server/engine.ts:348` y `:350`, `.12` pasa a `.25` para que el aviso coincida.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/traffic.test.ts`
Expected: PASS

- [ ] **Step 5: Reparar las pruebas que dependían del volumen anterior**

Run: `npm test`
Las pruebas que fallen por volumen (no por lógica) se ajustan a los valores nuevos. Si una falla por lógica, es un error de este cambio y hay que corregir el código, no la prueba.

- [ ] **Step 6: Commit**

```bash
git add server/traffic.ts server/engine.ts tests/
git commit -m "feat(traffic): ramp customer and anomalous traffic more slowly"
```

---

### Task 2: El hallazgo, la multa y su cierre

**Files:**
- Modify: `shared/auditor.ts` (tipos y constantes)
- Modify: `server/auditor.ts` (abrir, cerrar y proyectar hallazgos)
- Modify: `server/engine.ts:362` (cerrar hallazgos en cada tick) y la proyección de `operations`
- Test: `tests/auditor.test.ts`

**Interfaces:**
- Consumes: `pendingControls(c, node, release)`, `AuditProbe`, `AUDIT_PROBE` de Task 0 (ya en la rama).
- Produces:
  - `type AuditFinding = { id: string; companyId: number; nodeId: string; module: string; check: ControlCheck; category: AnomalyCategory; openedAt: number; closedAt?: number; fine: number; uncontained: number; lost: number }`
  - `AuditorState.findings: AuditFinding[]`
  - `AUDIT_LEAK = { fine: 250, costPerRequest: 1, reputationPerRequest: 0.02 } as const` en `shared/auditor.ts`
  - `openFinding(g, probe, emit): AuditFinding | undefined` y `closeSettledFindings(g, c, emit): void` en `server/auditor.ts`
  - `findingsFor(c: Company): AuditFinding[]` para la proyección de la empresa

- [ ] **Step 1: Write the failing test**

```ts
test('un hallazgo se abre una vez, cobra Q250 y se cierra al configurar el control', () => {
  const g = running(), c = g.companies[0], capital = c.capital;
  assert(probe(g, auditor(), { companyId: 0, nodeId: 'backend-write', check: 'waf' }).ok);
  advanceGame(g, 40);
  const finding = g.auditors!.findings[0];
  assert.equal(finding.check, 'waf'); assert.equal(finding.fine, 250);
  assert.equal(Math.round(capital - c.capital), 250);
  // Una segunda prueba sobre el mismo hueco no abre otro hallazgo ni cobra de nuevo.
  advanceGame(g, 60);
  assert(probe(g, auditor(), { companyId: 0, nodeId: 'backend-write', check: 'waf' }).ok);
  advanceGame(g, 40);
  assert.equal(g.auditors!.findings.length, 1);
  // Seguridad configura el control: el hallazgo se cierra.
  deployWithControls(g, 'backend-write', [{ kind: 'input' }]);
  advanceGame(g, 1);
  assert(g.auditors!.findings[0].closedAt !== undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/auditor.test.ts`
Expected: FAIL — `g.auditors.findings` no existe.

- [ ] **Step 3: Implementar hallazgos en `server/auditor.ts`**

`openFinding` se llama donde hoy una prueba se marca `finished` con `notContained > 0`; no abre nada si ya hay un hallazgo abierto para esa terna. Al abrir, descuenta `AUDIT_LEAK.fine` del capital (sin bajar de cero), emite el evento de la empresa y una alerta en `#alertas-sistema` vía `addSlackMessage`, sin identidad del auditor. `closeSettledFindings` recorre los hallazgos abiertos de la empresa y cierra los que ya no figuran en `pendingControls` del módulo, informándolo en FlowSlack. Se llama desde `engine.ts` junto a `advanceProbes`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/auditor.test.ts`
Expected: PASS

- [ ] **Step 5: Proyectar el hallazgo a Seguridad y al CTO**

Agregar `findings` a `OperationsView` y llenarlo en `project()` solo para los roles `security`, `cto` y `operator` de esa empresa, con módulo, control, accesos y estado — nunca con la identidad del auditor. Probar que un rol ajeno (`backend`) y otra empresa no lo reciben.

- [ ] **Step 6: Commit**

```bash
git add shared/auditor.ts server/auditor.ts server/engine.ts tests/auditor.test.ts
git commit -m "feat(auditor): record audit findings with a one-time fine and automatic closing"
```

---

### Task 3: El sangrado crónico

**Files:**
- Modify: `server/auditor.ts` (atribución y cobro)
- Modify: `server/traffic.ts:174` (punto de liquidación de solicitudes)
- Test: `tests/auditor.test.ts`

**Interfaces:**
- Consumes: `AuditFinding`, `AUDIT_LEAK`.
- Produces: `chargeLeak(g, c, request): void` en `server/auditor.ts`, llamada al liquidar cada solicitud anómala no contenida.

- [ ] **Step 1: Write the failing test**

```ts
test('un hallazgo abierto sangra, y el daño por minuto crece con el tráfico', () => {
  const g = running(), c = g.companies[0];
  assert(probe(g, auditor(), { companyId: 0, nodeId: 'backend-write', check: 'waf' }).ok);
  advanceGame(g, 40);
  const finding = g.auditors!.findings[0], capital = c.capital, reputation = c.reputation;
  advanceGame(g, 120);
  assert(finding.uncontained > 0, 'se atribuyen las solicitudes no contenidas');
  assert(c.capital < capital, 'pierde dinero'); assert(c.reputation < reputation, 'pierde reputación');
  const early = capital - c.capital;
  // Más adelante en la partida el mismo hueco duele más, porque hay más tráfico.
  g.tick = 1200; const before = c.capital; advanceGame(g, 120);
  assert(capital - c.capital - early > early, 'el daño por minuto crece');
});

test('el sangrado no lleva el capital por debajo de cero ni sigue tras cerrar el hallazgo', () => {
  const g = running(), c = g.companies[0];
  assert(probe(g, auditor(), { companyId: 0, nodeId: 'backend-write', check: 'waf' }).ok);
  advanceGame(g, 40); c.capital = 5; advanceGame(g, 120);
  assert(c.capital >= 0);
  deployWithControls(g, 'backend-write', [{ kind: 'input' }]); advanceGame(g, 1);
  const closed = c.capital; advanceGame(g, 60);
  assert.equal(c.capital <= closed, true); assert.equal(g.auditors!.findings[0].uncontained, g.auditors!.findings[0].uncontained);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/auditor.test.ts`
Expected: FAIL — hoy nada cobra por solicitud no contenida.

- [ ] **Step 3: Implementar `chargeLeak(g, c, request)`**

Se llama en `settleTraffic` (`server/traffic.ts:174`) para cada solicitud con `trafficClass === 'malicious'` y `securityAllowed === true`. Busca un hallazgo abierto de esa empresa cuya `category` coincida con `request.attackKind`; si lo hay, incrementa `uncontained`, suma `AUDIT_LEAK.costPerRequest` a `finding.lost`, descuenta ese monto del capital sin bajar de cero y resta `AUDIT_LEAK.reputationPerRequest` a la reputación acotada a [0, 100]. El decremento es por **cantidad absoluta** de solicitudes, no por proporción: así el daño arranca imperceptible y crece con el tráfico.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/auditor.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/auditor.ts server/traffic.ts tests/auditor.test.ts
git commit -m "feat(auditor): bleed money and reputation while a finding stays open"
```

---

### Task 4: La prueba sostenida y sus topes

**Files:**
- Modify: `shared/actions.ts`, `server/action-validation.ts` (comando `audit.sustain`)
- Modify: `shared/auditor.ts`, `server/auditor.ts`
- Test: `tests/auditor.test.ts`

**Interfaces:**
- Consumes: `AuditFinding`, `serviceRates(company)` de `server/traffic.ts`.
- Produces:
  - `'audit.sustain': { findingId: string }` en `ActionParameters`, con `entry(['auditor'], 'operation')` en `ACTION_CATALOG`
  - `AUDIT_SUSTAIN = { durationSeconds: 60, cooldownSeconds: 120, rateShare: 1/3, queueShare: 2/3 } as const`
  - `AuditFinding.sustain?: { startedAt: number; endsAt: number }`

- [ ] **Step 1: Write the failing test**

```ts
test('la prueba sostenida respeta sus topes y nunca deja a la empresa sin capacidad', () => {
  const g = running(), c = g.companies[0];
  assert(probe(g, auditor(), { companyId: 0, nodeId: 'backend-write', check: 'waf' }).ok);
  advanceGame(g, 40);
  const finding = g.auditors!.findings[0];
  assert.equal(sustain(g, auditor(), { findingId: finding.id }).ok, true);
  for (let i = 0; i < 600; i++) {
    advanceGame(g, 0.1);
    assert(serviceRates(c).web > 0, 'la capacidad nunca llega a cero');
  }
  assert(c.traffic.totals.completed > 0, 'la empresa sigue vendiendo');
  assert.equal(c.eliminated, false);
  assert(finding.sustain === undefined || g.tick >= finding.sustain.endsAt);
});

test('sostener exige un hallazgo abierto propio y respeta la espera', () => {
  const g = running();
  assert.equal(sustain(g, auditor(), { findingId: 'AF-404' }).code, 'NOT_FOUND');
});

test('la ventana se corta si la empresa sale de la partida o termina el juego', () => {
  const g = running(), c = g.companies[2];
  openFindingOn(g, 2, 'backend-write', 'waf');
  assert(sustain(g, auditor(), { findingId: g.auditors!.findings[0].id }).ok);
  advanceGame(g, 3);
  c.serviceMode = { mode: 'FULL_MAINTENANCE', since: -1000 }; advanceGame(g, 0.1);
  assert.equal(c.eliminated, true);
  assert.equal(g.auditors!.findings[0].sustain, undefined, 'la ventana quedó cerrada');
});
```

Este paso agrega también dos ayudas al archivo de pruebas, usadas por esta tarea y la siguiente:
`sustain(g, who, payload)`, que envía `audit.sustain` por `applyCommand` como ya hace `probe`, y
`openFindingOn(g, companyId, nodeId, check)`, que lanza una prueba, la deja terminar y devuelve el hallazgo abierto.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/auditor.test.ts`
Expected: FAIL — `audit.sustain` no existe.

- [ ] **Step 3: Implementar el comando y la ventana**

`auditCommand` acepta `audit.sustain` además de `audit.probe`: valida que el hallazgo exista, esté abierto, sea de un auditor con ese hallazgo a la vista, que no haya otra ventana en curso y que haya pasado `cooldownSeconds`. Abre `finding.sustain`. En `advanceProbes`, mientras la ventana esté abierta, se admite tráfico anómalo de la categoría del hallazgo con dos topes: tasa máxima `serviceRates(c).web * rateShare`, y no se admite nada si la cola del servicio objetivo supera `queueShare` de su capacidad. La ventana se cierra al llegar a `endsAt`, al cerrarse el hallazgo, al eliminarse la empresa o al terminar la partida.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/auditor.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add shared/ server/ tests/auditor.test.ts
git commit -m "feat(auditor): add the bounded sustained control test with queue and rate caps"
```

---

### Task 5: El daño propio de cada módulo

**Files:**
- Modify: `server/auditor.ts`
- Modify: `server/engine.ts:363` (reabastecimiento suspendido)
- Modify: `server/traffic.ts` (ingreso no cobrado y confirmación fallida)
- Test: `tests/auditor.test.ts`

**Interfaces:**
- Consumes: `AuditFinding.sustain`, `restockTraffic(company, amount)`.
- Produces: `sustainEffect(c: Company, finding: AuditFinding): 'entry' | 'hoard' | 'zero' | 'uncharged' | 'confirmation'` en `server/auditor.ts`, derivado del tipo del nodo auditado; y `suspendsRestock(g, c): boolean`.

Mapa fijo, por tipo de nodo del módulo auditado:

| Nodo | Efecto | Qué hace |
| --- | --- | --- |
| `entry` | `entry` | Solo volumen sobre la cola de entrada |
| `read` | `hoard` | Suspende el reabastecimiento mientras dura la ventana |
| `write` | `zero` | Pone `inventory.stock = 0` al abrir la ventana y suspende el reabastecimiento |
| `payment` | `uncharged` | Las compras legítimas que se completan no suman ingreso; el monto va a ingreso perdido |
| `exit` | `confirmation` | Una parte de las compras legítimas completadas registra mala experiencia del cliente |

- [ ] **Step 1: Write the failing test**

```ts
test('auditar Write Stock deja el inventario en cero durante la ventana y se recupera al cerrarse', () => {
  const g = running(), c = g.companies[0];
  openFindingOn(g, 'backend-write', 'waf');          // ayuda del archivo de pruebas
  const finding = g.auditors!.findings[0];
  assert(sustain(g, auditor(), { findingId: finding.id }).ok);
  advanceGame(g, 5);
  assert.equal(c.traffic.inventory.stock, 0, 'ventas frenadas');
  advanceGame(g, 70);
  assert(c.traffic.inventory.stock > 0, 'el reabastecimiento lo recupera');
});

test('el reabastecimiento vuelve aunque la ventana termine por el cierre del hallazgo', () => {
  const g = running(), c = g.companies[0];
  openFindingOn(g, 0, 'backend-read', 'waf');
  assert(sustain(g, auditor(), { findingId: g.auditors!.findings[0].id }).ok);
  advanceGame(g, 5);
  deployWithControls(g, 'backend-read', [{ kind: 'input' }]);
  const stock = c.traffic.inventory.stock; advanceGame(g, 5);
  assert(c.traffic.inventory.stock >= stock, 'el motor volvió a reabastecer');
});

test('auditar Payment deja compras legítimas sin cobrar', () => {
  const g = running(), c = g.companies[0];
  openFindingOn(g, 'backend-payment', 'auth');
  const revenue = c.revenue, lost = c.lostRevenue;
  assert(sustain(g, auditor(), { findingId: g.auditors!.findings[0].id }).ok);
  advanceGame(g, 30);
  assert.equal(c.revenue, revenue, 'no factura durante la ventana');
  assert(c.lostRevenue > lost, 'el monto se registra como ingreso perdido');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/auditor.test.ts`
Expected: FAIL — `sustainEffect` no existe.

- [ ] **Step 3: Implementar los cinco efectos**

`sustainEffect` mapea el tipo del nodo al efecto. En `engine.ts:363`, `restockTraffic(c)` se saltea cuando `suspendsRestock(g, c)` es verdadero. El efecto `zero` pone el stock en cero una sola vez al abrir la ventana. `uncharged` y `confirmation` se aplican al liquidar compras legítimas en `settleTraffic`, durante la ventana y solo para esa empresa. Como en estos dos casos el cliente no falla por falta de servicio, cada uno **emite además su queja** por el camino de FlowSlack (cobro para `uncharged`, confirmación para `confirmation`), con el agrupamiento habitual. Al cerrarse la ventana por cualquier vía, el reabastecimiento vuelve a correr sin dejar estado colgado.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/auditor.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/ tests/auditor.test.ts
git commit -m "feat(auditor): give each audited module its own sustained damage"
```

---

### Task 6: Quejas humanas y notificación en pantalla

**Files:**
- Modify: `server/flowslack.ts:25` (catálogo de quejas)
- Create: `src/CustomerNotices.tsx`
- Modify: `src/App.tsx` (montar el componente en el espacio de trabajo), `src/styles.css`
- Test: `tests/flowslack-auto.test.ts`

**Interfaces:**
- Consumes: `slackFact(g, f)`, `Snapshot.slack`.
- Produces: componente `CustomerNotices` sin props, que lee `snapshot.slack` del store.

- [ ] **Step 1: Write the failing test**

```ts
test('las quejas suenan a persona y siguen agrupándose', () => {
  const g = createGame();
  for (let i = 0; i < 40; i++) observe(g, 'request.settled', 0, { requestId: `C0-O${i}`, customerId: `c${i}`, trafficClass: 'legitimate', type: 'purchase', result: { status: 'REJECTED', reason: 'OUT_OF_STOCK' } });
  const texts = g.slack.messages.filter(m => m.channel === 'soporte-clientes').map(m => m.text);
  assert(texts.length < 40, 'se agrupan, no una queja por solicitud');
  assert(texts.some(t => /la necesitaba|hace un rato|llevo tres intentos/.test(t)), 'suenan a persona');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/flowslack-auto.test.ts`
Expected: FAIL — los textos actuales no contienen esas frases.

- [ ] **Step 3: Ampliar el catálogo de quejas**

En `server/flowslack.ts`, cada situación (`timeout`, `failure:OUT_OF_STOCK`, `failure:*`, `slow`, y las dos nuevas de cobro y confirmación) gana variantes en español coloquial, elegidas con el mismo `variant(g, f)` determinista que ya existe. Textos exactos de la sección 7 del spec, incluida la señal de que antes sí funcionaba.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/flowslack-auto.test.ts`
Expected: PASS

- [ ] **Step 5: Implementar `CustomerNotices`**

Componente que observa las quejas nuevas de `soporte-clientes` en el snapshot y las muestra apiladas abajo a la derecha con estética de notificación de mensaje de texto: autor, texto y hora, entrando de a una y desapareciendo a los pocos segundos. Máximo tres visibles a la vez. Un botón silencia las notificaciones sin dejar de registrarlas en FlowSlack. Se monta en el espacio de trabajo de los roles de empresa.

- [ ] **Step 6: Verificar en el navegador**

Levantar el servidor local con la API de Messages simulada (sin gasto) y comprobar en 375 px que las notificaciones entran, se apilan, se van solas y que el botón de silencio funciona.

- [ ] **Step 7: Commit**

```bash
git add server/flowslack.ts src/ tests/flowslack-auto.test.ts
git commit -m "feat(ui): surface customer complaints as text-message notices"
```

---

### Task 7: Calibración medida

**Files:**
- Create: `scripts/audit-calibration.ts`
- Modify: `shared/auditor.ts` (valores finales de `AUDIT_LEAK`)
- Modify: `docs/benchmarks/` (evidencia)

**Interfaces:**
- Consumes: `AUDIT_LEAK`, `createGame`, `step`.
- Produces: `npm run bench:audit` que imprime, para una partida completa, capital, reputación y clientes de una empresa con el hallazgo ignorado frente a otra que lo arregla a los dos minutos.

- [ ] **Step 1: Escribir el script de medición**

Simula una partida completa con dos escenarios sobre la misma semilla: hallazgo ignorado y hallazgo corregido temprano. Imprime capital, reputación, clientes y quejas al final de cada uno.

- [ ] **Step 2: Correrlo y ajustar los valores**

Run: `npm run bench:audit`
Criterios del spec: arreglarlo en los primeros minutos cuesta poco más que los Q250 de la multa; ignorarlo hasta el final deja a la empresa en crisis y perdiendo clientes. Ajustar `costPerRequest` y `reputationPerRequest` hasta cumplirlos.

- [ ] **Step 3: Fijar una prueba de regresión con los valores elegidos**

En `tests/auditor.test.ts`, una prueba que afirme los dos criterios anteriores con los valores finales, para que una calibración futura no los rompa en silencio.

- [ ] **Step 4: Commit**

```bash
git add scripts/audit-calibration.ts shared/auditor.ts docs/benchmarks/ tests/auditor.test.ts package.json
git commit -m "test(auditor): calibrate the leak against measured full-game runs"
```

---

### Task 8: Documentación y entrega

**Files:**
- Modify: `docs/23-auditor-externo-y-modulos-con-claude.md`
- Modify: `README.md`
- Test: suites completas

- [ ] **Step 1: Documentar**

Agregar al doc 23 las secciones de hallazgo, sangrado crónico, prueba sostenida, daño por módulo, quejas y notificación, y la curva de tráfico nueva. Anotar explícitamente que la curva **cambia la línea base económica** y que los benchmarks de entregas anteriores dejan de comparar directamente.

- [ ] **Step 2: Correr todo**

Run: `npm test` y `FLOW_GROUP_COMMIT=0 npm test` y `npm run build`
Expected: todo en verde.

- [ ] **Step 3: Commit y actualizar el PR #6**

```bash
git add docs/ README.md
git commit -m "docs(auditor): document audit consequences and the slower traffic ramp"
git push origin codex/sala-pin-sorteo-equipos
```

Actualizar título y cuerpo del PR #6, terminando con la línea de atribución.
