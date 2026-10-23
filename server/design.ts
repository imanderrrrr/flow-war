import { createHash } from 'node:crypto';
import type { ControlCheck } from '../shared/auditor.js';
import type { DefectCode } from '../shared/simulation.js';
import type { ModuleConfiguration } from '../shared/actions.js';
import { words } from './grounding.js';

/**
 * Modules drafted in words with Claude (Backend only). Claude writes a short textual design; the server, never the
 * model, leaves some controles pendientes on the module. The choice is a pure function of the game seed and the
 * design, travels in the `module.design` command payload and is verified again when the command is applied.
 */
export const DESIGN_PROFILE = 'design-1' as const;
/**
 * A drafted module joins the purchase flow as a purchase module: it checks identity and input by itself unless a
 * control is pending. Each pending set maps to a simulated defect the engine already models (admitSecurity).
 */
export const DESIGN_CONFIGURATION: ModuleConfiguration = { kind: 'purchase', idempotent: false };
export const DESIGN_PENDING: readonly (readonly ControlCheck[])[] = [['waf'], ['auth', 'role_check'], ['auth', 'role_check', 'waf']];
export const PENDING_DEFECT: Partial<Record<ControlCheck, DefectCode>> = { auth: 'D05', role_check: 'D05', waf: 'D08' };
export const DESIGN_LIMITS = { name: 40, components: 6, component: 30, summary: 280 } as const;

