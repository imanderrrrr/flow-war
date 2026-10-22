import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { LOBBY_COMPANIES, LOBBY_ICONS, NAME_MAX, REVEAL, companyStart, namesShownAt, reelStop, revealEnd, type LobbyMember, type LobbyView } from '../shared/lobby';
import { ROLES, ROLE_LABELS, type PublicCompany, type Role } from '../shared/types';
import { useGame, send, socket } from './store';
import { Icon, Mascot } from './icons';

type Me = LobbyMember & { companyId?: number; role?: Role };
type Seated = LobbyMember & { role: Role };

async function post(path: string, body: unknown = {}) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error ?? 'No se pudo completar.'), { code: data.code });
  return data;
}
/** Re-renders on a timer only while something on screen depends on the clock. */
function useNow(active: boolean, every = 200) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { if (!active) return; const timer = setInterval(() => setNow(Date.now()), every); return () => clearInterval(timer); }, [active, every]);
  return active ? now : Date.now();
}
const stillMotion = () => document.documentElement.dataset.calm === 'true' || matchMedia('(prefers-reduced-motion: reduce)').matches;
const byRole = (members: Seated[]) => [...members].sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role));
const pinText = (pin = '') => `${pin.slice(0, 3)} ${pin.slice(3)}`;
/** The live connection authenticates at its handshake; after the session cookie changes it must reconnect to receive the seat. */
const reconnect = () => { socket.disconnect().connect(); };
const urlText = (url: string) => { const cut = url.lastIndexOf('/'); return <>{url.slice(0, cut)}<wbr/>{url.slice(cut)}</>; };

/** Students join from their phones with the PIN the teacher shows, then wait for the draw. */
export function JoinPage() {
  const s = useGame(s => s.snapshot)!;
  const [me, setMe] = useState<Me | null>(), [offset, setOffset] = useState(0);
  const load = useCallback(async () => {
    try { const r = await fetch('/api/lobby/me'); const d = await r.json(); setOffset(d.serverNow - Date.now()); setMe(d.participant); } catch { setMe(null); }
  }, []);
  useEffect(() => { void load(); }, [load, s.generation]);
  // The teacher may remove a player from the list before the draw.
  const listed = !me || !s.lobby || s.lobby.participants.some(p => p.id === me.id);
  useEffect(() => { if (!listed) void load(); }, [listed, load]);
  useEffect(() => { if (me && s.identity && s.identity.role !== 'operator' && s.status !== 'LOBBY') window.location.href = '/workspace'; }, [me, s.identity, s.status]);
  if (me === undefined) return <main className="join-page"><div className="join-card join-loading"><span className="loading-pixel"/></div></main>;
  if (!me) return <JoinForm onJoined={setMe} open={s.status === 'LOBBY' && !s.lobby?.formation} signedIn={s.identity ? ROLE_LABELS[s.identity.role] : undefined}/>;
  return <Waiting me={me} offset={offset} onLeft={() => setMe(null)}/>;
}

