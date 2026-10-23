import type { GameState } from '../shared/types.js';
import type { DeclineReason } from '../shared/executor.js';
import { normalize, words } from './grounding.js';

/**
 * The executor's scope, checked on the student's own words by the server and never by the model. An order about
 * another company, an attempt to change the executor's rules or a request unrelated to the game executes nothing,
 * whatever tool calls the provider returns. The same screen runs before the provider is contacted, so those
 * instructions spend no tokens, and it keeps such messages out of the earlier messages later orders may cite.
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
const NOT_A_COMPANY = new Set(['orbita', 'orbitas', 'verter']);
/** All-caps words that may follow "empresa" without naming a rival: roles, controls and the game itself. */
const NOT_A_NAME = new Set(['qa', 'cto', 'devops', 'backend', 'seguridad', 'producto', 'flow', 'war', 'waf', 'auth', 'web', 'api', 'ux']);
const LEET: Record<string, string> = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't' };
/** The ways one written word may spell a name: without dots and hyphens, digits read as letters, letters not doubled. */
function spellings(word: string) {
  const bare = word.replace(/[.\-]/g, ''), out = new Set([word, bare]);
  if (/\d/.test(bare) && /[a-z]/.test(bare)) out.add(bare.replace(/[013457]/g, d => LEET[d]));
  for (const w of [...out]) out.add(w.replace(/(.)\1+/g, '$1'));
  return out;
}
/** Words of the text plus every stretch of three or more single letters joined ("a B Y T E" gives "byte"). */
function candidates(text: string) {
  const list = words(text), joined: string[] = [];
  for (let i = 0; i < list.length;) {
    let j = i; while (j < list.length && /^[a-z0-9]$/.test(list[j])) j++;
    for (let a = i; a + 3 <= j; a++) for (let b = a + 3; b <= j; b++) joined.push(list.slice(a, b).join(''));
    i = Math.max(j, i + 1);
  }
  return [...list, ...joined].flatMap(w => [...spellings(w)]);
}
const NUMBERS: Record<string, number> = { uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5 };
/** "EMPRESA 02", "empresa-02", "grupo nº 3", "empresa dos"; "la empresa 2 servidores" counts servers, not companies. */
const TAG = /\b(?:empresa|grupo|compania)\s*(?:(?:n|no|nro|numero|nº)\s*)?[-#.]?\s*(0?[1-5]|uno|una|dos|tres|cuatro|cinco)\b(?!\s+(?:servidor(?:es)?|unidad(?:es)?|solicitud(?:es)?|compras?|clientes?|pedidos?|usuarios?|instancias?|segundos?|minutos?|vez|veces|requests?|reintentos?|intentos?|bloques?|cupones?))/g;
/** Phrases that point at the other companies without naming one. They count only next to something they could act on. */
const RIVALS = [
  /(otra|otras) (empresa|empresas|compania|companias|tienda|tiendas)/, /(las|los) (demas|otras|otros) (empresas|companias|equipos|tiendas)/,
  /(todas las|cada|las cinco|las 5|cualquier|cualquiera de las) (empresas?|companias?)/, /resto de (las )?(empresas|companias|equipos)/,
  /(empresas?|companias?|equipos?|tiendas?) (rival|rivales|enemig[oa]s?|contrari[oa]s?|ajen[oa]s?|competidor[ae]s?)/,
  /(la|las|nuestra|nuestras|a la|de la|contra la) competencia/, /competidor(a|es|as)?/, /rival(es)?/,
  /(other|another) (company|companies|team|teams|store|stores)/, /competitors?/,
  /la de al lado/, /(tienda|empresa|equipo|compania)s? (de al lado|de enfrente|vecinas?|vecinos?)/, /los vecinos/, /(la|el) que va (ganando|primero|primera|adelante)/,
];
const RIVAL = new RegExp(`^(?:${RIVALS.map(r => r.source).join('|')})(?= |$)`);
const TARGET = /^(trafico|clientes?|ventas?|servidor(es)?|dinero|plata|capital|presupuestos?|stock|precios?|reputacion|planos?|cambios?|datos|finanzas|mantenimiento|origen(es)?|control(es)?|borrador(es)?|promocion(es)?|campanas?|demanda|pedidos?|claves?|credenciales|informacion|configuracion|traffic|customers?|clients?|sales|servers?|money|budget|prices?|data|orders?|reputation|demand)$/;
/** Words that may sit between an object and the rival it belongs to: "el tráfico anómalo de la competencia". */
const LINK = /^(el|la|los|las|lo|un|una|unos|unas|de|del|a|al|en|para|con|sobre|contra|y|o|su|sus|mi|mis|nuestro|nuestra|nuestros|nuestras|total|completo|completa|anomalo|simulado|entero|entera|todo|toda|todos|todas|the|of|to|for|in|on|from|an|our|their|its)$|\d/;
/**
 * A rival phrase tied to something it could change or read, in the same sentence: the object right before it, with
 * only articles, prepositions or IDs in between ("el tráfico a la competencia", "el origen sim-4 en la empresa
 * rival"), or within three words after it ("a la tienda de al lado le lleguen menos clientes"). "Para ganarle a la
 * competencia" and "500 compradores de la competencia" name no object of the rival and stay in scope.
 */
function aimsAtRivals(text: string) {
  return text.split(/[;!?\n]|\.(?=\s|$)/).some(sentence => {
    const list = words(sentence);
    return list.some((_, i) => {
      const m = list.slice(i, i + 6).join(' ').match(RIVAL); if (!m) return false;
      let k = i - 1; while (k >= 0 && i - k <= 5 && LINK.test(list[k]) && !TARGET.test(list[k])) k--;
      return (k >= 0 && TARGET.test(list[k])) || list.slice(i + m[0].split(' ').length, i + m[0].split(' ').length + 4).some(w => TARGET.test(w));
    });
  });
}
/** The instruction names, or aims at, a company other than the session's own. */
export function namesOtherCompany(g: GameState, companyId: number, text: string) {
  const own = g.companies[companyId].name.toLowerCase(), spelled = candidates(text), plain = normalize(text);
  for (const c of g.companies) {
    if (c.id === companyId) continue;
    const name = c.name.toLowerCase();
    // A name always counts as spelled; one of five letters or more also one edit away ("Amber" for EMBER).
    if (spelled.some(w => w === name || w === `${name}s` || (name.length >= 5 && w.length >= 4 && !NOT_A_COMPANY.has(w) && oneEdit(w, name)))) return true;
  }
  for (const m of plain.matchAll(TAG)) if ((NUMBERS[m[1]] ?? Number(m[1])) - 1 !== companyId) return true;
  // "la empresa ZETA": an all-caps name right after "empresa", on the same line, that is not the session's own.
  for (const m of text.matchAll(/(?:^|[^\p{L}])(?:[Ee]mpresa|EMPRESA|[Cc]ompa[ñn][íi]a|COMPA[ÑN][ÍI]A)[ \t]+(?:de[ \t]+)?([A-ZÁÉÍÓÚÑ]{3,})(?![\p{L}\d-])/gu)) {
    const name = normalize(m[1]);
    if (name !== own && !NOT_A_NAME.has(name)) return true;
  }
  return aimsAtRivals(text);
}

const OVERRIDES = [
  /\b(ignor\w*|olvid\w*|omit\w*|salte\w*|saltate|anul\w*|desobedec\w*|cambia|cambiar|modifica|modificar|reescrib\w*|rompe|romper|salta|saltar|desactiva\w*|quita\w*|elimina\w*) (de )?(todas |todos )?(tus|tu) (propias )?(reglas|regla|instrucciones|instruccion|restricciones|restriccion|indicaciones|politicas|limites|directivas|normas|prompt|programacion)\b/,
  /\b(ignor\w*|olvid\w*|omit\w*) (de )?(las|todas las|esas|estas|cualquier|cualquiera de las) (instrucciones|indicaciones|directivas)\b/,
  /\bno (sigas|respetes|cumplas|obedezcas|apliques|hagas caso a) tus (reglas|instrucciones|restricciones|normas)\b/,
  /\b(olvidate de todo|olvida todo|(ignora|olvida|omiti|omite) (todo )?lo anterior)\b/,
  /\bignore (all )?(the |your )?(previous |prior |above )?(instructions|rules)\b/,
  /\b(ignor\w*|olvid\w*) (el |tu )?prompt\b|\b(ignor\w*|olvid\w*) tu sistema\b/,
  /\b(system prompt|prompt del sistema|prompt de sistema|instrucciones del sistema|mensaje del sistema|jailbreak|developer mode)\b/,
  /\bmodo (desarrollador|developer|dios|root|sin restricciones|sin limites|sin reglas)\b/,
  /\b(a partir de ahora|desde ahora|de ahora en adelante) (sos|eres|seras|actua\w*|respond\w*)\b/,
  /\bahora (sos|eres) (un|una|el|la)\b|\brespond\w* como (un|una)\b|\bcomportate como\b|\bsupongamos que (sos|eres)\b|\bjuga a ser\b|\bhagamos de cuenta\b|\b(haz|hace|haga) de cuenta\b/,
  // "Actuá como…" as an order to Claude, never "el módulo actúa como caché" or "que actúe como respaldo".
  /(^|[.:] |\b(ahora|vos|tu) )(actua|actuas) como\b/,
  /\b(fingi|finge|fingir|simula|simular|pretende|imagina) (que )?(sos|eres|ser)\b/,
  /\b(revela\w*|mostra|mostrame|muestrame|muestra|deci|decime|dime|cuales son|copia\w*|repeti\w*|imprim\w*) (tus|tu) (reglas|instrucciones|prompt)\b/,
  /\brepeti (el texto|todo lo) de arriba\b|\b(instrucciones nuevas|nuevas instrucciones)\b|\bya no (tenes|tienes) (reglas|restricciones|limites)\b/,
];
/** The message tries to change, skip or reveal the executor's rules, or to give it another role. */
export function overridesRules(text: string) { const plain = normalize(text); return OVERRIDES.some(p => p.test(plain)); }

/** Requests with nothing to do with a software-quality game: schoolwork, entertainment, general knowledge. */
const OFF_TOPIC = [
  /\b(un|una|otro|otra|el|la) (chiste|poema|cuento|adivinanza|trabalenguas|refran|rap|cancion)\b|\b(chistes|poemas|adivinanzas)\b|\b(una|la) receta (de|para)\b/,
  /\b(tareas?|deberes|examen|parcial|ejercicios?) de (matematicas?|fisica|quimica|historia|ingles|biologia|lengua|literatura|geografia|filosofia|calculo|algebra|estadistica|economia|sociales|ciencias)\b/,
  /\b(hace|haceme|hazme|hagan|resolve|resuelve|resolveme|resuelveme) (la|mi|mis|las|esta|este) (tarea|tareas|deberes|ejercicio|ejercicios|examen)\b/,
  /\b(ecuacion|ecuaciones|integral de|raiz cuadrada|teorema|fotosintesis|mitosis|tabla periodica|ley de ohm|primera guerra|segunda guerra|revolucion francesa)\b/,
  // "la capital de Francia", never "el capital de la empresa".
  /\b(la capital (de|del)|cual es la capital)\b/,
  /\b(presidente de|quien (fue|gano|invento|descubrio|escribio|pinto)|cuantos anos tiene|que hora es|el clima|del clima|pronostico del tiempo|partido de futbol|resultado del partido|mundial de futbol)\b/,
  /\bcuanto (es|da|son) \d+ (por|mas|menos|entre|dividido|x) \d+\b/,
  /\bresumen (de|del) (el |la |los |las )?(libro|quijote|pelicula|serie|primera guerra|segunda guerra)\b/,
  // A request for code in a programming language, never "inyección de código en SQL".
  /\b(escribi|escribime|escribeme|escribe|escriba|hace|haceme|hazme|dame|genera|generame|programa|programame|crea|creame|arma|armame)\b.{0,40}\b(codigo|programa|script|funcion)\b.{0,30}\b(en|de) (python|java|javascript|typescript|php|rust|ruby|kotlin|swift|go)\b/,
  /\b(tell me a joke|jokes?|poems?|homework|essay)\b/,
];
export function offTopic(text: string) { const plain = normalize(text); return OFF_TOPIC.some(p => p.test(plain)); }

/** Words of the game; an instruction with none of them is not about FLOW WAR. Stems match word beginnings. */
const GAME_STEMS = ['servidor', 'bloque', 'cambio', 'prueba', 'probar', 'proba', 'suite', 'qa', 'cto', 'devops', 'backend', 'seguridad', 'control', 'despleg', 'desplieg', 'deploy',
  'rollback', 'balanceador', 'presupuesto', 'capital', 'finanz', 'dinero', 'plata', 'inventario', 'pago', 'stock', 'modulo', 'borrador', 'plano', 'pieza', 'carta', 'devolu', 'devolv', 'promo', 'campan', 'catalogo',
  'embudo', 'version', 'incidente', 'trafico', 'cliente', 'compra', 'venta', 'mercado', 'reputac', 'empresa', 'partida', 'juego', 'flow', 'tutorial', 'staging', 'produccion', 'cola', 'cache',
  'lock', 'retry', 'reintento', 'idempot', 'validac', 'checkout', 'tienda', 'salida', 'entrada', 'auth', 'waf', 'bot', 'rate', 'limite', 'origen', 'sim-', 'concurren', 'carga', 'regresi',
  'integraci', 'unitari', 'aprob', 'aprueb', 'rechaz', 'autoriz', 'riesgo', 'evidencia', 'solicitud', 'alcance', 'mantenimiento', 'servicio', 'reinici', 'escal', 'rol', 'equipo', 'departamento',
  'revision', 'conect', 'perimetro', 'conexion', 'atomic', 'payment', 'producto', 'decision', 'operacion', 'orden', 'costo', 'gasto', 'saldo', 'reserva', 'auditor', 'sesion', 'login', 'usuario',
  'contrasena', 'token', 'cupon', 'descuento', 'precio', 'unidad', 'pedido', 'web', 'infraestructura', 'estrategia', 'rolling', 'restart', 'replace', 'agreg', 'quit', 'activ', 'desactiv', 'guard', 'entreg', 'envi',
  'estado', 'resultado', 'visita', 'ttl'];
const GAME_ID = /\b(ch|prd|req|rb|inv|cmp)-?\d+\b|\bc\d-qa\d+\b|\bv\d+\b/;
/** Used only when the provider returned no operation: decides between "no operation" and "not about the game". */
export function aboutTheGame(text: string) {
  return GAME_ID.test(normalize(text)) || words(text).some(w => GAME_STEMS.some(s => w.startsWith(s)));
}

/** The first reason, in order of harm, that the instruction is outside the executor's scope; undefined when it is in scope. */
export function screenInstruction(g: GameState, companyId: number, text: string): DeclineReason | undefined {
  if (namesOtherCompany(g, companyId, text)) return 'OTRA_EMPRESA';
  if (overridesRules(text)) return 'CAMBIO_DE_REGLAS';
  if (offTopic(text)) return 'FUERA_DEL_JUEGO';
  return undefined;
}
