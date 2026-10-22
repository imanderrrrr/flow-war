import { generateDefects } from './defects.js';
import type { Company, GameState, Graph, Identity, Change } from '../shared/types.js';
import type { CompanyRuntime, ExecutionRelease, ModuleVersion } from '../shared/simulation.js';
import { moduleConfiguration, securityConfiguration, validateParameters } from './action-validation.js';
import { route } from './graphs.js';

export function initialOperations(): CompanyRuntime['operations'] { return { payments: {}, locks: {}, queues: {}, intents: {}, cache: {}, counters: { lockWaits: 0, cacheHits: 0, cacheMisses: 0, retries: 0, duplicates: 0, activations: {} } }; }
export function initialRuntime(): CompanyRuntime { return { modules: {}, releases: {}, campaigns: [], proposals: [], priority: 'concurrency', rateBuckets: {}, operations: initialOperations() }; }
export const refKey = (ref: { id: string; version: number }) => `${ref.id}@${ref.version}`;
export function releaseFor(c: Company, backend = c.backend, security = c.runtime.releases[c.version]?.security): ExecutionRelease {
  const modules = route(backend).filter(n => n.type === 'module').map(n => {
    const ref = n.data.module;
    const version = ref && c.runtime.modules[ref.id]?.find(v => v.version === ref.version);
    if (!version || version.companyId !== c.id) throw new Error('Referencia de módulo inválida.'); return version;
  });
  const keys = new Set(modules.map(refKey));
  for (const module of modules) if (module.dependencies.some(ref => !keys.has(refKey(ref)))) throw new Error('Dependencia no conectada en la versión.');
  return structuredClone({ modules, ...(security ? { security } : {}) });
}
export function executionFor(c: Company) { return c.runtime.releases[c.version] ??= releaseFor(c); }
export function appendModule(graph: Graph, module: ModuleVersion) {
  const graphCopy = structuredClone(graph), ref = { id: module.id, version: module.version };
  const existing = graphCopy.nodes.find(n => n.type === 'module' && n.data.module?.id === module.id);
  if (existing) { existing.data = { label: module.name, module: ref }; return graphCopy; }
  const before = ['discount','coupon'].includes(module.configuration.kind) ? 'payment' : module.configuration.kind === 'inventory' ? 'write' : 'read';
  const target = graphCopy.nodes.find(n => n.type === before)!, edge = graphCopy.edges.find(e => e.target === target.id)!;
  const id = `module-${module.id}`;
  graphCopy.nodes.push({ id, type: 'module', position: { x: target.position.x - 90, y: 300 }, data: { label: module.name, module: ref } });
  graphCopy.edges = graphCopy.edges.filter(e => e.id !== edge.id);
  graphCopy.edges.push({ id: `${id}-a`, source: edge.source, target: id }, { id: `${id}-b`, source: id, target: target.id }); return graphCopy;
}
export function prepareArtifact(g: GameState, c: Company, actor: Identity, type: string, p: Record<string, unknown>): Change {
  validateParameters(type, p);
  if (g.changes.filter(ch => ch.companyId === c.id && ['QA_PENDING','QA_RUNNING','CTO_PENDING','AUTHORIZED','DEPLOYING'].includes(ch.status)).length >= 30) throw new Error('Límite de trabajos pendientes.');
  const changeId = `CH-${String(g.changes.length + 1).padStart(3, '0')}`;
  if (type === 'security.prepare') {
    const protection = securityConfiguration(p);
    const context = { backend: structuredClone(c.backend), security: structuredClone(c.security), executionVersion: c.version, execution: releaseFor(c) };
    context.execution.security = protection;
    const change: Change = { id: changeId, companyId: c.id, domain: 'security', name: 'Controles de seguridad', graph: structuredClone(c.security), status: 'QA_PENDING', cost: 200, reserved: 0, baseVersion: c.version, created: g.tick, reports: [], actorId: actor.id, context };
    g.changes.unshift(change); return change;
  }
  const configuration = moduleConfiguration(p.configuration), id = type === 'module.revise' ? String(p.moduleId) : `C${c.id}-M${Object.keys(c.runtime.modules).length + 1}`;
  const versions = c.runtime.modules[id];
  if (type === 'module.revise' && !versions) throw new Error('Módulo no encontrado.');
  if (!versions && Object.keys(c.runtime.modules).length >= 40) throw new Error('Límite de módulos alcanzado.');
  if (versions && versions.at(-1)!.configuration.kind !== configuration.kind) throw new Error('La revisión debe conservar el tipo.');
  const dependencies = (p.dependencies as string[]).map(dep => { const v = c.runtime.modules[dep]?.at(-1); if (!v || dep === id) throw new Error('Dependencia inválida.'); return { id: v.id, version: v.version }; });
  const module: ModuleVersion = { id, version: (versions?.length ?? 0) + 1, companyId: c.id, name: String(p.name), configuration, dependencies, defects: [], profile: 'defects-1', createdBy: actor.id, createdAt: g.tick, changeId, graph: { nodes: [], edges: [] } };
  module.defects = generateDefects(g.seed, module);
  const graph = appendModule(c.drafts.backend?.graph??c.backend, module);
  if (graph.nodes.length > 25 || graph.edges.length > 30) throw new Error('Límite de piezas alcanzado.');
  // Resolve the entire candidate before committing the artifact or change.
  const candidate = { ...c, runtime: { ...c.runtime, modules: { ...c.runtime.modules, [id]: [...(versions ?? []), module] } } };
  const execution = releaseFor(candidate, graph);
  module.graph = structuredClone(graph);
  c.runtime.modules[id] = [...(versions ?? []), module];
  c.drafts.backend={graph:structuredClone(graph),revision:(c.drafts.backend?.revision??0)+1};
  const change: Change = { id: changeId, companyId: c.id, domain: 'backend', name: module.name, graph, status: 'QA_PENDING', cost: 150 + dependencies.length * 30, reserved: 0, baseVersion: c.version, created: g.tick, reports: [], actorId: actor.id, artifactRefs: [{ id, version: module.version }], context: { backend: structuredClone(graph), security: structuredClone(c.security), executionVersion: c.version, execution } };
  g.changes.unshift(change); return change;
}
