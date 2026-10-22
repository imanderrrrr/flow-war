import test from 'node:test';
import assert from 'node:assert/strict';

import { admitTraffic, advanceTraffic, serviceRates, settleTraffic, trafficParticles } from '../server/traffic.js';
import { assembledGame, insertBlock } from './helpers.js';

const simulation = () => assembledGame().companies[0];
const advance = (company: ReturnType<typeof simulation>, until: number) => { for (let tick = Math.round(company.traffic.lastTick * 10) + 1; tick <= until * 10; tick++) advanceTraffic(company, tick / 10); };
function conservation(company: ReturnType<typeof simulation>) {
  const state = company.traffic;
  for (const [totals, requests] of [[state.totals, Object.values(state.requests)], [state.legitimate, Object.values(state.requests).filter(r=>r.trafficClass==='legitimate')], [state.malicious, Object.values(state.requests).filter(r=>r.trafficClass==='malicious')]] as const) {
    assert.equal(totals.generated, totals.completed + totals.rejected + totals.abandoned + totals.failed + requests.filter(r=>!r.result).length);
  }
}

test('T01/T08 normal admission executes one real request and one terminal result', () => {
  const company = simulation(); const request = admitTraffic(company, 0);
  assert.equal(request.status, 'QUEUED'); assert.equal(company.successes, 0);
  for (let tick=1;tick<=30;tick++) { advanceTraffic(company,tick/10); conservation(company); }
  assert.equal(request.status, 'COMPLETED'); assert.ok(request.startedAt! >= request.admittedAt!); assert.ok(request.latencyMs! > 0);
  assert.equal(company.successes, 1); assert.equal(request.accounted, true); assert.equal(company.traffic.outbox.length, 1);
  settleTraffic(company,3); assert.equal(company.successes,1);
});

test('T02/T03 operational FIFO grows under overload and starts requests in admission order', () => {
  const company = simulation(); company.traffic.config.rates.web = 1;
  const requests = Array.from({length:12},()=>admitTraffic(company,0)); advance(company,1);
  assert.ok(company.traffic.services.web.waiting.length > 5);
  advance(company,3);
  const started = requests.filter(r=>r.waits.some(v=>v.service==='web'&&v.exit==='SERVICE'));
  assert.deepEqual(started.map(r=>r.id),requests.slice(0,started.length).map(r=>r.id));
  assert.ok(started.length <= 4); conservation(company);
});

test('T04 scaling with a balancer accelerates drain without clearing waiting work', () => {
  const slow = simulation(); slow.traffic.config.rates.web = 2;
  for(let i=0;i<30;i++)admitTraffic(slow,0);
  advance(slow,1); const fast=structuredClone(slow), queued=fast.traffic.services.web.waiting.length;
  fast.servers=4; fast.balancer=true; assert.equal(fast.traffic.services.web.waiting.length,queued);
  advance(slow,2); advance(fast,2);
  assert.ok(fast.traffic.services.web.waiting.length < slow.traffic.services.web.waiting.length);
  const direct=structuredClone(slow);direct.servers=8;direct.balancer=false;assert.equal(serviceRates(direct).web,2);
});

test('T05/T06 zero capacity performs no operations and expires queued requests', () => {
  const company = simulation(); company.infraBudget=0;
  const request=admitTraffic(company,0,'purchase'); advance(company,11);
  assert.equal(request.status,'ABANDONED'); assert.equal(request.result?.reason,'DEADLINE');assert.equal(request.result?.service,'security');
  assert.equal(request.trace.length,0); assert.equal(request.committed,0); assert.equal(request.paid,false); conservation(company);
});

test('T07 full queue produces an explicit rejection and never drops a request', () => {
  const company=simulation(); company.traffic.services.security.capacity=2;company.traffic.config.queues.security=2;
  admitTraffic(company,0);admitTraffic(company,0);const rejected=admitTraffic(company,0,'purchase');settleTraffic(company,0);
  assert.equal(rejected.status,'REJECTED');assert.equal(rejected.result?.reason,'QUEUE_FULL');
  assert.equal(rejected.admittedAt,undefined);assert.equal(company.traffic.totals.rejected,1);conservation(company);
});

