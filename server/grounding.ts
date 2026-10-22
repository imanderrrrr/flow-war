/**
 * Grounding: every value Claude passes to an execution tool must be stated in the student's own words.
 * The model quotes fragments (`citas`); the server checks that each quote is a sequence of whole words of the
 * student's text, that every value is written inside a quote next to the word that names its field and with its
 * unit, and that the operation verb itself appears, not negated, in the current instruction. A value the student
 * did not state is never executed, whatever the model claims.
 */

export function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[“”«»"'`´]/g, ' ').replace(/[^\p{L}\p{N}%\-.,:]+/gu, ' ').replace(/\s+/g, ' ').trim();
}
/** Whole words without trailing punctuation: "13" never contains "3", "CH-12" never contains "CH-1". */
export function words(text: string): string[] {
  return normalize(text).split(' ').map(w => w.replace(/[.,:]+$/, '')).filter(Boolean);
}
const joined = (text: string) => ` ${words(text).join(' ')} `;

const UNITS: Record<string, number> = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
  veinte: 20, veintiun: 21, veintiuno: 21, veintiuna: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25,
  veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60,
  setenta: 70, ochenta: 80, noventa: 90, cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300,
  cuatrocientos: 400, cuatrocientas: 400, quinientos: 500, quinientas: 500, seiscientos: 600, seiscientas: 600, setecientos: 700,
  setecientas: 700, ochocientos: 800, ochocientas: 800, novecientos: 900, novecientas: 900, mil: 1000, millon: 1_000_000, millones: 1_000_000,
};
/** Articles and "otro" state one unit only next to the noun they qualify ("un servidor", "otro servidor"). */
const ARTICLES = new Set(['un', 'una', 'uno', 'otro', 'otra']);
export type Mention = { value: number; unit?: 'min' | 's' | 'ms' | 'h' | 'q' | '%' | 'x'; start: number; end: number; article: boolean };

function unitOf(word: string | undefined): Mention['unit'] | undefined {
  if (!word) return;
  if (/^(minutos?|min)$/.test(word)) return 'min';
  if (/^(segundos?|seg|s)$/.test(word)) return 's';
  if (/^(milisegundos?|ms)$/.test(word)) return 'ms';
  if (/^(horas?)$/.test(word)) return 'h';
  if (/^(quetzales?)$/.test(word)) return 'q';
  if (/^(%|por)$/.test(word)) return '%';
  if (/^(x|veces)$/.test(word)) return 'x';
}
function parseDigits(raw: string): number {
  if (/^\d{1,3}([.,]\d{3})+$/.test(raw)) return Number(raw.replace(/[.,]/g, ''));
  return Number(raw.replace(',', '.'));
}
/** Numbers written by the student, in digits or Spanish words, with their unit and word positions. */
export function mentions(text: string): Mention[] {
  const raw = normalize(text).replace(/([a-z])(\d)/g, '$1 $2').replace(/(\d)([a-z%])/g, '$1 $2').split(' ').filter(Boolean);
  const list = raw.map(w => w.replace(/[.,:]+$/, '')), closes = raw.map(w => /[.,:]$/.test(w) && !/^\d+([.,]\d+)*$/.test(w));
  const found: Mention[] = [];
  for (let i = 0; i < list.length; i++) {
    const w = list[i];
    if (/^\d+([.,]\d+)*$/.test(w)) {
      const prefix = list[i - 1] === 'q' ? 'q' : undefined;
      found.push({ value: parseDigits(w), unit: prefix ?? unitOf(list[i + 1]), start: prefix ? i - 1 : i, end: i, article: false });
      continue;
    }
    if (ARTICLES.has(w) && !(w === 'un' && Object.hasOwn(UNITS, list[i + 1] ?? '') && list[i + 1] !== 'un')) { found.push({ value: 1, unit: unitOf(list[i + 1]), start: i, end: i, article: true }); continue; }
    if (!Object.hasOwn(UNITS, w)) continue;
    let total = 0, current = 0, j = i;
    for (; j < list.length; j++) {
      const word = list[j], next = list[j + 1];
      // Spanish joins only tens and units with "y" (treinta y cinco); "uno y dos" stays two numbers.
      if (word === 'y' && j > i && current % 100 >= 30 && current % 10 === 0 && next && Object.hasOwn(UNITS, next) && UNITS[next] < 10) continue;
      if (!Object.hasOwn(UNITS, word) || (j > i && ARTICLES.has(word) && list[j - 1] !== 'y')) break;
      const v = UNITS[word];
      if (v >= 1000) { total += (current || 1) * v; current = 0; } else current += v;
      if (closes[j]) { j++; break; } // "dos, tres" are two numbers
    }
    found.push({ value: total + current, unit: unitOf(list[j]), start: i, end: j - 1, article: false });
    i = j - 1;
  }
  return found;
}