const key = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
export function designPending(seed: number, name: string, components: string[]): ControlCheck[] {
  const digest = createHash('sha256').update(JSON.stringify([DESIGN_PROFILE, seed, key(name), components.map(key)])).digest();
  return [...DESIGN_PENDING[digest.readUInt32BE(0) % DESIGN_PENDING.length]];
}
export const pendingDefects = (pending: ControlCheck[]) => [...new Set(pending.map(p => PENDING_DEFECT[p]).filter((d): d is DefectCode => !!d))];
export const samePending = (a: ControlCheck[], b: ControlCheck[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Words of the store's software. A drafted module names at least one of them, in its name or a component. */
const STORE_TERMS = `sesion login inicio usuario contrasena clave token credencial autentic cuenta perfil registro pago cobro tarjeta factura
  recibo inventario stock existencia producto catalogo carrito compra pedido orden checkout envio entrega cupon descuento promoc precio cliente
  busqueda buscador resena opinion notific correo email mensaje reembolso devoluc reserva valid verific confirm historial favorito lista suscrip
  dato informac solicitud servidor identidad permiso rol acceso cantidad unidad monto total importe saldo tienda venta recuper pasarela transacc
  direccion telefono cola cache bloqueo lock reintento idempot almacen bodega despacho seguimiento rastreo autoriz fraude cuota limite bot
  reporte metrica auditor bitacora alerta evento pantalla formulario pagina web codigo`.split(/\s+/);
/** Connectives and the plain verbs and nouns a short design needs; with STORE_TERMS, the vocabulary a summary may use. */
const DESIGN_WORDS = `para como cuando antes despues luego entre desde hasta sobre cada este esta esto estos estas donde pero tambien solo sola
  solamente mismo misma otro otra otros otras todo toda todos todas segun mediante durante hacia tras mientras siempre nunca aunque porque sino
  ambos ambas cual cuales quien dentro fuera junto previo previa primero primera ultimo ultima final nuevo nueva cuyo cuya ellos ellas tanto menos
  bien cierto ningun ninguna alguno alguna algun varios varias dicho dicha ademas entonces cada parte caso veces forma modo manera tipo nivel punto
  lado base nombre numero valor campo paso etapa fase ciclo flujo proceso sistema modulo componente servicio funcion operacion accion resultado
  respuesta peticion llamada conexion estado tiempo fecha hora minuto segundo plazo vigencia expiracion duracion intento error fallo exito aviso
  regla control filtro origen destino entrada salida seguro segura correcto correcta unico unica propio propia activo activa pendiente disponible
  necesario necesaria posible simple basico principal interno externo publico privado temporal permanente automatico manual rapido datos hash
  cifrado encriptado firma valida verifica recibe envia guarda consulta registra compara genera devuelve almacena actualiza permite rechaza acepta
  crea creado utiliza calcula aplica reserva confirma procesa solicita entrega emite asocia relaciona identifica autentica autoriza controla
  mantiene obtiene revisa determina inicia cierra expira renueva vincula conecta depende maneja gestiona contiene asigna notifica informa muestra
  retorna responde pide suma resta cobra factura ingresa escribe leer cambia elimina borra agrega anade quita bloquea limita filtra protege sigue
  sincroniza conserva carga recupera comprueba chequea marca anota espera llega sale entra pasa queda hace tiene puede debe sirve evita impide
  garantiza asegura define indica coincide corresponde pertenece existe falta supera alcanza vence dura tarda ocurre sucede usar usa usan
  siguiente anterior mayor menor igual distinto actual vigente posterior inmediato directo completo parcial maximo minimo alto bajo largo corto breve
  claro dentro junto correspondiente respectivo ingresado solicitado enviado recibido guardado generado nuevamente luego primero despues`.split(/\s+/);
/** Same word or same stem: the first five letters, so "valida", "validación" and "validar" are one word. */
function sameStem(word: string, known: string) {
  const k = Math.min(5, word.length, known.length);
  return word.slice(0, k) === known.slice(0, k) && (known.length >= 5 || Math.abs(word.length - known.length) <= 2);
}
const letters = (text: string) => words(text).flatMap(w => w.split(/[^a-z]+/)).filter(Boolean);
/** The module belongs to the store's software: its name or one of its components is a store word. */
export function storeModule(design: { name: string; components: string[] }) {
  return letters([design.name, ...design.components].join(' ')).some(w => w.length >= 3 && STORE_TERMS.some(t => sameStem(w, t)));
}
/**
 * The summary is the only model-written prose a student reads, so it must stay about the module: every sentence
 * names the module, a component or a store word; at most one word in five (two in a short summary) comes from
 * outside the student's instruction, the design and the vocabulary above; and every number is in the instruction.
 * An answer to an unrelated question has no room inside a module.
 */
export function summaryInScope(design: { name: string; components: string[]; summary: string }, instruction: string) {
  const own = letters([design.name, ...design.components].join(' ')).filter(w => w.length >= 3);
  const known = [...letters(instruction), ...own, ...STORE_TERMS, ...DESIGN_WORDS], counted = letters(design.summary).filter(w => w.length >= 4);
  const unknown = counted.filter(w => !known.some(k => sameStem(w, k))).length;
  const sentences = design.summary.split(/[.;!?¿¡]+/).map(letters).filter(s => s.length >= 3);
  const anchored = sentences.every(s => s.some(w => w.length >= 3 && [...own, ...STORE_TERMS].some(k => sameStem(w, k))));
  const numbers = new Set(instruction.match(/\d+/g) ?? []);
  return anchored && unknown <= Math.max(2, Math.floor(counted.length / 5)) && (design.summary.match(/\d+/g) ?? []).every(n => numbers.has(n));
}

export class DesignError extends Error {}
/** A design is plain words: no code, queries, markup or configuration. */
const CODE = /```|[{}<>;=$\\|]|=>|\b(function|class|import|export|const|let|var|return|select|insert|drop|script|eval|sql|https?)\b/i;
const WORDS = /^[\p{L}\p{N}][\p{L}\p{N} .,'/()-]*$/u;
const clean = (v: unknown) => typeof v === 'string' ? v.normalize('NFC').replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim() : '';
export function sanitizeDesign(input: { nombre: unknown; componentes: unknown; descripcion: unknown }) {
  const name = clean(input.nombre), summary = clean(input.descripcion);
  const components = Array.isArray(input.componentes) ? [...new Set(input.componentes.map(clean).filter(Boolean))] : [];
  if (!name || name.length > DESIGN_LIMITS.name || !WORDS.test(name) || CODE.test(name)) throw new DesignError('nombre');
  if (!components.length || components.length > DESIGN_LIMITS.components || components.some(c => c.length > DESIGN_LIMITS.component || !WORDS.test(c) || CODE.test(c))) throw new DesignError('componentes');
  if (!summary || summary.length > DESIGN_LIMITS.summary || CODE.test(summary)) throw new DesignError('descripcion');
  return { name, components, summary };
}
