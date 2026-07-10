export interface ParsedTemplate {
  name: string;
  params: Map<string, string>;
}

const PROTECTED_TAGS = new Set([
  'code',
  'math',
  'nowiki',
  'pre',
  'ref',
  'source',
  'syntaxhighlight',
]);

function normaliseTemplateName(name: string): string {
  return name
    .replace(/^template\s*:/i, '')
    .trim()
    .replace(/[\s_]+/g, ' ')
    .toLowerCase();
}

function findTagEnd(source: string, start: number): number {
  let quote: '"' | "'" | null = null;

  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];

    if (quote) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return index + 1;
    }
  }

  return source.length;
}

/** Return the end of a comment or a tag whose contents MediaWiki treats as opaque. */
function protectedSpanEnd(source: string, start: number): number | null {
  if (source.startsWith('<!--', start)) {
    const end = source.indexOf('-->', start + 4);
    return end === -1 ? source.length : end + 3;
  }

  if (source[start] !== '<') return null;

  const tagEnd = findTagEnd(source, start);
  const openingTag = source.slice(start, tagEnd);
  const match = openingTag.match(/^<\s*([a-z][\w:-]*)\b/i);

  if (!match || openingTag.endsWith('/>')) return tagEnd;

  const tagName = match[1].toLowerCase();
  if (!PROTECTED_TAGS.has(tagName)) return tagEnd;

  const closingExpression = new RegExp(`<\\/\\s*${tagName}\\s*>`, 'gi');
  closingExpression.lastIndex = tagEnd;
  const closingMatch = closingExpression.exec(source);
  return closingMatch ? closingMatch.index + closingMatch[0].length : source.length;
}

interface TemplateStart {
  contentStart: number;
  empty: boolean;
}

function findTemplateStart(
  source: string,
  templateName: string,
  fromIndex: number,
): { index: number; start: TemplateStart } | null {
  const target = normaliseTemplateName(templateName);

  for (let index = fromIndex; index < source.length - 1; index += 1) {
    const protectedEnd = protectedSpanEnd(source, index);
    if (protectedEnd !== null) {
      index = protectedEnd - 1;
      continue;
    }

    if (source.startsWith('{{{', index)) {
      index += 2;
      continue;
    }
    if (!source.startsWith('{{', index)) continue;

    const pipe = source.indexOf('|', index + 2);
    const closing = source.indexOf('}}', index + 2);
    if (closing === -1 && pipe === -1) return null;

    const empty = closing !== -1 && (pipe === -1 || closing < pipe);
    const delimiter = empty ? closing : pipe;
    const invokedName = source.slice(index + 2, delimiter).trim();

    if (normaliseTemplateName(invokedName) === target) {
      return {
        index,
        start: {
          contentStart: delimiter + (empty ? 2 : 1),
          empty,
        },
      };
    }
  }

  return null;
}

function parseTemplateAt(
  source: string,
  templateName: string,
  start: TemplateStart,
): ParsedTemplate | null {
  if (start.empty) return { name: templateName, params: new Map() };

  const params = new Map<string, string>();
  const stack: Array<'argument' | 'link' | 'template'> = ['template'];
  let buffer = '';
  let key: string | null = null;
  let unnamedCount = 0;

  const flush = () => {
    const value = buffer.trim();

    if (key === null) {
      unnamedCount += 1;
      params.set(String(unnamedCount), value);
    } else {
      params.set(key.trim(), value);
    }

    buffer = '';
    key = null;
  };

  for (let index = start.contentStart; index < source.length; ) {
    const protectedEnd = protectedSpanEnd(source, index);
    if (protectedEnd !== null) {
      buffer += source.slice(index, protectedEnd);
      index = protectedEnd;
      continue;
    }

    if (source.startsWith('{{{', index)) {
      stack.push('argument');
      buffer += '{{{';
      index += 3;
    } else if (source.startsWith('{{', index)) {
      stack.push('template');
      buffer += '{{';
      index += 2;
    } else if (source.startsWith('[[', index)) {
      stack.push('link');
      buffer += '[[';
      index += 2;
    } else if (source.startsWith('}}}', index) && stack.at(-1) === 'argument') {
      stack.pop();
      buffer += '}}}';
      index += 3;
    } else if (source.startsWith(']]', index) && stack.at(-1) === 'link') {
      stack.pop();
      buffer += ']]';
      index += 2;
    } else if (source.startsWith('}}', index) && stack.at(-1) === 'template') {
      if (stack.length === 1) {
        flush();
        return { name: templateName, params };
      }

      stack.pop();
      buffer += '}}';
      index += 2;
    } else if (source[index] === '|' && stack.length === 1) {
      flush();
      index += 1;
    } else if (source[index] === '=' && stack.length === 1 && key === null) {
      key = buffer.trim();
      buffer = '';
      index += 1;
    } else {
      buffer += source[index];
      index += 1;
    }
  }

  return null;
}

/** Parse the first complete occurrence of a MediaWiki template. */
export function parseTemplate(wikitext: string, templateName: string): ParsedTemplate | null {
  if (!templateName.trim()) return null;

  let fromIndex = 0;
  while (fromIndex < wikitext.length) {
    const candidate = findTemplateStart(wikitext, templateName, fromIndex);
    if (!candidate) return null;

    const parsed = parseTemplateAt(wikitext, templateName.trim(), candidate.start);
    if (parsed) return parsed;

    // A malformed occurrence should not hide a later valid template.
    fromIndex = candidate.index + 2;
  }

  return null;
}