export class GroundingError extends Error { constructor(public field: string) { super(field); } }

/** Sources: the current instruction plus, when it explicitly refers back to them, the student's earlier messages. */
export type Sources = { instruction: string; previous: string[] };
const BACK_REFERENCE = /\b(que te (indique|dije|pase|mande|escribi|di)|lo que te (dije|indique|pase)|(valores|parametros|datos) (que te|indicados|mencionados|anteriores|de antes)|los mismos (valores|parametros|datos)|mensaje anterior)\b/;
export function sourceTexts(s: Sources): string[] {
  return BACK_REFERENCE.test(normalize(s.instruction)) ? [s.instruction, ...s.previous] : [s.instruction];
}
/** Each quote must be a sequence of whole words of the student's text; returns the normalized quotes. */
export function checkQuotes(citas: unknown, s: Sources): string[] {
  if (!Array.isArray(citas) || citas.length > 12) throw new GroundingError('citas');
  const texts = sourceTexts(s).map(joined);
  return citas.map(c => {
    if (typeof c !== 'string') throw new GroundingError('citas');
    const quote = words(c).join(' ');
    if (!quote || quote.length > 600 || !texts.some(t => t.includes(` ${quote} `))) throw new GroundingError('citas');
    return quote;
  });
}
export type NumberKind = 'count' | 'money' | 'seconds' | 'millis' | 'percent' | 'factor' | 'plain';
const SCALE: Record<string, number> = { min: 60, h: 3600 };
const MONEY_WORDS = /^(q|quetzales?|presupuesto|monto|costo|maximo)$/;
/**
 * The value must be written inside a quote, with the unit its field requires, and next to a word that names the
 * field (`near`), so a number stated for one field cannot fill another.
 */
