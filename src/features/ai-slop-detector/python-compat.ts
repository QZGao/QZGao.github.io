/** Python string, regex and floating-point conventions used by detector.py. */
export type Span = [number, number];
const SPACE =
  '\\u0009-\\u000d\\u001c-\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const WHITE = new RegExp(`^[${SPACE}]$`, 'u');
const WORD = '[\\p{L}\\p{N}_]';

export const isSpace = (char: string): boolean => WHITE.test(char);
export const nonspace = (value: string): number =>
  Array.from(value).reduce((n, c) => n + Number(!isSpace(c)), 0);

export class Text {
  readonly chars: string[];
  readonly offsets: number[];
  readonly length: number;
  constructor(readonly value: string) {
    this.chars = Array.from(value);
    this.length = this.chars.length;
    this.offsets = [0];
    for (const c of this.chars) this.offsets.push(this.offsets[this.offsets.length - 1] + c.length);
  }
  slice(start = 0, end = this.length): string {
    return this.value.slice(this.offsets[start], this.offsets[end]);
  }
  point(unit: number): number {
    return bisectLeft(this.offsets, unit);
  }
}

export function bisectLeft(values: number[], x: number): number {
  let a = 0;
  let b = values.length;
  while (a < b) {
    const m = (a + b) >>> 1;
    if (values[m] < x) a = m + 1;
    else b = m;
  }
  return a;
}
export function bisectRight(values: number[], x: number): number {
  let a = 0;
  let b = values.length;
  while (a < b) {
    const m = (a + b) >>> 1;
    if (values[m] <= x) a = m + 1;
    else b = m;
  }
  return a;
}

function translate(pattern: string, multiline: boolean): { source: string; flags: string } {
  let flags = 'gdu';
  if (pattern.startsWith('(?i:') && pattern.endsWith(')')) {
    pattern = pattern.slice(4, -1);
    flags += 'i';
  }
  pattern = pattern
    .replace(/\(\?P<([A-Za-z_][A-Za-z_0-9]*)>/g, '(?<$1>')
    .replace(/\(\?P=([A-Za-z_][A-Za-z_0-9]*)\)/g, '\\k<$1>')
    .replaceAll('[\\s\\S]', '[\\u0000-\\u{10ffff}]');
  if (/\(\?[imsxauL]/.test(pattern)) throw new Error('Unsupported scoped Python regex flags');
  let result = '';
  let inClass = false;
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i];
    if (c === '\\') {
      const next = pattern[++i];
      if (next === undefined) throw new Error('Trailing regex escape');
      if (next === 'U') {
        result += `\\u{${pattern.slice(i + 1, i + 9)}}`;
        i += 8;
      } else if (next === 's') result += inClass ? SPACE : `[${SPACE}]`;
      else if (next === 'S') {
        if (inClass) throw new Error('Unsupported inverse whitespace inside class');
        result += `[^${SPACE}]`;
      } else if (next === 'd') result += '\\p{Nd}';
      else if (next === 'D') result += '\\P{Nd}';
      else if (next === 'w') result += inClass ? '\\p{L}\\p{N}_' : WORD;
      else if (next === 'W') {
        if (inClass) throw new Error('Unsupported inverse word class');
        result += '[^\\p{L}\\p{N}_]';
      } else if (next === 'b' && !inClass)
        result += `(?:(?<!${WORD})(?=${WORD})|(?<=${WORD})(?!${WORD}))`;
      else if (next === 'B' && !inClass)
        result += `(?:(?<=${WORD})(?=${WORD})|(?<!${WORD})(?!${WORD}))`;
      else if (next === 'A') result += '(?<![\\s\\S])';
      else if (next === 'Z' || next === 'z') result += '(?![\\s\\S])';
      else if (
        !/[A-Za-z0-9]/.test(next) &&
        !'^$\\.*+?()[]{}|/'.includes(next) &&
        !(inClass && next === '-')
      )
        result += next;
      else result += `\\${next}`;
    } else if (c === '[') {
      inClass = true;
      result += c;
    } else if (c === ']') {
      inClass = false;
      result += c;
    } else if (c === '.' && !inClass) result += '[^\\n]';
    else if (c === '^' && !inClass) result += multiline ? '(?<![^\\n])' : '(?<![\\s\\S])';
    else if (c === '$' && !inClass)
      result += multiline ? '(?=\\n|(?![\\s\\S]))' : '(?=\\n?(?![\\s\\S]))';
    else if (flags.includes('i') && !inClass && (c === 'I' || c === 'i'))
      result += '[iI\u0130\u0131]';
    else result += c;
  }
  return { source: result, flags };
}

export class Match {
  readonly start: number;
  readonly end: number;
  constructor(
    readonly native: RegExpExecArray,
    readonly text: Text,
  ) {
    this.start = text.point(native.index);
    this.end = text.point(native.index + native[0].length);
  }
  group(name?: string | number): string {
    return name === undefined
      ? this.native[0]
      : typeof name === 'number'
        ? (this.native[name] ?? '')
        : (this.native.groups?.[name] ?? '');
  }
  span(name?: string): Span {
    if (name === undefined) return [this.start, this.end];
    const pair = this.native.indices?.groups?.[name];
    return pair ? [this.text.point(pair[0]), this.text.point(pair[1])] : [-1, -1];
  }
}

