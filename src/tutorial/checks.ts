import type { Snapshot } from '../../shared/types';
import type { Selection } from '../store';
import { logicPath } from '../logicBlocks';

/**
 * UI states that complete a `ui` step of the tutorial (shared/tutorial.ts). They read the page the student is
 * looking at and never decide anything the server should: every step that changes the company is an `action`
 * step, completed only when the server confirms the command on the practice copy.
 */
export type CheckContext = { snapshot: Snapshot; selection: Selection };
const exists = (selector: string) => !!document.querySelector(selector);
export const CHECKS: Record<string, (ctx: CheckContext) => boolean> = {
  'plan-own-placed': () => exists('.plan-editor .editor-flow') && !exists('.plan-editor .plan-node.ghost.mine'),
  'plan-roads': () => document.querySelectorAll('.plan-editor .editor-flow .react-flow__edge').length >= 5,
  'logic-panel-open': () => exists('.plan-logic'),
  // Read Stock → Atomic Update → Write Stock: on the saved draft (the one-tap block) or on the inner canvas,
  // where React Flow labels every edge "Edge from <source> to <target>".
  'atomic-connected': ({ snapshot }) => {
    const draft = snapshot.privateCompany?.drafts.backend?.graph, path = draft ? logicPath(draft) : [];
    if (path.indexOf('Read Stock') >= 0 && path.indexOf('Read Stock') < path.indexOf('Atomic Update') && path.indexOf('Atomic Update') < path.indexOf('Write Stock')) return true;
    const id = (type: string) => [...document.querySelectorAll(`.plan-inner-editor .react-flow__node-${type}`)].map(n => n.getAttribute('data-id'));
    const roads = new Set([...document.querySelectorAll('.plan-inner-editor .react-flow__edge')].map(e => e.getAttribute('aria-label')));
    const [read] = id('read'), [write] = id('write');
    return id('atomic').some(a => roads.has(`Edge from ${read} to ${a}`) && roads.has(`Edge from ${a} to ${write}`));
  },
  'security-module-selected': ({ snapshot, selection }) => snapshot.changes.flatMap(c => c.graph.nodes).find(n => n.id === selection.nodeId)?.type === 'module',
  'qa-suite-picked': () => exists('.qa-test .suite-button[aria-pressed="true"]'),
  'auditor-module-open': () => exists('.auditor-modules button[aria-pressed="true"]'),
};
