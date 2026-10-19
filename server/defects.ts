import { createHash } from 'node:crypto';
import type { ModuleVersion, DefectCode, SimulatedDefect } from '../shared/simulation.js';

export const DEFECT_CATALOG: Record<DefectCode, { condition: string; effect: string; coverage: string[]; severity: SimulatedDefect['severity'] }> = {
  D01: { condition: 'concurrent writes', effect: 'stale stock commitment', coverage: ['concurrency'], severity: 'critical' },
  D02: { condition: 'two or more coupons on eligible purchase', effect: 'second discount application', coverage: ['integration','regression'], severity: 'high' },
  D03: { condition: 'duplicate business intent', effect: 'repeated commitment and payment', coverage: ['integration','regression'], severity: 'critical' },
  D04: { condition: 'invalid purchase input', effect: 'invalid input accepted', coverage: ['unit','regression'], severity: 'medium' },
  D05: { condition: 'forged authorization', effect: 'forged identity admitted', coverage: ['security'], severity: 'critical' },
  D06: { condition: '32 or more waiting operations', effect: '1500ms added service delay', coverage: ['load'], severity: 'high' },
  D07: { condition: 'interruption after unpaid reservation', effect: 'reservation remains unresolved', coverage: ['integration','regression'], severity: 'high' },
  D08: { condition: 'synthetic injection without effective WAF', effect: 'unsafe purchase admitted', coverage: ['security'], severity: 'critical' },
};
export function generateDefects(seed: number, module: ModuleVersion): SimulatedDefect[] {
  const c = module.configuration;
  const candidates: DefectCode[] = c.kind === 'concurrency' ? ['D01','D06'] : c.kind === 'discount' || c.kind === 'coupon' ? ['D02','D06'] : c.kind === 'inventory' ? ['D04','D07'] : ['D03','D05','D07','D08'];
  // Equivalent work in each corporate namespace receives equivalent draws.
  // The absolute company index cannot be a systematic advantage.
  const localId = module.id.replace(/^C\d+-/, '');
  return candidates.filter(code => {
    const digest = createHash('sha256').update(JSON.stringify([seed, localId, module.version, c, module.dependencies.map(d => [d.id.replace(/^C\d+-/, ''), d.version]), 'defects-1', code])).digest();
    const complexity = module.dependencies.length * .04 + (c.kind === 'coupon' && c.stackable ? .1 : 0);
    return digest.readUInt32BE(0) / 0x100000000 < Math.min(.65, .18 + complexity);
  }).map(code => ({ id: `${module.id}@${module.version}:${code}`, code, severity: DEFECT_CATALOG[code].severity, profile: 'defects-1', artifactId: module.id, version: module.version }));
}
export const hasDefect = (m: ModuleVersion, code: DefectCode) => m.defects.some(d => d.code === code);
