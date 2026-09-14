type Language = 'zh-Hant' | 'zh-Hans' | 'yue-Hant' | 'yue-Hans' | 'en';

type Rule = {
  id: number;
  name?: Record<Language, string>;
  names?: Record<Language, string>;
  note?: Record<Language, string>;
  notes?: Record<Language, string>;
  positive?: string[];
  negative?: string[];
  weight: number;
  negative_weight: number;
  saturation_frequency: number;
  method?: string;
  density?: { lexicon?: Array<{ patterns: string[]; weight: number }> };
};

type RulesFile = { scoring: { minimum_characters: number; frequency_unit: number; evidence_scale: number }; rules: Rule[] };
type Highlight = { start: number; end: number; level: 1 | 2 | 3; reasons: string[] };

const UI: Record<Language, Record<string, string>> = {
  'zh-Hant': {
    analyze: '分析文字', input: '貼上中文文字', score: 'AI 寫作風格跡象',
    low: '低', medium: '中', high: '高', characters: '非空白字元',
    language: '介面語言', clear: '清除', empty: '請先貼上文字。',
    caveat: '（聲明：這個分數只說明文字有 AI 寫作風格跡象，不代表就一定是 AI 寫的，也有可能是被 AI 寫作風格影響的人類寫出來的。）',
    evidence: '主要證據', breakdown: '全文', noEvidence: '目前沒有明顯規則命中。',
  },
  'zh-Hans': {
    analyze: '分析文字', input: '贴上中文文字', score: 'AI 写作风格迹象',
    low: '低', medium: '中', high: '高', characters: '非空白字元',
    language: '界面语言', clear: '清除', empty: '请先贴上文字。',
    caveat: '（声明：这个分数只说明文字有 AI 写作风格迹象，不代表就一定是 AI 写的，也有可能是被 AI 写作风格影响的人类写出来的。）',
    evidence: '主要证据', breakdown: '全文', noEvidence: '目前没有明显规则命中。',
  },
  'yue-Hant': {
    analyze: '分析文字', input: '貼上中文文字', score: 'AI 寫作風格痕跡',
    low: '低', medium: '中', high: '高', characters: '非空白字元',
    language: '介面語言', clear: '清除', empty: '請先貼文字。',
    caveat: '（聲明：呢個分數只系講文字有 AI 寫作風格痕跡，唔代表就一定系 AI 寫嘅，都有可能系被 AI 寫作風格影響嘅人類寫出嚟嘅。）',
    evidence: '主要證據', breakdown: '全文', noEvidence: '暫時冇明顯規則命中。',
  },
  'yue-Hans': {
    analyze: '分析文字', input: '贴上中文文字', score: 'AI 写作风格痕迹',
    low: '低', medium: '中', high: '高', characters: '非空白字元',
    language: '界面语言', clear: '清除', empty: '请贴文字。',
    caveat: '（声明：呢个分数只系讲文字有 AI 写作风格痕迹，唔代表就一定系 AI 写嘅，都有可能系被 AI 写作风格影响嘅人类写出来嘅。）',
    evidence: '主要证据', breakdown: '全文', noEvidence: '暂时冇明显规则命中。',
  },
  en: {
    analyze: 'Analyze text', input: 'Paste Chinese text', score: 'AI writing style signal',
    low: 'Low', medium: 'Medium', high: 'High', characters: 'non-whitespace characters',
    language: 'Interface language', clear: 'Clear', empty: 'Paste some text first.',
    caveat: '(Disclaimer: This score only indicates that the text has AI writing style signals, it does not mean it was necessarily written by AI, and it could also be written by a human influenced by AI writing style.)',
    evidence: 'Main evidence', breakdown: 'Breakdown', noEvidence: 'No strong rule matches yet.',
  },
};