test('T09/T10 abandonment loses opportunity only; no sale, debit or inventory effect', () => {
  const company=simulation();company.infraBudget=0;const request=admitTraffic(company,0,'purchase');advance(company,11);
  assert.equal(company.revenue,0);assert.equal(company.lostRevenue,45);assert.equal(company.capital,10000);assert.equal(company.traffic.inventory.stock,100);
  const before=structuredClone(company);advanceTraffic(company,11);settleTraffic(company,11);assert.deepEqual(company,before);
  assert.equal(request.accounted,true);
});

test('fractional capacity survives 100ms steps and is not rounded down to zero', () => {
  const company=simulation();company.traffic.config.rates.security=.3;company.traffic.config.patience.browse=30;
  for(let i=0;i<8;i++)admitTraffic(company,0);advance(company,10);
  assert.equal(company.traffic.services.security.started,3);assert.equal(company.traffic.services.security.waiting.length,5);
});

test('T16 deterministic sprite sampling references real requests without changing outcomes', () => {
  const company=simulation();for(let i=0;i<20;i++)admitTraffic(company,0);advance(company,1);
  const before=structuredClone(company);const small=trafficParticles(company,1,3),large=trafficParticles(company,1,88);
  assert.deepEqual(company,before);assert.deepEqual(small,large.slice(0,3));
  for(const sprite of large)assert.ok(company.traffic.requests[sprite.requestId!]);
});

test('T17 a correctly blocked malicious request is not a dissatisfied legitimate customer', () => {
  const company=simulation();company.security=insertBlock('auth','exit',1,company.security);
  const request=admitTraffic(company,0,'purchase','malicious','forged');advance(company,2);
  assert.equal(request.result?.reason,'SECURITY_REJECTED');assert.equal(company.traffic.legitimate.generated,0);
  assert.equal(company.traffic.metrics.errors,0);assert.equal(company.traffic.metrics.errorRate,0);assert.equal(company.lostRevenue,0);assert.equal(company.revenue,0);
});

test('an inventory reservation survives timeout as an explicit unresolved transaction', () => {
  const company=simulation();company.traffic.config.delays.payment=15;
  const request=admitTraffic(company,0,'purchase');advance(company,11);
  assert.equal(request.status,'ABANDONED');assert.equal(request.committed,1);assert.equal(request.paid,false);
  assert.equal(request.transaction,'PENDING_RESOLUTION');assert.equal(company.traffic.unresolvedCount,1);
  assert.equal(company.traffic.inventory.stock,99);assert.equal(company.revenue,0);assert.equal(company.lostRevenue,45);
});

test('Atomic conditional decrement does not reject a stale preliminary read while actual stock is sufficient', () => {
  const company=simulation();company.backend=insertBlock('atomic');
  const a=admitTraffic(company,0,'purchase'),b=admitTraffic(company,0,'purchase');advance(company,4);
  assert.deepEqual(a.read,b.read);assert.equal(a.status,'COMPLETED');assert.equal(b.status,'COMPLETED');
  assert.equal(company.traffic.inventory.stock,98);assert.equal(company.traffic.inventory.committed,2);assert.equal(company.traffic.inventory.oversold,0);
});

test('a paid purchase that loses its response keeps the confirmed sale without an invented refund or lost sale', () => {
  const company=simulation();const request=admitTraffic(company,0,'purchase');
  for(let tick=1;tick<80;tick++){advanceTraffic(company,tick/10);if(request.paid){company.infraBudget=0;break;}}
  assert.equal(request.paid,true);assert.equal(request.result,undefined);advance(company,11);
  assert.equal(request.status,'ABANDONED');assert.equal(request.transaction,'CONFIRMED');
  assert.equal(company.revenue,45);assert.equal(company.lostRevenue,0);assert.equal(company.capital,10003);
});