export class Pattern {
  readonly regex: RegExp;
  readonly groupNames: Set<string>;
  constructor(
    readonly pattern: string,
    multiline = true,
  ) {
    const { source, flags } = translate(pattern, multiline);
    this.regex = new RegExp(source, flags);
    this.groupNames = new Set(Array.from(pattern.matchAll(/\(\?P<([^>]+)>/g), (m) => m[1]));
  }
  *finditer(input: Text | string, start = 0, end?: number): Generator<Match> {
    const text = typeof input === 'string' ? new Text(input) : input;
    const finish = end ?? text.length;
    // Python's endpos truncates the searchable string, while pos retains the
    // prefix for anchors and lookbehind. Offsets remain Unicode code points.
    const subject = text.slice(0, finish);
    const regex = new RegExp(this.regex.source, this.regex.flags);
    regex.lastIndex = text.offsets[start];
    let native: RegExpExecArray | null;
    while ((native = regex.exec(subject))) {
      const match = new Match(native, text);
      yield match;
      if (native[0].length === 0) {
        if (match.end >= finish) break;
        regex.lastIndex = text.offsets[match.end + 1];
      }
    }
  }
  search(input: Text | string, start = 0, end?: number): Match | undefined {
    return this.finditer(input, start, end).next().value;
  }
  fullmatch(input: string): boolean {
    const text = new Text(input);
    const m = this.search(text);
    return !!m && m.start === 0 && m.end === text.length;
  }
}

/** CPython's compensated float sum (integer sums here are exactly representable). */
export function sum(values: Iterable<number>): number {
  let high = 0;
  let low = 0;
  for (const value of values) {
    const total = high + value;
    low += Math.abs(high) >= Math.abs(value) ? high - total + value : value - total + high;
    high = total;
  }
  return high + low;
}

export function fsum(values: Iterable<number>): number {
  const partials: number[] = [];
  for (let x of values) {
    let i = 0;
    for (let y of partials) {
      if (Math.abs(x) < Math.abs(y)) [x, y] = [y, x];
      const high = x + y;
      const low = y - (high - x);
      if (low !== 0) partials[i++] = low;
      x = high;
    }
    partials.length = i;
    partials.push(x);
  }
  let n = partials.length;
  if (!n) return 0;
  let high = partials[--n];
  let low = 0;
  while (n) {
    const x = high;
    const y = partials[--n];
    high = x + y;
    low = y - (high - x);
    if (low !== 0) break;
  }
  if (n && ((low < 0 && partials[n - 1] < 0) || (low > 0 && partials[n - 1] > 0))) {
    const y = low * 2;
    const x = high + y;
    if (y === x - high) high = x;
  }
  return high;
}

/** statistics.mean sums exact binary ratios before its one final rounding. */
export function mean(values: number[]): number {
  if (!values.length) throw new Error('mean requires at least one value');
  const view = new DataView(new ArrayBuffer(8));
  const parts = values.map((value) => {
    view.setFloat64(0, Math.abs(value));
    const bits = view.getBigUint64(0),
      exponent = Number((bits >> 52n) & 2047n);
    const mantissa =
      ((bits & ((1n << 52n) - 1n)) | (exponent ? 1n << 52n : 0n)) * (value < 0 ? -1n : 1n);
    return { mantissa, power: (exponent || 1) - 1023 - 52 };
  });
  const power = Math.min(...parts.map((p) => p.power));
  let numerator = parts.reduce((n, p) => n + (p.mantissa << BigInt(p.power - power)), 0n),
    denominator = BigInt(values.length);
  if (numerator === 0n) return 0;
  const sign = numerator < 0n ? -1 : 1;
  if (numerator < 0n) numerator = -numerator;
  if (power >= 0) numerator <<= BigInt(power);
  else denominator <<= BigInt(-power);
  let exponent = numerator.toString(2).length - denominator.toString(2).length;
  if (
    exponent >= 0
      ? numerator < denominator << BigInt(exponent)
      : numerator << BigInt(-exponent) < denominator
  )
    exponent -= 1;
  exponent = Math.max(-1022, exponent);
  const shift = 52 - exponent;
  const top = shift >= 0 ? numerator << BigInt(shift) : numerator;
  const bottom = shift >= 0 ? denominator : denominator << BigInt(-shift);
  let q = top / bottom;
  const twice = 2n * (top % bottom);
  if (twice > bottom || (twice === bottom && q % 2n !== 0n)) q += 1n;
  return sign * Number(q) * 2 ** (exponent - 52);
}

/** Round the exact binary value to decimal places, with Python's tie-to-even rule. */
export function round(value: number, digits = 2): number {
  if (!value || !Number.isFinite(value)) return value;
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, Math.abs(value));
  const bits = view.getBigUint64(0);
  const exponent = Number((bits >> 52n) & 2047n);
  let numerator = (bits & ((1n << 52n) - 1n)) | (exponent ? 1n << 52n : 0n);
  let denominator = 1n;
  const power = (exponent || 1) - 1023 - 52;
  numerator *= 10n ** BigInt(digits);
  if (power >= 0) numerator <<= BigInt(power);
  else denominator <<= BigInt(-power);
  let q = numerator / denominator;
  const twice = 2n * (numerator % denominator);
  if (twice > denominator || (twice === denominator && q % 2n !== 0n)) q += 1n;
  return (Math.sign(value) * Number(q)) / 10 ** digits;
}

export const close = (a: number, b: number): boolean =>
  Math.abs(a - b) <= Math.max(1e-12, 1e-9 * Math.max(Math.abs(a), Math.abs(b)));
export const spanKey = ([a, b]: Span): string => `${a},${b}`;
export const spanSort = (a: Span, b: Span): number => a[0] - b[0] || a[1] - b[1];
