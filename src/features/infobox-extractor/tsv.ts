export const PAGE_COLUMN = 'PAGE_NAME';

export type TsvRow = ReadonlyMap<string, string>;

/**
 * Keep every record on one TSV line without interpreting the source wikitext.
 * Formula-like prefixes remain untouched to preserve research data; the UI
 * explicitly identifies exported values as untrusted text.
 */
export function sanitiseTsvCell(value: string): string {
  return value
    .replaceAll('\0', '')
    .replaceAll('\t', ' ')
    .replace(/\r\n?|\n/g, '\\n');
}

export function serialiseTsv(columns: readonly string[], rows: readonly TsvRow[]): string {
  const lines = [columns.map(sanitiseTsvCell).join('\t')];

  for (const row of rows) {
    lines.push(
      columns
        .map((column) => sanitiseTsvCell(row.get(column) ?? ''))
        .join('\t'),
    );
  }

  return lines.join('\n');
}
