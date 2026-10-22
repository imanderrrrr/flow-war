import { create } from 'zustand';
import { io } from '../shared/live-client';
import type { Command, Result, Snapshot } from '../shared/types';

export const socket = io({ reconnection: true });
export type Selection = { changeId?: string; nodeId?: string; serverId?: number; draftId?: string };
type Store = { snapshot: Snapshot | null; connected: boolean; selected: number; notice: { text: string; error: boolean } | null; sound: boolean; selection: Selection; select: (id: number) => void; setSelection: (patch: Selection) => void; notify: (text: string, error?: boolean) => void; toggleSound: () => void };
let noticeTimer: ReturnType<typeof setTimeout>;
export const useGame = create<Store>((set) => ({
  snapshot: null, connected: false, selected: 0, notice: null, sound: false, selection: {},
  select: selected => set({ selected }),
  /** What the student has selected on their own panel; sent with Claude orders to resolve "este cambio". */
  setSelection: patch => set(s => ({ selection: Object.fromEntries(Object.entries({ ...s.selection, ...patch }).filter(([, v]) => v !== undefined && v !== '')) as Selection })),
  notify: (text, error = false) => { clearTimeout(noticeTimer); set({ notice: { text, error } }); noticeTimer = setTimeout(() => set({ notice: null }), 4500); },
  toggleSound: () => set(s => ({ sound: !s.sound })),
}));
let lastEvent = -1;
socket.on('snapshot:clear', () => { lastEvent=-1; useGame.setState({snapshot:null}); });
let audio: AudioContext | undefined;
socket.on('connect', () => useGame.setState({ connected: true }));
socket.on('disconnect', () => { lastEvent = -1; useGame.setState({ connected: false, snapshot: null }); });
socket.on('snapshot', (snapshot: Snapshot) => {
  useGame.setState({ snapshot });
  const e = snapshot.events[0];
  if (e && e.id !== lastEvent && lastEvent >= 0 && useGame.getState().sound && e.tone !== 'neutral') {
    try {
      audio ??= new AudioContext(); void audio.resume();
      const osc = audio.createOscillator(), gain = audio.createGain(); osc.type = 'square'; osc.frequency.value = e.tone === 'bad' ? 140 : 520;
      gain.gain.setValueAtTime(.025, audio.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .12);
      osc.connect(gain); gain.connect(audio.destination); osc.start(); osc.stop(audio.currentTime + .13);
    } catch { /* Sound remains optional when audio is unavailable. */ }
  }
  lastEvent = e?.id ?? -1;
});
export async function send(type: string, options: Omit<Command, 'id' | 'type'> = {}, quiet = false): Promise<boolean> {
  if (!useGame.getState().connected) { useGame.getState().notify('Sin conexión con el servidor.', true); return false; }
  const command: Command = { id: crypto.randomUUID(), type, ...options };
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await new Promise<Result | null>(resolve => socket.timeout(4000).emit('command', command, (err: Error | null, result: Result) => resolve(err ? null : result)));
    if (!response && attempt === 0) continue;
    if (!response) { useGame.getState().notify('No se recibió confirmación. Sincronizando…', true); socket.disconnect().connect(); return false; }
    if (!response.ok) useGame.getState().notify(response.error ?? 'Acción no autorizada.', true);
    else if (!quiet) useGame.getState().notify('Operación confirmada.');
    return response.ok;
  }
  return false;
}
export const money = (n: number) => `Q${Math.round(n).toLocaleString('es-GT')}`;
export const number = (n: number) => Math.round(n).toLocaleString('es-GT');
export const time = (n: number) => `${String(Math.floor(Math.max(0, n) / 60)).padStart(2, '0')}:${String(Math.floor(Math.max(0, n) % 60)).padStart(2, '0')}`;
