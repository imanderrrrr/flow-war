import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { TUTORIALS, type TutorialStep } from '../../shared/tutorial';
import { socket, useGame } from '../store';
import { CHECKS } from './checks';
import './tutorial.css';

type Box = { top: number; left: number; width: number; height: number };
const PAD = 8, GAP = 14, MARGIN = 12;
/** The first selector of the step's list that is on the page, and whether it is a fallback. */
function locate(step: TutorialStep): { el: HTMLElement | null; fallback: boolean } {
  const list = step.target === undefined ? [] : Array.isArray(step.target) ? step.target : [step.target];
  for (const [i, selector] of list.entries()) { const el = document.querySelector(selector) as HTMLElement | null; if (el) return { el, fallback: i > 0 }; }
  return { el: null, fallback: false };
}
const sameBox = (a?: Box, b?: Box) => !!a && !!b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;

/** Sends a step's acknowledgement once; the server decides whether it closes the step. */
function useAcknowledge(stepId: string) {
  const sent = useRef('');
  useEffect(() => { sent.current = ''; }, [stepId]);
  return () => {
    if (sent.current === stepId) return;
    sent.current = stepId;
    socket.timeout(4000).emit('tutorial:ack', { step: stepId }, (err: Error | null, result?: { ok: boolean }) => { if (err || !result?.ok) sent.current = ''; });
  };
}

/** The way out of a state the student cannot undo: a fresh practice copy at the start of this same step. */
function restartStep() {
  if (!window.confirm('¿Empezar este paso de nuevo? Tu práctica vuelve a como estaba al comenzarlo.')) return;
  socket.timeout(8000).emit('tutorial:restart', {}, (err: Error | null, result?: { ok: boolean }) => { if (err || !result?.ok) useGame.getState().notify('No se pudo reiniciar el paso. Probá de nuevo en unos segundos.', true); });
}

/** Where the card goes: next to the spotlight when it fits, as a bottom sheet on a phone or over a large target. */
function cardPosition(target: Box | undefined, card: { width: number; height: number }, moved: boolean): CSSProperties {
  const w = window.innerWidth;
  if (w < 720) return moved ? { left: MARGIN, right: MARGIN, top: MARGIN } : { left: MARGIN, right: MARGIN, bottom: MARGIN };
  const base = placeCard(target, card);
  // The student moved the card out of the way: the bottom corner on the other side.
  if (!moved) return base;
  const left = typeof base.left === 'number' ? base.left : w - Number(base.right ?? 0) - card.width;
  return left + card.width / 2 < w / 2 ? { right: MARGIN, bottom: MARGIN } : { left: MARGIN, bottom: MARGIN };
}
function placeCard(target: Box | undefined, card: { width: number; height: number }): CSSProperties {
  const w = window.innerWidth, h = window.innerHeight;
  if (!target) return { left: (w - card.width) / 2, top: Math.max(MARGIN, (h - card.height) / 2) };
  const left = Math.min(Math.max(MARGIN, target.left), w - card.width - MARGIN);
  const below = target.top + target.height + PAD + GAP, above = target.top - PAD - GAP - card.height;
  if (below + card.height <= h - MARGIN) return { left, top: below };
  if (above >= MARGIN) return { left, top: above };
  const right = target.left + target.width + PAD + GAP, before = target.left - PAD - GAP - card.width;
  const top = Math.min(Math.max(MARGIN, target.top), h - card.height - MARGIN);
  if (right + card.width <= w - MARGIN) return { left: right, top };
  if (before >= MARGIN) return { left: before, top };
  return { right: MARGIN, bottom: MARGIN };
}

/**
 * The mandatory tutorial (docs/25): the step's element stays usable inside a spotlight, the rest of the page is
 * dimmed and does not take clicks or focus. There is no skip and no close: a step ends when the student does it.
 */