function JoinForm({ onJoined, open, signedIn }: { onJoined: (me: Me) => void; open: boolean; signedIn?: string }) {
  const [step, setStep] = useState<'pin' | 'profile'>('pin'), [pin, setPin] = useState(''), [name, setName] = useState(''), [icon, setIcon] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function check(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try { await post('/api/lobby/check', { pin }); setStep('profile'); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function join(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try { const { participant } = await post('/api/lobby/join', { pin, name, icon }); reconnect(); onJoined(participant); }
    catch (e) { setError((e as Error).message); if (['BAD_PIN', 'TEAMS_FORMED', 'ROOM_CLOSED'].includes((e as { code?: string }).code ?? '')) setStep('pin'); setBusy(false); }
  }
  if (step === 'pin') return <main className="join-page"><form className="join-card" onSubmit={check}>
    <span className="eyebrow">FLOW WAR / SALA DE JUEGO</span><h1>Unite a la partida</h1>
    {!open && <p className="muted">La sala no está recibiendo jugadores en este momento.</p>}
    {signedIn && <p className="muted">Este navegador tiene una sesión de {signedIn}; al unirte se reemplaza.</p>}
    <label htmlFor="room-pin">PIN DE LA SALA</label>
    <input id="room-pin" className="pin-input" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="off" placeholder="000000" required autoFocus aria-describedby={error ? 'join-error' : undefined}/>
    {error && <p className="form-error" id="join-error" role="alert">{error}</p>}
    <button className="primary-button" type="submit" disabled={busy || pin.length !== 6}>{busy ? 'VERIFICANDO…' : 'ENTRAR'}<Icon name="arrow" size={16}/></button>
    <a className="back-link" href="/login">¿Tenés una credencial de rol? Entrar con credencial</a>
  </form></main>;
  return <main className="join-page"><form className="join-card" onSubmit={join}>
    <span className="eyebrow">SALA {pinText(pin)}</span><h1>¿Cómo te llamás?</h1>
    <label htmlFor="player-name">TU NOMBRE</label>
    <input id="player-name" className="name-input" value={name} onChange={e => setName(e.target.value)} maxLength={NAME_MAX * 2} autoComplete="nickname" required autoFocus/>
    <span className="field-label" id="icon-label">ELEGÍ TU ICONO</span>
    <div className="icon-picker" role="group" aria-labelledby="icon-label">{LOBBY_ICONS.map(i => <button type="button" key={i} aria-pressed={icon === i} onClick={() => setIcon(i)}>{i}</button>)}</div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="primary-button" type="submit" disabled={busy || !name.trim() || !icon}>{busy ? 'ENTRANDO…' : '¡LISTO!'}<Icon name="arrow" size={16}/></button>
    <button type="button" className="back-link" onClick={() => { setStep('pin'); setError(''); }}>Cambiar PIN</button>
  </form></main>;
}

function Waiting({ me, offset, onLeft }: { me: Me; offset: number; onLeft: () => void }) {
  const s = useGame(s => s.snapshot)!, lobby = s.lobby, formation = lobby?.formation;
  const team = formation?.teams.find(t => t.members.some(m => m.id === me.id));
  const elapsed = useNow(!!formation) + offset - (formation?.at ?? 0);
  const shown = !formation || elapsed >= (team ? namesShownAt(team.companyId, lobby!.teamSize) : revealEnd());
  // Once play starts the public room view is gone; the player's own record still says where they sit.
  const seat = team ? { companyId: team.companyId, role: team.members.find(m => m.id === me.id)!.role } : me.companyId !== undefined && me.role ? { companyId: me.companyId, role: me.role } : undefined;
  const company = seat && s.companies[seat.companyId];
  async function leave() { try { await post('/api/lobby/leave'); reconnect(); onLeft(); } catch (e) { useGame.getState().notify((e as Error).message, true); } }
  if (!formation && s.status === 'LOBBY') return <main className="join-page"><div className="join-card join-me">
    <span className="me-icon">{me.icon}</span><h1>¡Estás dentro, {me.name}!</h1>
    <p className="muted">Mirá la pantalla del docente. Los equipos se sortean cuando estén todos.</p>
    <span className="eyebrow">{lobby?.participants.length ?? 0} JUGADORES EN LA SALA</span>
    <button className="text-button" onClick={() => void leave()}>SALIR DE LA SALA</button>
  </div></main>;
  if (formation && !shown) return <main className="join-page"><div className="join-card join-me">
    <span className="me-icon rolling">{me.icon}</span><h1>Sorteando equipos…</h1><p className="muted">Mirá la pantalla del docente.</p>
  </div></main>;
  if (seat && company) return <main className="join-page"><div className="join-card join-me">
    <div className="seat-card" style={{ '--team': company.color } as CSSProperties}>
      <Mascot id={company.id} color={company.color} size={54}/><span className="eyebrow">SOS DE</span><strong>{company.name}</strong><b>{ROLE_LABELS[seat.role]}</b>
    </div>
    {team && <ul className="seat-team">{byRole(team.members).map(m => <li key={m.id}><span>{m.icon}</span>{m.name}<small>{ROLE_LABELS[m.role]}</small></li>)}</ul>}
    {s.status === 'LOBBY' ? <p className="muted">Esperá a que el docente empiece el juego.</p> : null}
    <a className="primary-button" href="/workspace">IR A MI ESPACIO <Icon name="arrow" size={14}/></a>
  </div></main>;
  return <main className="join-page"><div className="join-card join-me">
    <span className="me-icon">{me.icon}</span><h1>Quedaste en reserva</h1>
    <p className="muted">Tu rol se asigna más adelante. Quedate atento a la pantalla del docente.</p>
  </div></main>;
}

/** Projector screen for the teacher: PIN and players, the slot-machine draw, then the teams and the start button. */
export function RoomScreen() {
  const s = useGame(s => s.snapshot)!, operator = s.identity?.role === 'operator', lobby = s.lobby;
  const [info, setInfo] = useState<{ joinUrls: string[] }>(), [offset, setOffset] = useState(0), [replay, setReplay] = useState<number>(), [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!operator) return;
    void fetch('/api/lobby/info').then(r => r.ok ? r.json() : undefined).then(d => { if (d) { setInfo(d); setOffset(d.serverNow - Date.now()); } }).catch(() => undefined);
  }, [operator]);
  useEffect(() => setReplay(undefined), [lobby?.formation?.at]);
  const start = replay ?? lobby?.formation?.at, now = useNow(start !== undefined) + offset;
  const elapsed = start === undefined ? 0 : now - start;
  if (!operator) return <main className="join-page"><div className="join-card"><span className="eyebrow">PANTALLA DE SALA</span><h1>Solo para el docente</h1><p className="muted">Entrá con la credencial Docente para abrir la sala.</p><a className="primary-button" href="/login">ENTRAR <Icon name="arrow" size={14}/></a></div></main>;
  if (!lobby) return <main className="loading-screen"><span className="loading-pixel"/><span>PREPARANDO LA SALA…</span></main>;
  async function act(path: string, body?: unknown) { setBusy(true); try { await post(path, body); } catch (e) { useGame.getState().notify((e as Error).message, true); } finally { setBusy(false); } }
  return <main className="room-screen">
    {!lobby.formation ? <Gathering lobby={lobby} joinUrls={info?.joinUrls.length ? info.joinUrls : [`${location.origin}/unirse`]} busy={busy} onForm={() => void act('/api/lobby/form')} onRemove={id => void act('/api/lobby/remove', { id })}/>
      : elapsed < revealEnd() ? <SlotShow lobby={lobby} elapsed={elapsed} companies={s.companies} onSkip={() => setReplay(now - revealEnd())}/>
      : <TeamsBoard lobby={lobby} companies={s.companies} waiting={s.status === 'LOBBY'} onReplay={() => setReplay(now)}/>}
  </main>;
}

