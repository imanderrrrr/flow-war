import test from 'node:test';
import assert from 'node:assert/strict';
import { initialGraph } from '../server/engine.js';
import { PLAN_SLOTS } from '../shared/plan.js';
import { addPiece, boardSlots, connect } from '../src/planBoard.js';

test('el tablero marca mis piezas según mi rol', () => {
  const slots = boardSlots(initialGraph('plan'), 'devops');
  assert.equal(slots.find(s => s.piece === 'server')!.mine, true);
  assert.equal(slots.find(s => s.piece === 'checkout')!.mine, false);
  const backend = boardSlots(initialGraph('plan'), 'backend');
  assert.equal(backend.find(s => s.piece === 'checkout')!.mine, true);
  assert.equal(backend.find(s => s.piece === 'security')!.mine, false);
  assert.equal(backend.find(s => s.piece === 'entry')!.mine, false, 'la entrada no es de nadie');
});

test('el tablero tiene un elemento por solar, y la tienda ya viene puesta', () => {
  const slots = boardSlots(initialGraph('plan'), 'backend');
  assert.equal(slots.length, 8);
  assert.deepEqual(slots.filter(s => s.placed).map(s => s.piece), ['entry', 'web']);
});

test('el solar vacío explica qué falta, en español', () => {
  const slot = boardSlots(initialGraph('plan'), 'backend').find(s => s.piece === 'exit')!;
  assert.equal(slot.placed, false);
  assert.match(slot.reason!, /respuesta/i);
  const placed = boardSlots(initialGraph('plan'), 'backend').find(s => s.piece === 'web')!;
  assert.equal(placed.reason, undefined, 'un solar ocupado no tiene motivo de ausencia');
  assert.match(placed.text, /vidriera/i, 'pero sí explica para qué sirve');
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
  const web = plan.nodes.find(n => n.type === 'web')!, checkout = plan.nodes.find(n => n.type === 'checkout')!, exit = plan.nodes.find(n => n.type === 'exit')!;
  const first = connect(plan, web.id, exit.id);
  assert.equal(first.edges.find(e => e.source === web.id)!.target, exit.id);
  const next = connect(first, web.id, checkout.id);
  assert.equal(next.edges.filter(e => e.source === web.id).length, 1);
  assert.equal(next.edges.find(e => e.source === web.id)!.target, checkout.id);
  assert.equal(first.edges.filter(e => e.source === web.id).length, 1, 'conectar no muta el plano anterior');
});

test('la bahía de servidores admite varias piezas apiladas', () => {
  const plan = addPiece(addPiece(initialGraph('plan'), 'server'), 'server');
  assert.equal(plan.nodes.filter(n => n.type === 'server').length, 2);
  assert.equal(new Set(plan.nodes.map(n => n.id)).size, plan.nodes.length, 'cada pieza con su identificador');
});

test('un solar ya ocupado no acepta una segunda pieza', () => {
  const plan = addPiece(initialGraph('plan'), 'exit');
  assert.deepEqual(addPiece(plan, 'exit'), plan);
});

test('el proyector y el editor comparten las siete posiciones', async () => {
  const { SERVICES } = await import('../src/trafficGeometry.js');
  for (const [piece, key] of [['entry','ENTRY'],['security','GATE'],['web','WEB'],['checkout','CHECK'],['inventory','STOCK'],['payment','PAY'],['exit','OUT']] as const)
    assert.deepEqual([PLAN_SLOTS[piece].x, PLAN_SLOTS[piece].y], [...SERVICES[key]]);
});

test('derivar las posiciones del catálogo no mueve los caminos del proyector', async () => {
  const { SERVICES, TRAFFIC_PATHS } = await import('../src/trafficGeometry.js');
  // The polylines are built from the very same tuples, so a sprite still finds its stop by identity.
  assert.equal(TRAFFIC_PATHS.purchase.indexOf(SERVICES.WEB), 2);
  assert.equal(TRAFFIC_PATHS.purchase.at(-1), SERVICES.OUT);
  assert.deepEqual([...TRAFFIC_PATHS.browse[0]], [70, 295]);
});

test('los puntos de conexión de piezas vecinas quedan a un arrastre de distancia', async () => {
  const { PLAN_NODE_WIDTH, boardPoint } = await import('../src/planBoard.js');
  // The roads a team draws, left to right. Each piece is centred on its board point.
  const roads = [['entry', 'security'], ['security', 'web'], ['web', 'checkout'], ['checkout', 'inventory'], ['checkout', 'payment'], ['inventory', 'exit'], ['payment', 'exit']] as const;
  for (const [from, to] of roads) {
    const gap = (boardPoint(to).x - PLAN_NODE_WIDTH / 2) - (boardPoint(from).x + PLAN_NODE_WIDTH / 2);
    assert.ok(gap >= PLAN_NODE_WIDTH / 2, `${from} → ${to}: solo ${gap} unidades entre el punto de salida y el de entrada`);
  }
});

test('el editor estira el mapa del proyector sin reordenarlo', async () => {
  const { boardPoint } = await import('../src/planBoard.js');
  const pieces = ['entry', 'security', 'web', 'checkout', 'inventory', 'payment', 'exit', 'server'] as const;
  for (const a of pieces) {
    assert.equal(boardPoint(a).y, PLAN_SLOTS[a].y, `${a} conserva su fila del proyector`);
    for (const b of pieces) if (PLAN_SLOTS[a].x < PLAN_SLOTS[b].x) assert.ok(boardPoint(a).x < boardPoint(b).x, `${a} sigue a la izquierda de ${b}`);
  }
  assert.deepEqual(boardSlots(initialGraph('plan'), 'backend').find(s => s.piece === 'checkout')!.position, boardPoint('checkout'), 'el solar vacío se dibuja donde caerá la pieza');
});

test('un borrador dibujado sobre un plano viejo toma de producción lo que publicaron los demás roles', async () => {
  const { editableBoard } = await import('../src/planBoard.js');
  const { assertPlanOwnership } = await import('../shared/plan.js');
  const { planGraph } = await import('../shared/plan.js');
  // Backend saved a reordering before Seguridad's perímetro reached production.
  const stale = planGraph(['entry', 'web', 'checkout', 'payment', 'inventory', 'exit']);
  const production = planGraph(['entry', 'security', 'web', 'checkout', 'inventory', 'payment', 'exit']);
  const board = editableBoard(production, stale, 'backend');
  const type = new Map(board.nodes.map(n => [n.id, n.type]));
  const roads = board.edges.map(e => `${type.get(e.source)}>${type.get(e.target)}`).sort();
  assert.deepEqual(roads, ['checkout>payment', 'entry>security', 'inventory>exit', 'payment>inventory', 'security>web', 'web>checkout'],
    'el perímetro y su camino vienen de producción; el orden propio de Backend se conserva');
  assert.doesNotThrow(() => assertPlanOwnership(production, board, 'backend'), 'el borrador resultante se puede enviar');
});

test('un borrador al día se edita tal como se guardó', async () => {
  const { editableBoard } = await import('../src/planBoard.js');
  const { planGraph } = await import('../shared/plan.js');
  const production = planGraph(['entry', 'web', 'checkout', 'inventory', 'payment', 'exit']);
  const draft = planGraph(['entry', 'security', 'web', 'checkout', 'inventory', 'payment', 'exit']);
  assert.equal(editableBoard(production, draft, 'security'), draft);
  assert.equal(editableBoard(production, undefined, 'security'), production);
});