const PAGE_COPY: Record<Language, { title: string; summary: string; documentTitle: string }> = {
  'zh-Hant': {
    title: '中文 AI slop 偵測',
    summary: '使用正規表示式比對，檢查中文文字中反覆出現的 AI 寫作風格訊號。此工具不適用於議論文體，或其他邏輯性較強的文章。',
    documentTitle: '中文 AI slop 偵測 | SuperGrey',
  },
  'zh-Hans': {
    title: '中文 AI slop 检测',
    summary: '使用正则表达式匹配，检查中文文字中反复出现的 AI 写作风格信号。此工具不适用于议论文体，或其他逻辑性较强的文章。',
    documentTitle: '中文 AI slop 检测 | SuperGrey',
  },
  'yue-Hant': {
    title: '中文 AI slop 偵測',
    summary: '用正則表達式配對，檢查中文文字入面反覆出現嘅 AI 寫作風格訊號。呢個工具唔適用於議論文體，或者其他邏輯性較強嘅文章。',
    documentTitle: '中文 AI slop 偵測 | SuperGrey',
  },
  'yue-Hans': {
    title: '中文 AI slop 检测',
    summary: '用正则表达式配对，检查中文文字入面反复出现嘅 AI 写作风格信号。呢个工具唔适用于议论文体，或者其他逻辑性较强嘅文章。',
    documentTitle: '中文 AI slop 检测 | SuperGrey',
  },
  en: {
    title: 'Chinese AI slop detector',
    summary: 'Rule-based regex matching for recurring Chinese AI-writing style signals. This tool is not suitable for argumentative writing or other highly logical articles.',
    documentTitle: 'Chinese AI slop detector | SuperGrey',
  },
};

const languages: Array<[Language, string]> = [
  ['zh-Hant', '官話繁體中文'], ['zh-Hans', '官话简体中文'],
  ['yue-Hant', '粵語繁體中文'], ['yue-Hans', '粤语简体中文'], ['en', 'English'],
];

function detectLanguage(): Language {
  const values = navigator.languages?.length ? navigator.languages : [navigator.language];
  const first = values[0]?.toLowerCase() ?? '';
  if (first.startsWith('yue')) return first.includes('hans') || first.includes('cn') ? 'yue-Hans' : 'yue-Hant';
  if (!first.startsWith('zh')) return 'en';
  return /tw|hk|mo|hant/.test(first) ? 'zh-Hant' : 'zh-Hans';
}

function compile(pattern: string): RegExp | null {
  try { return new RegExp(pattern, 'gmu'); } catch { return null; }
}

function spans(patterns: RegExp[], text: string): Array<[number, number]> {
  const found: Array<[number, number]> = [];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      if (match[0].length) found.push([match.index, match.index + match[0].length]);
      if (match[0].length === 0) pattern.lastIndex += 1;
    }
  }
  return found.sort((a, b) => a[0] - b[0]);
}

function merge(items: Array<[number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const item of items) {
    const previous = out[out.length - 1];
    if (previous && item[0] < previous[1]) previous[1] = Math.max(previous[1], item[1]);
    else out.push([...item]);
  }
  return out;
}

function windows(text: string, target = 6000, minimum = 4500): string[] {
  const paragraphs = text.split(/\n\s*\n/).filter(Boolean);
  if (text.replace(/\s/g, '').length <= target) return [text];
  const result: string[] = [];
  for (let i = 0; i < paragraphs.length; i += 1) {
    let length = 0;
    for (let j = i; j < paragraphs.length && length < target; j += 1) length += paragraphs[j].replace(/\s/g, '').length;
    const candidate = paragraphs.slice(i, Math.min(paragraphs.length, i + 20)).join('\n\n');
    const count = candidate.replace(/\s/g, '').length;
    if (count >= minimum) result.push(candidate);
  }
  return result.length ? result : [text];
}

function levelWeight(rule: Rule, ratio: number, count: number): number {
  const base = rule.weight;
  const levels = (rule as Rule & { weight_levels?: Array<{ weight: number; start_ratio: number; full_ratio: number; count_prior: number }> }).weight_levels ?? [];
  let value = base;
  let previous = base;
  for (const level of levels) {
    const x = Math.max(0, Math.min(1, (ratio - level.start_ratio) / (level.full_ratio - level.start_ratio)));
    const smooth = x * x * (3 - 2 * x) * count / (count + level.count_prior);
    value += (level.weight - previous) * smooth;
    previous = level.weight;
  }
  return value;
}

