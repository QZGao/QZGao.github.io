export interface ParsedCitationField {
  key: string;
  value: string;
}

export interface ParsedCitationTemplate {
  name: string;
  fields: ParsedCitationField[];
}

export interface ParsedReference {
  name: string;
  templates: ParsedCitationTemplate[];
}

function findTopLevelCharacter(input: string, target: string): number {
  let templateDepth = 0;
  let linkDepth = 0;

  for (let index = 0; index < input.length; index += 1) {
    const pair = input.slice(index, index + 2);
    if (pair === '{{') {
      templateDepth += 1;
      index += 1;
      continue;
    }
    if (pair === '}}' && templateDepth > 0) {
      templateDepth -= 1;
      index += 1;
      continue;
    }
    if (pair === '[[') {
      linkDepth += 1;
      index += 1;
      continue;
    }
    if (pair === ']]' && linkDepth > 0) {
      linkDepth -= 1;
      index += 1;
      continue;
    }
    if (input[index] === target && templateDepth === 0 && linkDepth === 0) {
      return index;
    }
  }

  return -1;
}

function splitTopLevel(input: string, separator = '|'): string[] {
  const parts: string[] = [];
  let start = 0;
  let templateDepth = 0;
  let linkDepth = 0;

  for (let index = 0; index < input.length; index += 1) {
    const pair = input.slice(index, index + 2);
    if (pair === '{{') {
      templateDepth += 1;
      index += 1;
      continue;
    }
    if (pair === '}}' && templateDepth > 0) {
      templateDepth -= 1;
      index += 1;
      continue;
    }
    if (pair === '[[') {
      linkDepth += 1;
      index += 1;
      continue;
    }
    if (pair === ']]' && linkDepth > 0) {
      linkDepth -= 1;
      index += 1;
      continue;
    }
    if (input[index] === separator && templateDepth === 0 && linkDepth === 0) {
      parts.push(input.slice(start, index));
      start = index + 1;
    }
  }

  parts.push(input.slice(start));
  return parts;
}

function findBalancedTemplates(input: string): string[] {
  const templates: string[] = [];
  let start = -1;
  let depth = 0;

  for (let index = 0; index < input.length - 1; index += 1) {
    const pair = input.slice(index, index + 2);
    if (pair === '{{') {
      if (depth === 0) start = index;
      depth += 1;
      index += 1;
      continue;
    }
    if (pair === '}}' && depth > 0) {
      depth -= 1;
      index += 1;
      if (depth === 0 && start >= 0) {
        templates.push(input.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return templates;
}

function parseTemplate(rawTemplate: string): ParsedCitationTemplate | null {
  if (!rawTemplate.startsWith('{{') || !rawTemplate.endsWith('}}')) return null;
  const inner = rawTemplate.slice(2, -2);
  const parts = splitTopLevel(inner);
  const name = (parts.shift() ?? '').trim();
  if (!/^cite\b/i.test(name)) return null;

  let positionalIndex = 1;
  const fields = parts.map((part) => {
    const equalIndex = findTopLevelCharacter(part, '=');
    if (equalIndex < 0) {
      const field = { key: String(positionalIndex), value: part.trim() };
      positionalIndex += 1;
      return field;
    }
    return {
      key: part.slice(0, equalIndex).trim(),
      value: part.slice(equalIndex + 1).trim(),
    };
  });

  return { name, fields };
}

function collectCitationTemplates(input: string): ParsedCitationTemplate[] {
  const citations: ParsedCitationTemplate[] = [];

  for (const rawTemplate of findBalancedTemplates(input)) {
    const parsed = parseTemplate(rawTemplate);
    if (parsed) {
      citations.push(parsed);
      continue;
    }

    const nestedContent = rawTemplate.slice(2, -2);
    citations.push(...collectCitationTemplates(nestedContent));
  }

  return citations;
}

function parseRefName(attributes: string): string {
  const match = /\bname\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i.exec(attributes);
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim();
}

export function parseReferences(input: string): ParsedReference[] {
  const references: ParsedReference[] = [];
  const refPattern = /<ref\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/ref\s*>)/gi;
  let match: RegExpExecArray | null;

  while ((match = refPattern.exec(input)) !== null) {
    const content = match[2];
    if (content === undefined) continue;
    const templates = collectCitationTemplates(content);
    if (templates.length === 0) continue;
    references.push({
      name: parseRefName(match[1] ?? ''),
      templates,
    });
  }

  return references;
}

function serializeTemplate(template: ParsedCitationTemplate): string {
  const name = template.name.trim();
  if (!name) throw new Error('Every citation template needs a name.');

  const fields = template.fields
    .map(({ key, value }) => ({ key: key.trim(), value: value.trim() }))
    .filter(({ key, value }) => key !== '' || value !== '');
  const body = fields
    .map(({ key, value }) => (/^\d+$/.test(key) ? value : `${key}=${value}`))
    .join(' |');

  return body ? `{{${name} |${body}}}` : `{{${name}}}`;
}

export function serializeReference(reference: ParsedReference): string {
  const templates = reference.templates.filter((template) => template.name.trim() !== '');
  if (templates.length === 0) throw new Error('Every reference needs at least one citation template.');

  const name = reference.name.trim().replaceAll('"', '&quot;');
  const openingTag = name ? `<ref name="${name}">` : '<ref>';
  const content = templates.length === 1
    ? serializeTemplate(templates[0])
    : `{{bulleted list |${templates.map(serializeTemplate).join(' |')}}}`;
  return `${openingTag}${content}</ref>`;
}

export function serializeReferences(references: ParsedReference[]): string {
  return references.map(serializeReference).join('\n');
}
