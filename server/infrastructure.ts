import type { Company, Infrastructure, ServiceId } from '../shared/types.js';

export function initialInfrastructure(): Infrastructure { return { instances: [{ id: 1, status: 'UP' }], stoppedServices: [] }; }
export function syncInfrastructure(c: Company) {
  c.infrastructure ??= initialInfrastructure();
  c.infrastructure.instances = Array.from({ length: c.servers }, (_, i) => c.infrastructure.instances.find(s => s.id === i + 1) ?? { id: i + 1, status: 'UP' });
  return c.infrastructure;
}
export function advanceInfrastructure(c: Company, now: number) {
  for (const instance of syncInfrastructure(c).instances) if (instance.status === 'RESTARTING' && now >= instance.readyAt!) { instance.status = 'UP'; delete instance.readyAt; }
}
export function restart(c: Company, now: number, duration: number, serverId?: number) {
  const infra = syncInfrastructure(c);
  const instances = serverId === undefined ? infra.instances : infra.instances.filter(s => s.id === serverId);
  if (!instances.length) throw new Error('Servidor no encontrado.');
  if (instances.some(s => s.status === 'RESTARTING')) throw new Error('Reinicio ya en curso.');
  for (const instance of instances) { instance.status = 'RESTARTING'; instance.readyAt = now + duration; }
  if (effectiveServers(c) === 0) for (const request of Object.values(c.traffic.requests)) {
    if (!request.result && request.paid && request.retryPolicy && (request.retryCount ?? 0) + 1 < request.retryPolicy.maxAttempts && now + duration + request.retryPolicy.delayMs / 1000 < request.deadline) request.recoveryRetry = true;
  }
}
export function effectiveServers(c: Company) {
  const candidates = c.balancer ? Array.from({ length: c.servers }, (_, i) => i + 1) : [1];
  return candidates.filter(id => !c.infrastructure?.instances.some(s => s.id === id && s.status !== 'UP')).length;
}
export function setService(c: Company, service: ServiceId, stopped: boolean) {
  const infra = syncInfrastructure(c);
  infra.stoppedServices = infra.stoppedServices.filter(id => id !== service);
  if (stopped) infra.stoppedServices.push(service);
}
