import { useEffect, useRef } from 'react';
import type { PublicCompany, Snapshot } from '../shared/types';
import { MAP_WIDTH as W, MAP_HEIGHT as H, SERVICES, SERVICE_CONNECTIONS, TRAFFIC_PATHS, particlePath, particlePosition, particleProgress, type Path, type Point } from './trafficGeometry';

const { ENTRY, GATE, WEB, AUTH, CHECK, STOCK, PAY, OUT } = SERVICES;
export default function TrafficCanvas({ company, snapshot, zoom }: { company: PublicCompany; snapshot: Snapshot; zoom: number }) {
  const canvas = useRef<HTMLCanvasElement>(null), state = useRef({ company, snapshot, zoom, received: performance.now() });
  useEffect(() => { state.current = { company, snapshot, zoom, received: performance.now() }; }, [company, snapshot, zoom]);
  useEffect(() => {
    const el = canvas.current!, ctx = el.getContext('2d')!; let animation = 0, width = 1000, height = 500;
    const observer = new ResizeObserver(entries => { width = entries[0].contentRect.width; height = entries[0].contentRect.height; const dpr = window.devicePixelRatio || 1; el.width = Math.floor(width * dpr); el.height = Math.floor(height * dpr); });
    observer.observe(el);
    function draw() {
      const { company: c, snapshot: s, zoom: z, received } = state.current;
      const now = s.tick + (s.status === 'RUNNING' ? Math.min(.22 * s.speed, (performance.now() - received) / 1000 * s.speed) : 0);
      const dpr = window.devicePixelRatio || 1, scale = Math.min(width / W, height / H) * z;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = '#0e1420'; ctx.fillRect(0, 0, width, height);
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (width - W * scale) / 2, dpr * (height - H * scale) / 2); ctx.imageSmoothingEnabled = false;
      const rect = (x: number, y: number, w: number, h: number, color: string) => { ctx.fillStyle = color; ctx.fillRect(Math.round(x), Math.round(y), w, h); };
      const text = (label: string, x: number, y: number, color = '#9aa8bb', size = 11, align: CanvasTextAlign = 'center') => { ctx.fillStyle = color; ctx.font = `${size}px "Space Mono", monospace`; ctx.textAlign = align; ctx.fillText(label, x, y); };
      for (let x = 20; x < W; x += 25) for (let y = 20; y < H; y += 25) rect(x, y, 1, 1, '#253044');
      for (let x = 70; x < W; x += 200) { rect(x, 22, 8, 1, '#334055'); rect(x + 3, 19, 1, 8, '#334055'); rect(x, H - 22, 8, 1, '#334055'); rect(x + 3, H - 25, 1, 8, '#334055'); }
      function road(points: Path, dashed = false, absent = false) {
        ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.lineWidth = 24; ctx.strokeStyle = absent ? '#141b26' : '#1b2433'; ctx.stroke();
        ctx.lineWidth = 1; ctx.strokeStyle = absent ? '#2f3a4a' : dashed ? '#586350' : '#4a4d42'; ctx.setLineDash(absent ? [2, 10] : dashed ? [4, 8] : [3, 9]); ctx.stroke(); ctx.setLineDash([]);
      }
      /** An unfilled solar: the outline of what is missing, with no hint of how to fill it. */
      function emptySolar(x: number, y: number, label: string, w = 108, h = 88) {
        ctx.setLineDash([5, 6]); ctx.lineWidth = 2; ctx.strokeStyle = '#3a4757';
        ctx.strokeRect(Math.round(x - w / 2), Math.round(y - h / 2), w, h); ctx.setLineDash([]);
        text('SOLAR VACÍO', x, y - 6, '#53627a', 9); text(label, x, y + 8, '#6c7c94', 10);
      }
      // What the team actually built. A solar nobody filled is an outline; a road nobody drew is faint.
      const placed = new Set(c.plan.nodes.map(n => n.type));
      const CHAIN: [string, Point][] = [['entry', ENTRY], ['security', GATE], ['web', WEB], ['checkout', CHECK], ['inventory', STOCK], ['payment', PAY], ['exit', OUT]];
      // Walked the way the engine walks it: a road the team drew can skip an empty solar, and the
      // corridor it passes through still carries traffic.
      const order = new Map(CHAIN.map(([piece], index) => [piece, index]));
      const carried = new Set<number>(), seen = new Set<string>();
      let step = c.plan.nodes.find(n => n.type === 'entry');
      while (step && !seen.has(step.id)) {
        seen.add(step.id);
        const next = c.plan.nodes.find(n => n.id === c.plan.edges.find(e => e.source === step!.id)?.target);
        if (!next) break;
        const from = order.get(step.type), to = order.get(next.type);
        if (from !== undefined && to !== undefined) for (let i = Math.min(from, to) + 1; i <= Math.max(from, to); i++) carried.add(i);
        step = next;
      }
      const segment = (from: Point, to: Point): Path => {
        const whole = TRAFFIC_PATHS.purchase, start = whole.indexOf(from), end = whole.indexOf(to);
        return start >= 0 && end > start ? whole.slice(start, end + 1) : [from, to];
      };
      for (let i = 1; i < CHAIN.length; i++) road(segment(CHAIN[i - 1][1], CHAIN[i][1]), false, !carried.has(i));
      // Navigation leaves from the tienda web, so its corridor is only a road once both ends exist.
      road(TRAFFIC_PATHS.browse, false, !(placed.has('web') && carried.has(order.get('exit')!)));
      for (const path of SERVICE_CONNECTIONS) road(path, true);
      text('NAVEGACIÓN / SALIDA', 790, 51, '#718299', 9);
      // Deliberately square, top-down buildings drawn from a small pixel grid.
      function platform(x: number, y: number, color: string, w = 108, h = 88) {
        rect(x - w/2 + 6, y - h/2 + 8, w, h, '#070c14'); rect(x - w/2, y - h/2, w, h, '#293345'); rect(x - w/2 + 2, y - h/2 + 2, w - 4, h - 4, '#151e2c');
        rect(x - w/2 + 7, y - h/2 + 7, w - 14, h - 14, '#1c2738');
        for (const [dx, dy] of [[-1,-1],[1,-1],[-1,1],[1,1]]) rect(x + dx*(w/2 - 4) - 2, y + dy*(h/2 - 4) - 2, 4, 4, color);
      }
      function server(x: number, y: number, color: string, count = 3) {
        for (let i = 0; i < count; i++) { rect(x - 33, y - 28 + i*20, 66, 17, '#0a111c'); rect(x - 32, y - 28 + i*20, 64, 2, '#637086'); rect(x - 27, y - 22 + i*20, 5, 5, color); rect(x - 15, y - 22 + i*20, 5, 5, '#48556a'); for (let q = 0; q < 3; q++) rect(x + 10 + q*6, y - 22 + i*20, 3, 5, '#3a4557'); }
      }
      if (placed.has('web')) {
        platform(...WEB, c.color, 118, 102);
        rect(WEB[0] - 40, WEB[1] - 33, 80, 65, '#0a111c'); rect(WEB[0] - 43, WEB[1] - 41, 86, 15, c.color);
        for (let i = 0; i < 6; i++) rect(WEB[0] - 40 + i*14, WEB[1] - 39, 7, 11, '#b9a24d');
        rect(WEB[0] - 29, WEB[1] - 14, 23, 22, '#314559'); rect(WEB[0] + 7, WEB[1] - 14, 23, 22, '#314559'); rect(WEB[0] - 9, WEB[1] + 14, 18, 18, '#3e4c60'); rect(WEB[0] - 3, WEB[1] + 18, 6, 6, c.color);
      } else emptySolar(...WEB, 'TIENDA WEB', 118, 102);
      if (placed.has('security')) { platform(...GATE, '#a1a8ba', 84, 90); server(...GATE, c.modules.some(m => ['waf','auth','rate'].includes(m)) ? '#68dca2' : '#98a6bc'); } else emptySolar(...GATE, 'SEGURIDAD', 84, 90);
      if (placed.has('checkout')) { platform(...CHECK, c.queue > 20 ? '#f27e79' : c.color); server(...CHECK, c.color); } else emptySolar(...CHECK, 'CHECKOUT');
      platform(...AUTH, '#9d94ca', 96, 80);
      const ax = AUTH[0], ay = AUTH[1];
      rect(ax - 23, ay - 25, 46, 36, '#5b5678'); rect(ax - 17, ay - 28, 34, 39, '#b0a4e3'); rect(ax - 12, ay + 10, 24, 10, '#b0a4e3'); rect(ax - 6, ay + 20, 12, 7, '#b0a4e3'); rect(ax - 5, ay - 15, 10, 19, '#3c365b'); rect(ax - 10, ay - 9, 20, 8, '#3c365b');
      if (placed.has('inventory')) {
        platform(...STOCK, '#e1ac67', 120, 96);
        for (const [dx,dy] of [[-31,-21],[6,-21],[-31,14],[6,14]]) { rect(STOCK[0] + dx, STOCK[1] + dy, 27, 27, '#a87846'); rect(STOCK[0] + dx + 2, STOCK[1] + dy + 2, 23, 23, '#cd9b60'); rect(STOCK[0] + dx + 12, STOCK[1] + dy + 2, 3, 23, '#8b623b'); rect(STOCK[0] + dx + 2, STOCK[1] + dy + 11, 23, 3, '#8b623b'); }
      } else emptySolar(...STOCK, 'INVENTARIO', 120, 96);
      if (placed.has('payment')) { platform(...PAY, '#68dca2', 108, 82); rect(PAY[0] - 34, PAY[1] - 23, 68, 44, '#46745f'); rect(PAY[0] - 31, PAY[1] - 20, 62, 38, '#94cba7'); rect(PAY[0] - 31, PAY[1] - 10, 62, 8, '#233d35'); rect(PAY[0] - 23, PAY[1] + 6, 14, 5, '#48755b'); rect(PAY[0] + 10, PAY[1] + 6, 13, 5, '#48755b'); } else emptySolar(...PAY, 'PAGOS', 108, 82);
      const serviceColor = c.traffic.queues.some(queue => queue.id === 'web' && queue.rate > 0) ? '#68dca2' : '#f27e79';
      platform(425, 465, '#758ba7', 96, 64); server(425, 468, serviceColor, 2);
      for (let i = 0; i < Math.min(c.servers, 4); i++) rect(395 + i*18, 502, 10, 4, serviceColor);
      // Entrance and exit terminals.
      // The entrance is always there; the exit is a piece like any other.
      for (const [x, y] of [ENTRY, ...(placed.has('exit') ? [OUT] : [])]) { rect(x - 15, y - 26, 30, 52, '#1b2635'); rect(x - 15, y - 26, 30, 3, '#55657a'); rect(x - 7, y - 12, 14, 24, '#0a111c'); rect(x - 3, y - 4, 6, 8, c.color); }
      if (!placed.has('exit')) emptySolar(...OUT, 'SALIDA', 70, 76);
      text('ENTRADA', ENTRY[0], ENTRY[1] - 44, '#a8b3c4', 11); text('INTERNET', ENTRY[0], ENTRY[1] + 49, '#627186', 9);
      text('SECURITY', GATE[0], GATE[1] - 61, '#b3bdcc', 12); text(`${c.modules.filter(m => ['auth','waf','rate','role','bot','ip'].includes(m)).length} CONTROLES`, GATE[0], GATE[1] + 64, '#718299', 9);
      const webQueue = c.traffic.queues.find(queue => queue.id === 'web')!.depth;
      text('WEB STORE', WEB[0], WEB[1] - 68, c.color, 12); text(webQueue ? `HTTP / COLA ${webQueue}` : 'HTTP / FRONTEND', WEB[0], WEB[1] + 70, '#718299', 9);
      text('AUTH', AUTH[0], AUTH[1] - 55, '#b9aedc', 12); text('SESIONES', AUTH[0], AUTH[1] + 59, '#718299', 9);
      const checkoutQueue = c.traffic.queues.find(queue => queue.id === 'checkout')!.depth;
      text('CHECKOUT', CHECK[0], CHECK[1] - 62, '#d4dbea', 12); text(`COLA ${checkoutQueue.toString().padStart(2,'0')}`, CHECK[0], CHECK[1] + 66, checkoutQueue > 20 ? '#f27e79' : '#718299', 10);
      const inventory = c.concurrency.inventory;
      text('INVENTARIO', STOCK[0], STOCK[1] - 64, '#dbb383', 12); text(inventory ? `REG ${Math.floor(c.stock)} / LAST ${inventory.stock}` : `STOCK ${Math.floor(c.stock)}`, STOCK[0], STOCK[1] + 65, '#718299', 10);
      if (inventory) text(`COMP. LAST ${inventory.committed}`, STOCK[0], STOCK[1] + 80, '#718299', 9);
      text('PAGOS', PAY[0], PAY[1] - 56, '#8cceaa', 12); text('PAYMENT GATEWAY', PAY[0], PAY[1] + 60, '#718299', 9);
      text('APP SERVERS', 425, 433, '#8ca0bc', 10); text(`${c.servers} NODO${c.servers > 1 ? 'S' : ''} / ${c.balancer ? 'BALANCEADO' : 'DIRECTO'}`, 425, 531, '#718299', 9);
      text('SALIDA', OUT[0], OUT[1] - 44, '#a8b3c4', 11); text('RESPONSE', OUT[0], OUT[1] + 49, '#627186', 9);
      const particles = c.particles;
      for (const p of particles) {
        if (p.status === 'ABANDONED' && p.finishedAt !== undefined) ctx.globalAlpha = Math.max(0, 1 - (now - p.finishedAt) / 3);
        const progress = p.queue ? Math.min(particleProgress(p, now), Math.max(.15, .97 - (p.queue.position + 1) / Math.max(12, p.queue.depth) * .8)) : particleProgress(p, now);
        const [x,y] = particlePosition(particlePath(p), progress, p.seed); const color = p.color;
        if (p.kind === 'attack') { rect(x-4,y-4,8,8,color); rect(x-2,y-2,4,4,'#0d1420'); }
        else { rect(x-2,y-6,4,4,'#e3dac5'); rect(x-3,y-1,6,6,color); rect(x-3,y+5,2,3,color); rect(x+1,y+5,2,3,color); }
        if (p.kind === 'error' && progress > .85) { text('×',x,y-15,'#f27e79',20); }
        ctx.globalAlpha = 1;
      }
      if (c.queue > 24) { const busiest = [...c.traffic.queues].sort((a,b)=>b.depth-a.depth)[0]; rect(548, 191, 178, 27, '#48262a'); text(`${busiest.id.toUpperCase()} / COLA ${busiest.depth}`,637,209,'#f9a29a',11); }
      if (c.eliminated) { rect(430,240,280,80,'#291b26'); text('FUERA DEL MERCADO',570,286,'#f27e79',17); }
      animation = requestAnimationFrame(draw);
    }
    draw(); return () => { cancelAnimationFrame(animation); observer.disconnect(); };
  }, []);
  return <canvas ref={canvas} className="traffic-canvas" role="img" aria-label={`Arquitectura de ${company.name}: ${company.active} clientes activos, ${Math.ceil(company.queue)} solicitudes en cola, ${company.servers} servidores.`}/>;
}
