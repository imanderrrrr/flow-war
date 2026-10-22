import { io } from '../shared/live-client.js';
import { TUTORIALS } from '../shared/tutorial.js';
import type { Snapshot } from '../shared/types.js';
import { solutionFor } from '../server/tutorial.js';

/**
 * Plays a player's tutorial over a real socket, the way the browser does: it opens the workspace view, sends the
 * canonical action of each action step and acknowledges reading and UI steps. Resolves once the server hands the
 * connection back to the real room (a snapshot without `tutorial`).
 */
export async function finishTutorial(base: string, cookie: string, timeout = 45000): Promise<{ steps: string[] }> {
  const socket = io(base, { forceNew: true, transports: ['websocket'], extraHeaders: { Cookie: cookie }, auth: { view: '/workspace' } });
  const steps: string[] = [];
  try {
    await new Promise<void>((resolve, reject) => { socket.once('connect', () => resolve()); socket.once('connect_error', reject); });
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`tutorial sin terminar: ${steps.join(' → ')}`)), timeout);
      let busy = false, sent = '', latest: Snapshot | undefined;
      const act = async (snapshot: Snapshot) => {
        latest = snapshot;
        if (busy) return;
        const view = snapshot.tutorial;
        if (!view) { if (steps.length) { clearTimeout(timer); resolve({ steps }); } return; }
        if (steps.at(-1) !== view.stepId) steps.push(view.stepId);
        const meta = TUTORIALS[view.role].steps[view.step], key = `${view.stepId}:${meta.kind}`;
        busy = true;
        try {
          if (meta.kind === 'action') {
            const solution = sent === key ? null : solutionFor(snapshot);
            if (solution) {
              sent = key;
              const result = await new Promise<{ ok: boolean; error?: string }>(r => socket.timeout(4000).emit('command', { id: `tutorial-${view.stepId}-${Math.random()}`, ...solution }, (e: Error | null, value: { ok: boolean }) => r(e ? { ok: false, error: e.message } : value)));
              if (!result.ok) throw new Error(`${view.stepId}: ${result.error}`);
            }
          } else if (view.ready && sent !== key) {
            sent = key;
            await new Promise(r => socket.timeout(4000).emit('tutorial:ack', { step: view.stepId }, () => r(undefined)));
          }
        } catch (e) { clearTimeout(timer); reject(e); }
        finally { busy = false; }
        // A snapshot that arrived meanwhile may already show the next step.
        if (latest !== snapshot) void act(latest);
      };
      socket.on('snapshot', (snapshot: Snapshot) => void act(snapshot));
    });
  } finally { socket.disconnect(); }
}
