import { detect } from './engine';
import { buildHighlights, type WindowResult } from './presentation';
import type { Language, Rules } from './model';

/** Keep the Python result intact; derive the UI overlay from scored windows. */
export function analyzeDocument(text: string, config: Rules, language: Language) {
  const windows: WindowResult[] = [];
  const result = detect(text, config, Array.from(text).length + 1, language, (result, window) =>
    windows.push({ result, window }),
  );
  return { result, highlights: buildHighlights(windows, result, config, language) };
}