export function groundNumber(field: string, value: number, quotes: string[], kind: NumberKind = 'plain', near?: RegExp) {
  if (!Number.isFinite(value)) throw new GroundingError(field);
  const ok = quotes.some(q => { const list = words(q); return mentions(q).some(m => {
    const around = list.slice(Math.max(0, m.start - 3), m.end + 4), named = !near || around.some(w => near.test(w));
    if (m.article && (!near || !list.slice(m.end + 1, m.end + 3).some(w => near.test(w)))) return false;
    switch (kind) {
      case 'seconds': return !!m.unit && ['s', 'min', 'h'].includes(m.unit) && m.value * (SCALE[m.unit] ?? 1) === value && named;
      case 'millis': return !!m.unit && ['ms', 's', 'min'].includes(m.unit) && m.value * (m.unit === 's' ? 1000 : m.unit === 'min' ? 60000 : 1) === value && named;
      case 'money': return m.value === value && (m.unit === 'q' || (!m.unit && around.some(w => MONEY_WORDS.test(w)))) && named;
      case 'percent': return m.value === value && (m.unit === '%' || around.some(w => /^descuento$/.test(w)));
      case 'factor': return m.value === value && (m.unit === 'x' || !m.unit) && named;
      default: return m.value === value && (!m.unit || m.unit === 'x') && named;
    }
  }); });
  if (!ok) throw new GroundingError(field);
  return value;
}
/** A literal value chosen from an enumeration must appear through one of its synonyms. */
export function groundChoice(field: string, quotes: string[], patterns: RegExp[]) {
  if (!quotes.some(q => patterns.some(p => p.test(q)))) throw new GroundingError(field);
}
const NEGATIONS = new Set(['no', 'nunca', 'ni', 'tampoco', 'sin', 'jamas']);
/** Positions where a pattern matches whole words of the text, excluding matches negated by the two previous words. */
function affirmed(text: string, pattern: RegExp) {
  const list = words(text), hits: number[] = [];
  for (let i = 0; i < list.length; i++) for (let n = 1; n <= 4 && i + n <= list.length; n++) {
    const phrase = list.slice(i, i + n).join(' ');
    if (new RegExp(`^(?:${pattern.source})$`).test(phrase) && !list.slice(Math.max(0, i - 2), i).some(w => NEGATIONS.has(w))) { hits.push(i); break; }
  }
  return hits;
}
/**
 * The operation itself must be ordered in the current instruction: one of its verbs appears and is not negated,
 * and no opposing verb is also ordered ("no apruebes", "quitá … agregá" are refused).
 */
export function groundIntent(field: string, instruction: string, patterns: RegExp[], opposites: RegExp[] = []) {
  if (!patterns.some(p => affirmed(instruction, p).length)) throw new GroundingError(field);
  if (opposites.some(p => affirmed(instruction, p).length)) throw new GroundingError(field);
}
/** Order of first affirmed occurrence; used to check that "X antes de Y" or "desde X hacia Y" keeps its sense. */
export function firstPosition(text: string, pattern: RegExp) { return affirmed(text, pattern)[0] ?? -1; }

const fold = (text: string) => [...text].map(ch => ch.normalize('NFD').replace(/[̀-ͯ]/g, '')[0] ?? ch).join('').toLowerCase();
/**
 * Free text forwarded on the student's behalf must be a section the student labeled ("Asunto: …") or put in
 * quotation marks. The server forwards the student's original text, never the model's rendering.
 */
export function labeledText(field: string, instruction: string, labels: readonly string[], modelValue: unknown): string {
  const folded = fold(instruction), all = /(^|[\s.;,(])((?:asunto|descripcion|descripcion del problema|problema|pasos(?: para reproducir)?|reproduccion|observado|resultado observado|esperado|resultado esperado|gravedad|destinatario|observacion|texto|mensaje)\s*:)/g;
  const marks: { label: string; start: number; end: number }[] = [];
  for (let m; (m = all.exec(folded));) { const start = m.index + m[1].length; marks.push({ label: m[2].replace(/\s*:$/, ''), start, end: start + m[2].length }); }
  const index = marks.findIndex(m => labels.includes(m.label));
  let section = '';
  if (index >= 0) section = instruction.slice(marks[index].end, marks[index + 1]?.start ?? instruction.length);
  else { const quoted = instruction.match(/[“"«]([^“”"«»]{1,4000})[”"»]/); if (quoted && labels.includes('__quoted__')) section = quoted[1]; }
  section = section.trim().replace(/[.;,]+$/, '').trim();
  if (!section) throw new GroundingError(field);
  if (typeof modelValue === 'string' && modelValue.trim() && words(modelValue).join(' ') !== words(section).join(' ')) throw new GroundingError(field);
  return section;
}
/** Identifiers such as CH-004, PRD-002, C0-QA3 or sim-4, tolerant to letter case and leading zeros. */
export function mentionsId(id: string, quotes: string[]): boolean {
  const canonical = (v: string) => v.replace(/(\D)0+(\d)/g, '$1$2');
  const target = canonical(words(id).join(' '));
  return quotes.some(q => words(q).some(token => canonical(token) === target));
}