function Gathering({ lobby, joinUrls, busy, onForm, onRemove }: { lobby: LobbyView; joinUrls: string[]; busy: boolean; onForm: () => void; onRemove: (id: string) => void }) {
  const count = lobby.participants.length, missing = Math.max(0, lobby.required - count);
  return <section className="room-gathering">
    <div className="room-join">
      <div className="room-url"><span className="eyebrow">ENTRÁ DESDE TU CELULAR A</span><strong>{urlText(joinUrls[0])}</strong>{joinUrls.length > 1 && <small>o también {joinUrls.slice(1).join(' · ')}</small>}</div>
      <div className="room-pin"><span className="eyebrow">PIN DE LA SALA</span><strong>{pinText(lobby.pin)}</strong></div>
    </div>
    <div className="room-count"><b>{count}</b><span>/ {lobby.required} JUGADORES{count > lobby.required ? ` · ${count - lobby.required} EN RESERVA` : ''}{lobby.teamSize === 6 ? ' · EQUIPOS DE 6 CON PRODUCTO/UX' : ''}</span><div className="room-progress"><i style={{ width: `${Math.min(100, count / lobby.required * 100)}%` }}/></div></div>
    <div className="participant-grid" aria-live="polite">{count ? lobby.participants.map(p => <span className="participant-chip" key={p.id}><span>{p.icon}</span>{p.name}<button aria-label={`Quitar a ${p.name} de la sala`} title="Quitar de la sala" disabled={busy} onClick={() => onRemove(p.id)}><Icon name="close" size={12}/></button></span>) : <span className="muted">Esperando jugadores…</span>}</div>
    <div className="room-actions"><button className="primary-button" disabled={busy || missing > 0} onClick={onForm}>{missing > 0 ? `FALTAN ${missing} JUGADORES` : 'FORMAR EQUIPOS'}<Icon name="arrow" size={16}/></button><a className="secondary-button" href="/control">VOLVER AL CONTROL</a></div>
  </section>;
}

