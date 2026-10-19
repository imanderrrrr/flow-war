import type { CSSProperties } from 'react';
import type { CrisisState } from '../shared/observability';
import { crisisVisual } from '../shared/crisis';
export default function Crisis({state,tick}:{state:CrisisState;tick:number}){
 const visual=crisisVisual(state,tick);
 if(!visual.active&&!visual.papers.length)return null;
 return <aside className={`crisis-indicator ${visual.active?'active':'recovering'}`} aria-label={visual.active?'Crisis de reputación':'Recuperación de crisis'}>
 <span className="crisis-siren" aria-hidden="true"><svg viewBox="0 0 32 28"><path d="M8 22V10h3V6h10v4h3v12h4v4H4v-4zM14 0h4v4h-4zM0 9l3-3 5 5-3 3zM24 11l5-5 3 3-5 5z" fill="currentColor"/><path d="M13 10h4v9h-4z" fill="#ffe2bd"/></svg></span>
 <div><strong>{visual.active?'REPUTACIÓN CRÍTICA':'RECUPERANDO'}</strong><small>{visual.papers.length} DOCUMENTOS · ESTADO VISUAL</small></div>
 <div className="crisis-papers" aria-hidden="true">{visual.papers.map(p=><i className={`pixel-paper variant-${p.variant}`} key={p.id} style={{left:p.x,bottom:p.y,transform:`rotate(${p.rotation}deg)`} as CSSProperties}><b/><b/><b/></i>)}</div>
 </aside>;
}
