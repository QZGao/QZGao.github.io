import { describe, expect, it } from 'vitest';
import { inlineMarkdownToText, renderInlineMarkdown } from '../src/lib/inline-markdown';

describe('inline Markdown', () => {
  const citation = 'A. Author. *Journal* 1 (2026). DOI: [10.1/example](https://doi.org/10.1/example).';

  it('renders citation formatting without a block wrapper', () => {
    expect(renderInlineMarkdown(citation)).toBe(
      'A. Author. <em>Journal</em> 1 (2026). DOI: <a href="https://doi.org/10.1/example">10.1/example</a>.',
    );
  });

  it('produces plain text for document metadata', () => {
    expect(inlineMarkdownToText(citation)).toBe(
      'A. Author. Journal 1 (2026). DOI: 10.1/example.',
    );
  });

  it('keeps authored inline HTML out of document metadata', () => {
    expect(renderInlineMarkdown('H<sub>2</sub>O')).toBe('H<sub>2</sub>O');
    expect(inlineMarkdownToText('H<sub>2</sub>O')).toBe('H2O');
  });
});