function SlotShow({ lobby, elapsed, companies, onSkip }: { lobby: LobbyView; elapsed: number; companies: PublicCompany[]; onSkip: () => void }) {
  const formation = lobby.formation!;
  if (elapsed < REVEAL.introMs) return <section className="slot-intro"><h1>SORTEO DE EQUIPOS</h1><div className="slot-intro-icons">{lobby.participants.map((p, i) => <span key={p.id} style={{ animationDelay: `${(i % 8) * 80}ms` }}>{p.icon}</span>)}</div></section>;
  const index = Math.min(LOBBY_COMPANIES - 1, Math.floor((elapsed - REVEAL.introMs) / REVEAL.companyMs)), team = formation.teams[index], company = companies[team.companyId];
  // The reels spin the icons of everyone not yet seated in an earlier company.
  const pool = formation.teams.slice(index).flatMap(t => t.members.map(m => m.icon)).concat(formation.reserve.map(m => m.icon));
  return <section className="slot-show" style={{ '--team': company.color } as CSSProperties}>
    <ol className="slot-progress">{formation.teams.map((t, i) => <li key={t.companyId} className={i < index ? 'done' : i === index ? 'current' : ''} style={{ '--team': companies[t.companyId].color } as CSSProperties}><Mascot id={t.companyId} color={companies[t.companyId].color} size={18}/>{companies[t.companyId].name}</li>)}</ol>
    <SlotMachine key={index} seed={formation.at + index} members={team.members} pool={pool} phase={elapsed - companyStart(index)} company={company}/>
    <div className="slot-skip"><button className="text-button" onClick={onSkip}>SALTAR ANIMACIÓN</button></div>
  </section>;
}

