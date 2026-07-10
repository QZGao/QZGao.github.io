import { Lexer, Parser, TextRenderer, parseInline } from 'marked';

// This renderer is for repository-authored content. Marked intentionally keeps
// inline HTML, which lets citations use elements such as <sup> and <sub>.
export function renderInlineMarkdown(source: string): string {
  return parseInline(source, { async: false });
}

export function inlineMarkdownToText(source: string): string {
  const tokens = Lexer.lexInline(source);
  return new Parser().parseInline(tokens, new TextRenderer()).replace(/<[^>]*>/g, '');
}
