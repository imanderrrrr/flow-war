export function Icon({ name, size = 18, className = '' }: { name: string; size?: number; className?: string }) {
  const paths: Record<string, React.ReactNode> = {
    arena: <><path d="M2 2h5v5H2zm9 0h5v5h-5zM2 11h5v5H2zm9 0h5v5h-5z"/><path d="M9 3v12M3 9h12" opacity=".4"/></>,
    arrow: <path d="M3 9h12M10 4l5 5-5 5"/>,
    clock: <><path d="M5 2h8l3 3v8l-3 3H5l-3-3V5z"/><path d="M9 5v5h4"/></>,
    chip: <><path d="M5 5h8v8H5zM2 6h3M2 12h3m8-6h3m-3 6h3M6 2v3m6-3v3M6 13v3m6-3v3"/><path d="M8 8h2v2H8z"/></>,
    volume: <><path d="M2 7h3l4-4v12l-4-4H2zM12 6v6m3-8v10"/></>,
    mute: <><path d="M2 7h3l4-4v12l-4-4H2zM12 6l5 6m0-6-5 6"/></>,
    full: <path d="M2 7V2h5m4 0h5v5M2 11v5h5m4 0h5v-5"/>,
    shield: <><path d="M3 3l6-2 6 2v8l-6 6-6-6z"/><path d="M6 8l2 2 4-4"/></>,
    server: <><path d="M3 2h12v6H3zm0 8h12v6H3z"/><path d="M5 5h1m-1 8h1m4-8h3m-3 8h3"/></>,
    code: <path d="M6 4 1 9l5 5m6-10 5 5-5 5M10 2 8 16"/>,
    claude: <path d="M9 1v16M1 9h16M3.3 3.3l11.4 11.4m0-11.4L3.3 14.7"/>,
    mic: <><path d="M7 2h4v8H7z"/><path d="M4 8a5 5 0 0 0 10 0M9 13v3m-3 0h6"/></>,
    flask: <path d="M6 2h6M7 2v5L2 15v1h14v-1l-5-8V2M5 11h8"/>,
    crown: <path d="m2 4 4 4 3-6 3 6 4-4-2 10H4zM4 16h10"/>,
    pulse: <path d="M1 9h4l2-6 4 12 2-6h4"/>,
    exit: <path d="M8 2H2v14h6m3-11 5 4-5 4M6 9h10"/>,
    close: <path d="m4 4 10 10m0-10L4 14"/>,
    plus: <path d="M9 3v12M3 9h12"/>,
    minus: <path d="M3 9h12"/>,
    play: <path d="m5 2 11 7-11 7z"/>,
    pause: <path d="M4 3h3v12H4zm7 0h3v12h-3z"/>,
    reset: <path d="M3 7a6 6 0 1 1 0 5M3 2v5h5"/>,
    lock: <><path d="M4 8h10v8H4zM6 8V3h6v5M9 11v2"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="square" strokeLinejoin="miter" className={className} aria-hidden="true">{paths[name] ?? paths.chip}</svg>;
}
const patterns = [
  ['00100100','00011000','01111110','11011011','11111111','10100101','00100100','01000010'],
  ['10000001','01000010','01111110','11011011','11111111','00111100','01011010','10000001'],
  ['00011000','00111100','01111110','11011011','11111111','01011010','01000010','00100100'],
  ['00111100','01111110','11011011','11111111','00111100','01111110','11000011','01000010'],
  ['00011000','01111110','11011011','11111111','11111111','01011010','00100100','01000010'],
];
export function Mascot({ id, color, size = 34 }: { id: number; color: string; size?: number }) {
  return <svg viewBox="0 0 32 32" width={size} height={size} fill={color} shapeRendering="crispEdges" aria-hidden="true">{patterns[id % 5].flatMap((row, y) => [...row].flatMap((v, x) => v === '1' ? <rect key={`${x}-${y}`} x={x * 4} y={y * 4} width="4" height="4"/> : []))}</svg>;
}