/** Small deterministic generator so a reel strip stays identical across re-renders of the same draw. */
function strip(pool: string[], last: string, seed: number) {
  let state = seed >>> 0;
  const next = () => { state = (state + 0x6d2b79f5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return [...Array.from({ length: 23 }, () => pool[Math.floor(next() * pool.length)]), last];
}

function SlotMachine({ seed, members, pool, phase, company }: { seed: number; members: Seated[]; pool: string[]; phase: number; company: PublicCompany }) {
  const poolKey = pool.join(''), strips = useMemo(() => members.map((m, k) => strip(pool, m.icon, seed * 7 + k)), [seed, members.map(m => m.id).join(), poolKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const done = phase >= reelStop(members.length - 1) + REVEAL.namesDelayMs;
  return <div className="slot-cabinet">
    <div className="slot-marquee"><span className="eyebrow">EMPRESA 0{company.id + 1}</span><strong>{company.name}</strong></div>
    <div className="slot-reels">{members.map((m, k) => <Reel key={m.id} icon={m.icon} strip={strips[k]} stopAt={reelStop(k)} phase={phase}/>)}</div>
    <div className={`slot-names ${done ? 'shown' : ''}`} aria-live="polite">{members.map(m => <div key={m.id}><strong>{done ? m.name : ''}</strong><span>{done ? ROLE_LABELS[m.role] : ''}</span></div>)}</div>
    <div className={`slot-banner ${done ? 'shown' : ''}`}>{done ? `¡USTEDES SON ${company.name}!` : ''}</div>
  </div>;
}

function Reel({ icon, strip, stopAt, phase }: { icon: string; strip: string[]; stopAt: number; phase: number }) {
  const ref = useRef<HTMLDivElement>(null), still = stillMotion();
  useLayoutEffect(() => {
    const el = ref.current; if (!el || still) return;
    const animation = el.animate([{ transform: 'translateY(0)' }, { transform: `translateY(-${(strip.length - 1) / strip.length * 100}%)` }], { duration: stopAt, easing: 'cubic-bezier(.12,.62,.2,1)', fill: 'forwards' });
    // Mounted once per company; a screen opened mid-draw joins the spin where the clock says it is.
    animation.currentTime = Math.min(phase, stopAt);
    return () => animation.cancel();
  }, [strip, stopAt, still]); // eslint-disable-line react-hooks/exhaustive-deps
  const stopped = phase >= stopAt;
  return <div className={`slot-reel ${stopped ? 'stopped' : 'spinning'}`}><div className="slot-strip" ref={ref}>{still ? <span className="slot-cell">{stopped ? icon : '?'}</span> : strip.map((c, i) => <span className="slot-cell" key={i}>{c}</span>)}</div></div>;
}

function TeamsBoard({ lobby, companies, waiting, onReplay }: { lobby: LobbyView; companies: PublicCompany[]; waiting: boolean; onReplay: () => void }) {
  const formation = lobby.formation!;
  return <section className="teams-board">
    <div className="teams-heading"><div><span className="eyebrow">EQUIPOS FORMADOS AL AZAR</span><h1>{waiting ? '¡Listos para jugar!' : 'Partida en curso'}</h1></div>
      <div className="button-row"><button className="secondary-button" onClick={onReplay}>VER SORTEO OTRA VEZ</button>{waiting ? <button className="primary-button" onClick={() => void send('room.start')}><Icon name="play"/>EMPEZAR JUEGO</button> : <a className="primary-button" href="/">ABRIR ARENA <Icon name="arrow" size={14}/></a>}</div></div>
    <div className="teams-grid">{formation.teams.map(t => { const c = companies[t.companyId]; return <div className="team-column" key={t.companyId} style={{ '--team': c.color } as CSSProperties}>
      <div className="team-column-head"><Mascot id={c.id} color={c.color} size={30}/><strong>{c.name}</strong></div>
      <ul>{byRole(t.members).map(m => <li key={m.id}><span className="member-icon">{m.icon}</span><span><strong>{m.name}</strong><small>{ROLE_LABELS[m.role]}</small></span></li>)}</ul>
    </div>; })}</div>
    {formation.reserve.length > 0 && <div className="reserve-row"><span className="eyebrow">RESERVA · ROL PENDIENTE</span><div className="participant-grid">{formation.reserve.map(m => <span className="participant-chip" key={m.id}><span>{m.icon}</span>{m.name}</span>)}</div></div>}
  </section>;
}

/** Summary on the teacher console; the projector screen lives at /sala. */
export function LobbyPanel() {
  const lobby = useGame(s => s.snapshot?.lobby);
  if (!lobby) return null;
  return <section className="panel lobby-panel"><div className="panel-title"><span>SALA DE JUGADORES</span><a className="text-button" href="/sala">ABRIR PANTALLA DE SALA <Icon name="arrow" size={12}/></a></div>
    <div className="lobby-panel-body"><div><span className="eyebrow">PIN</span><strong>{pinText(lobby.pin)}</strong></div><div><span className="eyebrow">JUGADORES</span><strong>{lobby.participants.length} / {lobby.required}</strong></div><div><span className="eyebrow">EQUIPOS</span><strong>{lobby.formation ? 'FORMADOS' : 'SIN SORTEAR'}</strong></div></div>
  </section>;
}
