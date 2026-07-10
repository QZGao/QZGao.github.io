import { describe, expect, it } from 'vitest';
import { PAGE_COLUMN, sanitiseTsvCell, serialiseTsv } from '../src/features/infobox-extractor/tsv';

describe('TSV serialisation', () => {
  it('keeps tabs and line endings inside a single record', () => {
    const rows = [
      new Map([
        [PAGE_COLUMN, 'Alpha\tBeta'],
        ['field\tname', 'first\r\nsecond\rthird\nfourth'],
      ]),
    ];

    expect(serialiseTsv([PAGE_COLUMN, 'field\tname'], rows)).toBe(
      'PAGE_NAME\tfield name\nAlpha Beta\tfirst\\nsecond\\nthird\\nfourth',
    );
  });

  it('removes null bytes and renders missing cells as empty', () => {
    expect(sanitiseTsvCell('a\0b')).toBe('ab');
    expect(serialiseTsv([PAGE_COLUMN, 'missing'], [new Map([[PAGE_COLUMN, 'Page']])])).toBe(
      'PAGE_NAME\tmissing\nPage\t',
    );
  });

  it('preserves formula-like prefixes as raw research data', () => {
    expect(sanitiseTsvCell('=HYPERLINK("https://example.test")')).toBe(
      '=HYPERLINK("https://example.test")',
    );
    expect(sanitiseTsvCell('-12.5')).toBe('-12.5');
  });

  it('always emits the PAGE_NAME header for an empty result', () => {
    expect(serialiseTsv([PAGE_COLUMN], [])).toBe('PAGE_NAME');
  });
});
