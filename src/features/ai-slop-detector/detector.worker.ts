import { loadRules, type Language, type Rules } from './engine';
import { analyzeDocument } from './analysis';
import type { RecordValue } from './model';

let config: Rules | undefined;
self.onmessage = (
  event: MessageEvent<{ id: number; text: string; language: Language; rules?: RecordValue }>,
): void => {
  const { id, text, language, rules } = event.data;
  try {
    if (rules) config = loadRules(rules, language);
    if (!config) throw new Error('Missing detector rules');
    self.postMessage({ id, ...analyzeDocument(text, config, language) });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
