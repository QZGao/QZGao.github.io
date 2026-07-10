import { describe, expect, it } from 'vitest';
import { parseTemplate } from '../src/features/infobox-extractor/wikitext-template-parser';

describe('parseTemplate', () => {
  it('preserves nested templates, links, and ref contents', () => {
    const parsed = parseTemplate(
      `{{Infobox scientist
| name = Ada Lovelace
| work = {{Plainlist|* Notes|* Programs}}
| known_for = [[Analytical Engine|the engine]]
| source = <ref name="note">Left|right</ref>
}}`,
      'Infobox scientist',
    );

    expect(parsed?.params).toEqual(
      new Map([
        ['name', 'Ada Lovelace'],
        ['work', '{{Plainlist|* Notes|* Programs}}'],
        ['known_for', '[[Analytical Engine|the engine]]'],
        ['source', '<ref name="note">Left|right</ref>'],
      ]),
    );
  });

  it('retains blank named and positional parameters', () => {
    const parsed = parseTemplate(
      '{{Infobox person|name=Ada|occupation=|alpha||omega}}',
      'Infobox person',
    );

    expect(parsed?.params).toEqual(
      new Map([
        ['name', 'Ada'],
        ['occupation', ''],
        ['1', 'alpha'],
        ['2', ''],
        ['3', 'omega'],
      ]),
    );
  });

  it('matches names with regex characters and MediaWiki name normalisation', () => {
    const parsed = parseTemplate(
      '{{ Template:Infobox_C++ | language = C++ }}',
      'Infobox C++',
    );

    expect(parsed?.params.get('language')).toBe('C++');
  });

  it('ignores template-like text in comments and protected tags', () => {
    const parsed = parseTemplate(
      '<!-- {{Infobox person|name=Comment}} --><nowiki>{{Infobox person|name=Example}}</nowiki>{{Infobox person|name=Real}}',
      'Infobox person',
    );

    expect(parsed?.params.get('name')).toBe('Real');
  });

  it('continues after an unclosed occurrence', () => {
    const parsed = parseTemplate(
      '{{Infobox person|name=Broken\n{{Infobox person|name=Complete}}',
      'Infobox person',
    );

    expect(parsed?.params.get('name')).toBe('Complete');
  });

  it('returns an empty map for a parameterless template', () => {
    expect(parseTemplate('{{Infobox person}}', 'Infobox person')?.params.size).toBe(0);
  });
});
