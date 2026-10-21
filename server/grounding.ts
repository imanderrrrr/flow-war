/**
 * Grounding: every value Claude passes to an execution tool must be stated in the student's own words.
 * The model quotes fragments (`citas`); the server checks that each quote is literally present in the
 * student's text and that the value is expressed inside a quote. A value the student did not state is
 * never executed, whatever the model claims.
 */

export function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[“”«»"'`´]/g, ' ').replace(/[^\p{L}\p{N}%\-.,:]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

const UNITS: Record<string, number> = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
  veinte: 20, veintiun: 21, veintiuno: 21, veintiuna: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25,
  veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60,
  setenta: 70, ochenta: 80, noventa: 90, cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300,
  cuatrocientos: 400, cuatrocientas: 400, quinientos: 500, quinientas: 500, seiscientos: 600, seiscientas: 600, setecientos: 700,
  setecientas: 700, ochocientos: 800, ochocientas: 800, novecientos: 900, novecientas: 900, mil: 1000,
};
/** "Otro servidor" and "un servidor" state a single unit. */
const SINGLE = new Set(['otro', 'otra']);
export type Mention = { value: number; unit?: 'min' | 's' | 'ms' | 'h' | 'q' | '%' | 'x' };

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
/** Numbers written by the student, in digits or Spanish words, with the unit that follows them. */
export function mentions(text: string): Mention[] {
  const words = normalize(text).replace(/([a-z])(\d)/g, '$1 $2').replace(/(\d)([a-z%])/g, '$1 $2').split(' ').filter(Boolean);
  const found: Mention[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i].replace(/[.,:]+$/, '');
    if (/^\d+([.,]\d+)*$/.test(w)) {
      const prefix = words[i - 1] === 'q' ? 'q' : undefined;
      found.push({ value: parseDigits(w), unit: prefix ?? unitOf(words[i + 1]?.replace(/[.,:]+$/, '')) });
      continue;
    }
    if (SINGLE.has(w)) { found.push({ value: 1 }); continue; }
    if (!Object.hasOwn(UNITS, w)) continue;
    let total = 0, current = 0, j = i;
    for (; j < words.length; j++) {
      const word = words[j].replace(/[.,:]+$/, '');
      // Spanish joins only tens and units with "y" (treinta y cinco); "uno y dos" stays two numbers.
      const next = words[j + 1]?.replace(/[.,:]+$/, '');
      if (word === 'y' && j > i && current % 100 >= 30 && current % 10 === 0 && next && Object.hasOwn(UNITS, next) && UNITS[next] < 10) continue;
      if (!Object.hasOwn(UNITS, word)) break;
      const v = UNITS[word];
      if (v === 1000) { total += (current || 1) * 1000; current = 0; } else current += v;
    }
    found.push({ value: total + current, unit: unitOf(words[j]?.replace(/[.,:]+$/, '')) });
    i = j - 1;
  }
  return found;
}

export class GroundingError extends Error { constructor(public field: string) { super(field); } }

/** Sources: the current instruction plus, when it explicitly refers back to them, the student's earlier messages. */
export type Sources = { instruction: string; previous: string[] };
const BACK_REFERENCE = /\b(que te (indique|dije|pase|mande|escribi)|indicad[oa]s|mencionad[oa]s|anterior(es)?|de antes|los mismos|las mismas|el mismo|la misma|que ya (te )?(di|dije|indique))\b/;
export function sourceTexts(s: Sources): string[] {
  return BACK_REFERENCE.test(normalize(s.instruction)) ? [s.instruction, ...s.previous] : [s.instruction];
}
/** Each quote must be a literal fragment of the student's words; returns the normalized quotes. */
export function checkQuotes(citas: unknown, s: Sources): string[] {
  if (!Array.isArray(citas) || citas.length > 12) throw new GroundingError('citas');
  const texts = sourceTexts(s).map(normalize);
  return citas.map(c => {
    if (typeof c !== 'string') throw new GroundingError('citas');
    const quote = normalize(c);
    if (!quote || quote.length > 600 || !texts.some(t => t.includes(quote))) throw new GroundingError('citas');
    return quote;
  });
}
const scale: Record<string, number> = { min: 60, h: 3600 };
/** The value must be written by the student inside one of the quotes. */
export function groundNumber(field: string, value: number, quotes: string[], kind: 'count' | 'money' | 'seconds' | 'millis' | 'plain' = 'plain') {
  if (!Number.isFinite(value)) throw new GroundingError(field);
  const ok = quotes.some(q => mentions(q).some(m => {
    if (kind === 'seconds') return (m.unit && scale[m.unit] ? m.value * scale[m.unit] : m.value) === value;
    if (kind === 'millis') return (m.unit === 's' ? m.value * 1000 : m.unit === 'min' ? m.value * 60000 : m.value) === value;
    return m.value === value;
  }));
  if (!ok) throw new GroundingError(field);
  return value;
}
/** A literal value chosen from an enumeration must appear through one of its synonyms. */
export function groundChoice(field: string, quotes: string[], patterns: RegExp[]) {
  if (!quotes.some(q => patterns.some(p => p.test(q)))) throw new GroundingError(field);
}
/** Free text forwarded on the student's behalf must be their exact words. */
export function groundVerbatim(field: string, text: unknown, s: Sources): string {
  if (typeof text !== 'string' || !text.trim()) throw new GroundingError(field);
  const n = normalize(text);
  if (!sourceTexts(s).map(normalize).some(t => t.includes(n))) throw new GroundingError(field);
  return text.trim();
}
/** Identifiers such as CH-004, PRD-002, C0-QA3 or sim-4, tolerant to letter case and leading zeros. */
export function mentionsId(id: string, quotes: string[]): boolean {
  const canonical = (v: string) => normalize(v).replace(/(\D)0+(\d)/g, '$1$2');
  const target = canonical(id);
  return quotes.some(q => canonical(q).split(' ').some(token => token.replace(/[.,:]+$/, '') === target));
}