function highlightLevel(rule: Rule, ratio: number): 1 | 2 | 3 {
  const levels = (rule as Rule & { weight_levels?: Array<{ start_ratio: number; full_ratio: number }> }).weight_levels ?? [];
  if (levels[1] && ratio >= levels[1].start_ratio) return 3;
  if (levels[0] && ratio >= levels[0].start_ratio) return 2;
  return 1;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

function mergeHighlights(highlights: Highlight[]): Highlight[] {
  const merged: Highlight[] = [];
  for (const highlight of highlights.sort((a, b) => a.start - b.start || a.end - b.end)) {
    const previous = merged[merged.length - 1];
    if (previous && highlight.start < previous.end) {
      previous.end = Math.max(previous.end, highlight.end);
      previous.level = Math.max(previous.level, highlight.level) as 1 | 2 | 3;
      previous.reasons = [...new Set([...previous.reasons, ...highlight.reasons])];
    } else {
      merged.push({ ...highlight, reasons: [...new Set(highlight.reasons)] });
    }
  }
  return merged;
}

function collectHighlights(text: string, rules: RulesFile, language: Language): Highlight[] {
  const marks: Highlight[] = [];
  for (const rule of rules.rules) {
    const patterns = (rule.positive ?? []).map(compile).filter((x): x is RegExp => !!x);
    let matches = spans(patterns, text);
    if (rule.method === 'logic_surge' && rule.density?.lexicon) {
      const logical = rule.density.lexicon.flatMap((entry) => entry.patterns.map(compile)).filter((x): x is RegExp => !!x);
      matches = merge([...matches, ...spans(logical, text)]);
    }
    if (!matches.length) continue;
    const denominator = Math.max(text.replace(/\s/g, '').length, rules.scoring.minimum_characters);
    const ratio = (matches.length * rules.scoring.frequency_unit / denominator) / rule.saturation_frequency;
    const level = highlightLevel(rule, ratio);
    const reason = rule.names?.[language] ?? rule.name?.en ?? `Rule ${rule.id}`;
    for (const [start, end] of matches) marks.push({ start, end, level, reasons: [reason] });
    for (const [start, end] of matches) marks.push({ start, end, level, reasons: [reason] });
  }
  return mergeHighlights(marks);
}

function renderBreakdown(text: string, highlights: Highlight[]): string {
  if (!highlights.length) return escapeHtml(text);
  const parts: string[] = [];
  let cursor = 0;
  for (const mark of highlights) {
    if (mark.start > cursor) parts.push(escapeHtml(text.slice(cursor, mark.start)));
    const tooltip = escapeHtml(mark.reasons.join('\n'));
    parts.push(`<span class="detector__mark detector__mark--${mark.level}" tabindex="0" data-tooltip="${tooltip}">${escapeHtml(text.slice(mark.start, mark.end))}</span>`);
    cursor = mark.end;
  }
  if (cursor < text.length) parts.push(escapeHtml(text.slice(cursor)));
  return parts.join('');
}

function analyzeWindow(text: string, rules: RulesFile, language: Language): { score: number; hits: Array<{ name: string; note: string; count: number }> } {
  const denominator = Math.max(text.replace(/\s/g, '').length, rules.scoring.minimum_characters);
  const multiplier = rules.scoring.frequency_unit / denominator;
  let evidence = 0;
  const hits: Array<{ name: string; note: string; count: number }> = [];
  for (const rule of rules.rules) {
    const positive = (rule.positive ?? []).map(compile).filter((x): x is RegExp => !!x);
    const negative = (rule.negative ?? []).map(compile).filter((x): x is RegExp => !!x);
    let positiveCount = merge(spans(positive, text)).length;
    const negativeCount = merge(spans(negative, text)).length;
    if (rule.method === 'logic_surge' && rule.density?.lexicon) {
      const logical = rule.density.lexicon.flatMap((entry) => entry.patterns.map(compile)).filter((x): x is RegExp => !!x);
      const sentences = text.split(/(?<=[。！？!?])\s*/).filter(Boolean);
      positiveCount = sentences.reduce((total, sentence) => total + Math.min(3, merge(spans(logical, sentence)).length), 0);
    }
    if (!positiveCount && !negativeCount) continue;
    const net = Math.max(0, (positiveCount - rule.negative_weight * negativeCount) * multiplier);
    const ratio = net / rule.saturation_frequency;
    const applied = levelWeight(rule, ratio, positiveCount);
    const contribution = applied * ratio / (1 + ratio);
    evidence += contribution;
    hits.push({
      name: rule.names?.[language] ?? rule.name?.en ?? `Rule ${rule.id}`,
      note: rule.notes?.[language] ?? rule.note?.en ?? '',
      count: positiveCount,
    });
  }
  return { score: 100 * (1 - Math.exp(-evidence / rules.scoring.evidence_scale)), hits: hits.sort((a, b) => b.count - a.count).slice(0, 6) };
}

export function initAiSlopDetector(root: HTMLElement): () => void {
  const input = root.querySelector<HTMLTextAreaElement>('[data-role="input"]');
  const button = root.querySelector<HTMLButtonElement>('[data-action="analyze"]');
  const clear = root.querySelector<HTMLButtonElement>('[data-action="clear"]');
  const output = root.querySelector<HTMLElement>('[data-role="output"]');
  const score = root.querySelector<HTMLElement>('[data-role="score"]');
  const scoreLabel = root.querySelector<HTMLElement>('[data-role="score-label"]');
  const inputLabel = root.querySelector<HTMLElement>('[data-role="input-label"]');
  const evidenceHeading = root.querySelector<HTMLElement>('[data-role="evidence-heading"]');
  const breakdownHeading = root.querySelector<HTMLElement>('[data-role="breakdown-heading"]');
  const breakdown = root.querySelector<HTMLElement>('[data-role="breakdown"]');
  const caveat = root.querySelector<HTMLElement>('[data-role="caveat"]');
  const pageTitle = document.querySelector<HTMLElement>('[data-project-title="ai-slop-detector"]');
  const pageSummary = document.querySelector<HTMLElement>('[data-project-summary="ai-slop-detector"]');
  const languageSelect = root.querySelector<HTMLSelectElement>('[data-role="language"]');
  if (!input || !button || !clear || !output || !score || !scoreLabel || !inputLabel || !evidenceHeading || !breakdownHeading || !breakdown || !caveat || !languageSelect || !pageTitle || !pageSummary) throw new Error('AI slop detector is missing a required element.');
  const inputEl = input;
  const buttonEl = button;
  const clearEl = clear;
  const outputEl = output;
  const scoreEl = score;
  const scoreLabelEl = scoreLabel;
  const inputLabelEl = inputLabel;
  const evidenceHeadingEl = evidenceHeading;
  const breakdownHeadingEl = breakdownHeading;
  const breakdownEl = breakdown;
  const caveatEl = caveat;
  const pageTitleEl = pageTitle;
  const pageSummaryEl = pageSummary;
  const languageSelectEl = languageSelect;
  const tooltip = document.createElement('div');
  tooltip.id = 'detector-tooltip';
  tooltip.className = 'detector__tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.setAttribute('aria-hidden', 'true');
  tooltip.hidden = true;
  document.body.appendChild(tooltip);

  let rules: RulesFile | null = null;
  let language = (localStorage.getItem('qzgao-detector-language') as Language | null) ?? detectLanguage();
  languageSelectEl.innerHTML = languages.map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
  languageSelectEl.value = language;

  function renderLanguage(): void {
    const copy = UI[language];
    inputEl.placeholder = copy.input;
    inputLabelEl.textContent = copy.input;
    evidenceHeadingEl.textContent = copy.evidence;
    breakdownHeadingEl.textContent = copy.breakdown;
    caveatEl.textContent = copy.caveat;
    scoreLabelEl.textContent = copy.score;
    pageTitleEl.textContent = PAGE_COPY[language].title;
    pageSummaryEl.textContent = PAGE_COPY[language].summary;
    document.title = PAGE_COPY[language].documentTitle;
    buttonEl.textContent = copy.analyze;
    clearEl.textContent = copy.clear;
    languageSelectEl.setAttribute('aria-label', copy.language);
  }
  function render(): void {
    if (!rules) return;
    const text = inputEl.value.trim();
    if (!text) { outputEl.hidden = true; return; }
    const result = windows(text).map((window) => analyzeWindow(window, rules!, language)).sort((a, b) => b.score - a.score)[0];
    const value = Math.min(100, result.score);
    const copy = UI[language];
    const colon = language.startsWith('en') ? ': ' : '：';
    const label = value > 50 ? copy.high : value > 30 ? copy.medium : copy.low;
    const occurances = language.startsWith('en') ? 'occurrence(s)' : '次';
    scoreEl.textContent = `${value.toFixed(1)}%`;
    scoreLabelEl.textContent = `${copy.score}${colon}${label}`;
    outputEl.hidden = false;
    breakdownEl.innerHTML = renderBreakdown(text, collectHighlights(text, rules!, language));
    outputEl.querySelector<HTMLElement>('[data-role="hits"]')!.innerHTML = result.hits.length
      ? result.hits.map((hit) => `<li><strong>${escapeHtml(hit.name)}${colon}</strong>${hit.count} ${occurances}<span style="display:block"><small>${escapeHtml(hit.note)}</small></span></li>`).join('')
      : `<li>${escapeHtml(copy.noEvidence)}</li>`;
  }
  let activeMark: HTMLElement | null = null;
  function hideTooltip(): void {
    if (activeMark) activeMark.removeAttribute('aria-describedby');
    activeMark = null;
    tooltip.hidden = true;
    tooltip.setAttribute('aria-hidden', 'true');
  }
  function repositionTooltip(): void {
    if (!activeMark || tooltip.hidden) return;
    const markBox = activeMark.getBoundingClientRect();
    const tooltipBox = tooltip.getBoundingClientRect();
    const left = Math.max(8, Math.min(window.innerWidth - tooltipBox.width - 8, markBox.left));
    const above = markBox.top - tooltipBox.height - 8;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${above >= 8 ? above : Math.min(window.innerHeight - tooltipBox.height - 8, markBox.bottom + 8)}px`;
  }
  function showTooltip(mark: HTMLElement): void {
    const reason = mark.dataset.tooltip;
    if (!reason) return;
    if (activeMark && activeMark !== mark) activeMark.removeAttribute('aria-describedby');
    activeMark = mark;
    tooltip.textContent = reason;
    tooltip.hidden = false;
    tooltip.setAttribute('aria-hidden', 'false');
    mark.setAttribute('aria-describedby', tooltip.id);
    repositionTooltip();
  }
  function handlePointerOver(event: PointerEvent): void { if (event.pointerType === 'mouse') { const mark = (event.target as HTMLElement).closest<HTMLElement>('.detector__mark'); if (mark && breakdownEl.contains(mark)) showTooltip(mark); } }
  function handlePointerOut(event: PointerEvent): void { if (event.pointerType === 'mouse') { const mark = (event.target as HTMLElement).closest<HTMLElement>('.detector__mark'); const related = event.relatedTarget as Node | null; if (mark && (!related || !mark.contains(related))) hideTooltip(); } }
  function handlePointerDown(event: PointerEvent): void { const mark = (event.target as HTMLElement).closest<HTMLElement>('.detector__mark'); if (!mark || !breakdownEl.contains(mark) || event.pointerType !== 'touch') return; if (activeMark === mark && !tooltip.hidden) hideTooltip(); else showTooltip(mark); }
  function handleFocusIn(event: FocusEvent): void { const mark = (event.target as HTMLElement).closest<HTMLElement>('.detector__mark'); if (mark && breakdownEl.contains(mark)) showTooltip(mark); }
  function handleFocusOut(event: FocusEvent): void { if ((event.target as HTMLElement).closest<HTMLElement>('.detector__mark')) hideTooltip(); }
  function handleDocumentPointerDown(event: PointerEvent): void {
    const target = event.target as Node;
    if (activeMark && !activeMark.contains(target) && !tooltip.contains(target)) hideTooltip();
  }
  function handleKeyDown(event: KeyboardEvent): void { if (event.key === 'Escape') hideTooltip(); }
  void fetch('/data/detector_rules.json').then((response) => response.json()).then((value) => { rules = value; render(); });
  const onAnalyze = (): void => render();
  const onClear = (): void => { inputEl.value = ''; render(); inputEl.focus(); };
  const onLanguage = (): void => { language = languageSelectEl.value as Language; localStorage.setItem('qzgao-detector-language', language); renderLanguage(); render(); };
  buttonEl.addEventListener('click', onAnalyze); clearEl.addEventListener('click', onClear); languageSelectEl.addEventListener('change', onLanguage); renderLanguage();
  breakdownEl.addEventListener('pointerover', handlePointerOver);
  breakdownEl.addEventListener('pointerout', handlePointerOut);
  breakdownEl.addEventListener('pointerdown', handlePointerDown);
  breakdownEl.addEventListener('focusin', handleFocusIn);
  breakdownEl.addEventListener('focusout', handleFocusOut);
  document.addEventListener('pointerdown', handleDocumentPointerDown);
  document.addEventListener('keydown', handleKeyDown);
  window.addEventListener('scroll', repositionTooltip, true);
  window.addEventListener('resize', repositionTooltip);
  return () => { buttonEl.removeEventListener('click', onAnalyze); clearEl.removeEventListener('click', onClear); languageSelectEl.removeEventListener('change', onLanguage); breakdownEl.removeEventListener('pointerover', handlePointerOver); breakdownEl.removeEventListener('pointerout', handlePointerOut); breakdownEl.removeEventListener('pointerdown', handlePointerDown); breakdownEl.removeEventListener('focusin', handleFocusIn); breakdownEl.removeEventListener('focusout', handleFocusOut); document.removeEventListener('pointerdown', handleDocumentPointerDown); document.removeEventListener('keydown', handleKeyDown); window.removeEventListener('scroll', repositionTooltip, true); window.removeEventListener('resize', repositionTooltip); tooltip.remove(); };
}
