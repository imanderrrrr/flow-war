import type { GameState } from '../shared/types.js';
import type { DeclineReason } from '../shared/executor.js';
import { normalize, words } from './grounding.js';

/**
 * The executor's scope, checked on the student's own words by the server and never by the model. An order about
 * another company, an attempt to change the executor's rules or a request unrelated to the game executes nothing,
 * whatever tool calls the provider returns. The same screen runs before the provider is contacted, so those
 * instructions spend no tokens.
 */

/** Edit distance of at most one (one letter changed, added or removed). */
function oneEdit(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
/** Spanish words one edit away from a company name that are not that company. */
const NOT_A_COMPANY = new Set(['orbita', 'orbitas']);
/** Words that may follow "empresa" with a capital letter without naming a rival: roles and the game itself. */
const NOT_A_NAME = new Set(['qa', 'cto', 'devops', 'backend', 'seguridad', 'producto', 'flow']);
const RIVALS = [
  /\b(otra|otras) (empresa|empresas|compania|companias|tienda|tiendas)\b/, /\b(otro|otros) (equipo|equipos)\b/,
  /\b(las|los) (demas|otras|otros) (empresas|companias|equipos|tiendas)\b/,
  /\b(todas las|cada|las cinco|las 5|cualquier|cualquiera de las) (empresas?|companias?)\b/,
  /\bresto de (las )?(empresas|companias|equipos)\b/,
  /\b(empresas?|companias?|equipos?|tiendas?) (rival|rivales|enemig[oa]s?|contrari[oa]s?|ajen[oa]s?|competidor[ae]s?)\b/,
  /\b(la|las|nuestra|nuestras|a la|de la|contra la) competencia\b/, /\bcompetidor(a|es|as)?\b/, /\brival(es)?\b/,
];
/** The instruction names, or aims at, a company other than the session's own. */
export function namesOtherCompany(g: GameState, companyId: number, text: string) {
  const own = g.companies[companyId].name.toLowerCase(), list = words(text), plain = normalize(text);
  for (const c of g.companies) {
    if (c.id === companyId) continue;
    const name = c.name.toLowerCase();
    // An exact name always counts; a name of five letters or more also counts one edit away ("Amber" for EMBER).
    if (list.some(w => w === name || w === `${name}s` || (name.length >= 5 && w.length >= 4 && !NOT_A_COMPANY.has(w) && oneEdit(w, name)))) return true;
  }
  // "EMPRESA 02" is VERTEX's tag on every screen.
  for (const m of plain.matchAll(/\bempresa (?:0([1-5])|(?:numero|nro|n) ?([1-5]))\b/g)) if (Number(m[1] ?? m[2]) - 1 !== companyId) return true;
  // "la empresa Amber": a proper name after "empresa" that is not the session's own.
  for (const m of text.matchAll(/(?:^|[^\p{L}])(?:empresa|compañía|compania)\s+(?:de\s+)?([A-ZÁÉÍÓÚÑ]\p{L}{2,})(?![\p{L}\d-])/gu)) {
    const name = normalize(m[1]);
    if (name !== own && !NOT_A_NAME.has(name)) return true;
  }
  return RIVALS.some(p => p.test(plain));
}

const OVERRIDES = [
  /\b(ignor\w*|olvid\w*|omit\w*|salte\w*|saltate|anul\w*|desobedec\w*) (de )?(todas |todos )?(tus|las|esas|estas|cualquier|tu|sus) (propias )?(reglas|regla|instrucciones|instruccion|restricciones|restriccion|indicaciones|politicas|limites|directivas|normas)\b/,
  /\b(cambia|cambiar|modifica|modificar|reescrib\w*|rompe|romper|salta|saltar) (tus|tu) (reglas|regla|instrucciones|restricciones|normas|prompt|programacion)\b/,
  /\bno (sigas|respetes|cumplas|obedezcas|apliques|hagas caso a) (tus|las|esas|estas) (reglas|instrucciones|restricciones|normas)\b/,
  /\b(ignor\w*|olvid\w*) (el|tu) (prompt|sistema)\b/,
  /\b(system prompt|prompt del sistema|prompt de sistema|instrucciones del sistema|instrucciones originales|instrucciones anteriores|mensaje del sistema|jailbreak|developer mode)\b/,
  /\bmodo (desarrollador|developer|dios|admin|administrador|root|sin restricciones|sin limites|sin reglas)\b/,
  /\b(a partir de ahora|desde ahora|de ahora en adelante) (sos|eres|seras|actua\w*|respond\w*)\b/,
  /\b(actua|actuas|actue) como\b|\b(fingi|finge|fingir|simula|simular|pretende|imagina) (que )?(sos|eres|ser)\b|\b(haz|hace|haga) de cuenta\b/,
  /\b(revela\w*|mostrame|muestrame|dime|decime|copia\w*|repeti\w*|imprim\w*) (tus|tu) (reglas|instrucciones|prompt|configuracion)\b/,
  /\bnuevas instrucciones\b|\bolvida todo\b/,
];
/** The message tries to change, skip or reveal the executor's rules, or to give it another role. */
export function overridesRules(text: string) { const plain = normalize(text); return OVERRIDES.some(p => p.test(plain)); }

/** Requests with nothing to do with a software-quality game: schoolwork, entertainment, general knowledge. */
const OFF_TOPIC = [
  /\b(chistes?|poemas?|poesia|cancion|canciones|recetas?|horoscopo|adivinanzas?|cuentos?|novela|ensayo|monografia|trabalenguas|refran)\b/,
  /\b(tareas?|deberes|examen|parcial|ejercicios?) de (matematicas?|fisica|quimica|historia|ingles|biologia|lengua|literatura|geografia|filosofia|calculo|algebra|estadistica|economia|sociales|ciencias)\b/,
  /\b(hace|haceme|hazme|hagan|resolve|resuelve|resolveme|resuelveme) (la|mi|mis|las|esta|este) (tarea|tareas|deberes|ejercicio|ejercicios|examen)\b/,
  /\b(ecuacion|ecuaciones|raiz cuadrada|teorema|fotosintesis|tabla periodica|ley de ohm|segunda guerra|revolucion francesa)\b/,
  // "capital de Francia", never "el capital de la empresa".
  /\bcapital de (?!(la|el|mi|nuestra|nuestro|tu|su|nova|vertex|byte|ember|orbit|empresa|q)\b)(?!\d)/,
  /\b(presidente de|quien (fue|gano|invento|descubrio|escribio|pinto)|cuantos anos tiene|que hora es|el clima|del clima|pronostico del tiempo|partido de futbol|resultado del partido|mundial de futbol)\b/,
  /\b(codigo|programa|script|funcion) (en|de) (python|java|javascript|typescript|html|css|sql|c\+\+|php)\b/,
  /\btraduc\w* (esto|esta|este|al|del) (ingles|frances|aleman|portugues|italiano|espanol|chino|japones)\b/,
];
export function offTopic(text: string) { const plain = normalize(text); return OFF_TOPIC.some(p => p.test(plain)); }

/** Words of the game; an instruction with none of them is not about FLOW WAR. Stems match word beginnings. */
const GAME_STEMS = ['servidor', 'bloque', 'cambio', 'prueba', 'probar', 'proba', 'suite', 'qa', 'cto', 'devops', 'backend', 'seguridad', 'control', 'despleg', 'desplieg', 'deploy',
  'rollback', 'balanceador', 'presupuesto', 'capital', 'finanz', 'dinero', 'inventario', 'pago', 'stock', 'modulo', 'borrador', 'plano', 'pieza', 'carta', 'devolu', 'devolv', 'promo', 'campan', 'catalogo',
  'embudo', 'version', 'incidente', 'trafico', 'cliente', 'compra', 'venta', 'mercado', 'reputac', 'empresa', 'partida', 'juego', 'flow', 'tutorial', 'staging', 'produccion', 'cola', 'cache',
  'lock', 'retry', 'reintento', 'idempot', 'validac', 'checkout', 'tienda', 'salida', 'entrada', 'auth', 'waf', 'bot', 'rate', 'limite', 'origen', 'sim-', 'concurren', 'carga', 'regresi',
  'integraci', 'unitari', 'aprob', 'aprueb', 'rechaz', 'autoriz', 'riesgo', 'evidencia', 'solicitud', 'alcance', 'mantenimiento', 'servicio', 'reinici', 'escal', 'rol', 'equipo', 'departamento',
  'revision', 'conect', 'perimetro', 'conexion', 'atomic', 'payment', 'producto', 'decision', 'operacion', 'orden', 'costo', 'gasto', 'saldo', 'reserva', 'auditor', 'sesion', 'login', 'usuario',
  'contrasena', 'token', 'cupon', 'descuento', 'precio', 'unidad', 'pedido', 'web', 'infraestructura', 'estrategia', 'rolling', 'restart', 'replace', 'agreg', 'quit', 'activ', 'desactiv', 'guard', 'entreg', 'envi'];
const GAME_ID = /\b(ch|prd|req|rb|inv|cmp)-?\d+\b|\bc\d-qa\d+\b|\bv\d+\b/;
/** Used only when the provider returned no operation: decides between "no operation" and "not about the game". */
export function aboutTheGame(text: string) {
  return GAME_ID.test(normalize(text)) || words(text).some(w => GAME_STEMS.some(s => w.startsWith(s)));
}

/**
 * The first reason, in order of harm, that the instruction (and the earlier messages it explicitly refers back to)
 * is outside the executor's scope; undefined when it is in scope.
 */
export function screenInstruction(g: GameState, companyId: number, texts: string[]): DeclineReason | undefined {
  if (texts.some(t => namesOtherCompany(g, companyId, t))) return 'OTRA_EMPRESA';
  if (texts.some(overridesRules)) return 'CAMBIO_DE_REGLAS';
  if (texts.some(offTopic)) return 'FUERA_DEL_JUEGO';
  return undefined;
}
