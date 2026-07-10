import { describe, expect, it } from 'vitest';
import { parseReferences, serializeReference, serializeReferences } from '../src/features/reference-maker/wikitext';

describe('reference wikitext', () => {
  it('parses named, multiline citation templates', () => {
    const [reference] = parseReferences(`
      <ref group="note" name='sample'>
        {{cite journal
          | title = A result
          | journal = [[Journal|J. Example]]
          | doi = {{doi|10.1/example}}
        }}
      </ref>
    `);

    expect(reference.name).toBe('sample');
    expect(reference.templates[0].name).toBe('cite journal');
    expect(reference.templates[0].fields).toContainEqual({ key: 'journal', value: '[[Journal|J. Example]]' });
    expect(reference.templates[0].fields).toContainEqual({ key: 'doi', value: '{{doi|10.1/example}}' });
  });

  it('finds citations nested in a bulleted-list wrapper', () => {
    const [reference] = parseReferences('<ref>{{bulleted list |{{cite web|title=A|url=x}} |{{cite book|title=B}}}}</ref>');
    expect(reference.templates.map((template) => template.name)).toEqual(['cite web', 'cite book']);
  });

  it('keeps positional parameters', () => {
    const [reference] = parseReferences('<ref>{{cite arXiv|2501.12345|class=astro-ph}}</ref>');
    expect(reference.templates[0].fields).toEqual([
      { key: '1', value: '2501.12345' },
      { key: 'class', value: 'astro-ph' },
    ]);
  });

  it('ignores self-closing and non-citation refs', () => {
    expect(parseReferences('<ref name="again"/><ref>Plain prose</ref>')).toEqual([]);
  });

  it('serializes one or many templates without invalid empty wrappers', () => {
    expect(serializeReference({
      name: 'source',
      templates: [{ name: 'cite web', fields: [{ key: 'title', value: 'Example' }] }],
    })).toBe('<ref name="source">{{cite web |title=Example}}</ref>');

    expect(serializeReferences([{
      name: '',
      templates: [
        { name: 'cite web', fields: [{ key: 'url', value: 'https://example.com' }] },
        { name: 'cite book', fields: [{ key: 'title', value: 'Book' }] },
      ],
    }])).toContain('{{bulleted list |{{cite web');
  });

  it('rejects references with no named template', () => {
    expect(() => serializeReference({ name: '', templates: [{ name: '', fields: [] }] })).toThrow(/at least one/i);
  });
});