export default function TutorialOverlay() {
  const s = useGame(st => st.snapshot), view = s?.tutorial;
  const [box, setBox] = useState<Box>(), [fallback, setFallback] = useState(false), [moved, setMoved] = useState(false), [cardSize, setCardSize] = useState({ width: 360, height: 220 });
  const card = useRef<HTMLDivElement>(null), scrolled = useRef('');
  const role = view && TUTORIALS[view.role], meta: TutorialStep | undefined = role?.steps[view!.step];
  const acknowledge = useAcknowledge(meta?.id ?? '');
  // Finishing hands the student back to the real room; say so once.
  const wasPracticing = useRef(false);
  useEffect(() => {
    if (view) wasPracticing.current = true;
    else if (wasPracticing.current && s) { wasPracticing.current = false; useGame.getState().notify(s.status === 'LOBBY' ? '¡Tutorial completo! Esperá a que el docente empiece el juego.' : '¡Tutorial completo! Ya estás en tu empresa real.'); }
  }, [!!view, s?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Follow the target element: it can mount late, move, resize or scroll.
  useEffect(() => {
    if (!meta) return;
    let frame = 0;
    const measure = () => {
      const { el, fallback: recovering } = locate(meta), key = `${meta.id}:${recovering}`;
      setFallback(recovering);
      if (el && scrolled.current !== key) { scrolled.current = key; el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      const r = el?.getBoundingClientRect(), next = r && r.width > 0 ? { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height) } : undefined;
      setBox(prev => sameBox(prev, next) || (!prev && !next) ? prev : next);
      frame = requestAnimationFrame(measure);
    };
    frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
  }, [meta?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => { const el = card.current; if (el && (el.offsetWidth !== cardSize.width || el.offsetHeight !== cardSize.height)) setCardSize({ width: el.offsetWidth, height: el.offsetHeight }); });

  // UI steps: the state the step asks for completes it.
  useEffect(() => {
    if (!meta || meta.kind !== 'ui' || meta.check === 'click') return;
    const check = CHECKS[meta.check ?? ''];
    const timer = setInterval(() => { const st = useGame.getState(); if (st.snapshot && check?.({ snapshot: st.snapshot, selection: st.selection })) acknowledge(); }, 250);
    return () => clearInterval(timer);
  }, [meta?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!meta || meta.check !== 'click' || !meta.target) return;
    const onClick = (e: MouseEvent) => { const { el } = locate(meta); if (el && e.target instanceof Node && el.contains(e.target)) acknowledge(); };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [meta?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard focus stays on the spotlight or the card, like the mouse.
  useEffect(() => {
    if (!meta) return;
    const onFocus = (e: FocusEvent) => {
      const { el } = locate(meta), node = e.target as Node | null;
      if (!node || card.current?.contains(node) || el?.contains(node) || (node as HTMLElement).closest?.('.toast')) return;
      (node as HTMLElement).blur?.();
    };
    document.addEventListener('focusin', onFocus);
    document.body.classList.add('tutorial-active');
    return () => { document.removeEventListener('focusin', onFocus); document.body.classList.remove('tutorial-active'); };
  }, [meta?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!view || !role || !meta) return null;
  const hole = box && { top: box.top - PAD, left: box.left - PAD, width: box.width + PAD * 2, height: box.height + PAD * 2 };
  const shields: CSSProperties[] = hole ? [
    { top: 0, left: 0, right: 0, height: Math.max(0, hole.top) },
    { top: hole.top + hole.height, left: 0, right: 0, bottom: 0 },
    { top: hole.top, left: 0, width: Math.max(0, hole.left), height: hole.height },
    { top: hole.top, left: hole.left + hole.width, right: 0, height: hole.height },
  ] : [{ inset: 0 }];
  return createPortal(<div className="tutorial-layer" data-step={meta.id}>
    {shields.map((style, i) => <div key={i} className="tutorial-shield" style={style} onMouseDown={e => e.preventDefault()}/>)}
    {hole && <div className="tutorial-ring" style={hole}/>}
    <div ref={card} className="tutorial-card" role="dialog" aria-modal="false" aria-labelledby="tutorial-title" style={cardPosition(box, cardSize, moved)}>
      <div className="tutorial-card-head"><span>TUTORIAL · {role.label.toUpperCase()}</span><b>PASO {view.step + 1} / {view.total}</b><button type="button" className="text-button tutorial-move" onClick={() => setMoved(v => !v)} aria-label="Mover esta tarjeta" title="Mover esta tarjeta si tapa algo">⇄ MOVER</button></div>
      <p className="tutorial-job">{role.job}</p>
      <h3 id="tutorial-title">{meta.title}</h3>
      <p className="tutorial-text">{meta.text}</p>
      {fallback && meta.recover && <p className="tutorial-fact">{meta.recover}</p>}
      {view.facts.map(f => <p className="tutorial-fact" key={f}>{f}</p>)}
      {view.waiting && <p className="tutorial-waiting" role="status"><span className="loading-pixel"/>{view.waiting}</p>}
      {meta.kind === 'read'
        ? <button className="primary-button small" disabled={!view.ready} onClick={acknowledge} autoFocus>ENTENDIDO</button>
        : <><p className="tutorial-hint">{meta.kind === 'action' ? 'Este paso se completa cuando el servidor confirma tu acción.' : 'Este paso se completa cuando lo hacés.'}</p>
          <button type="button" className="text-button tutorial-restart" onClick={restartStep}>↺ EMPEZAR ESTE PASO DE NUEVO</button></>}
      <div className="tutorial-dots" aria-hidden="true">{role.steps.map((st, i) => <i key={st.id} className={i < view.step ? 'done' : i === view.step ? 'current' : ''}/>)}</div>
    </div>
  </div>, document.body);
}
