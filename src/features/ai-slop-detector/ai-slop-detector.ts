import messages from './i18n.json';
import type { Language, RecordValue, Result } from './model';
import { nonspace } from './python-compat';
import {
  evidenceRows,
  escapeHtml,
  renderBreakdown,
  renderTooltip,
  scopeText,
  type Highlight,
} from './presentation';

const languages = Object.entries(messages).map(
  ([language, copy]) => [language as Language, copy.interface.languageOption] as const,
);

function detectLanguage(): Language {
  const values = navigator.languages?.length ? navigator.languages : [navigator.language];
  const first = values[0]?.toLowerCase() ?? '';
  if (first.startsWith('yue'))
    return first.includes('hans') || first.includes('cn') ? 'yue-Hans' : 'yue-Hant';
  if (!first.startsWith('zh')) return 'en';
  return /tw|hk|mo|hant/.test(first) ? 'zh-Hant' : 'zh-Hans';
}

export function initAiSlopDetector(root: HTMLElement): () => void {
  const required = <T extends HTMLElement>(selector: string, parent: ParentNode = root): T => {
    const element = parent.querySelector<T>(selector);
    if (!element) throw new Error(`Missing detector element: ${selector}`);
    return element;
  };
  const input = required<HTMLTextAreaElement>('[data-role="input"]');
  const button = required<HTMLButtonElement>('[data-action="analyze"]');
  const clear = required<HTMLButtonElement>('[data-action="clear"]');
  const output = required<HTMLElement>('[data-role="output"]');
  const score = required<HTMLElement>('[data-role="score"]');
  const languageSelect = required<HTMLSelectElement>('[data-role="language"]');
  const breakdown = required<HTMLElement>('[data-role="breakdown"]');
  const hits = required<HTMLElement>('[data-role="hits"]');
  const title = required<HTMLElement>('[data-project-title="ai-slop-detector"]', document);
  const summary = required<HTMLElement>('[data-project-summary="ai-slop-detector"]', document);
  const error = document.createElement('p');
  error.className = 'detector__error';
  error.setAttribute('role', 'alert');
  error.hidden = true;
  required('.detector__actions').after(error);
  const scope = document.createElement('p');
  scope.className = 'detector__scope';
  scope.hidden = true;
  required('.detector__score-line').after(scope);
  const tooltip = document.createElement('div');
  tooltip.id = 'detector-tooltip';
  tooltip.className = 'detector__tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.setAttribute('aria-hidden', 'true');
  tooltip.hidden = true;
  document.body.appendChild(tooltip);
  let language = detectLanguage();
  try {
    const saved = localStorage.getItem('qzgao-detector-language');
    if (languages.some(([value]) => value === saved)) language = saved as Language;
  } catch {
    /* Storage can be unavailable in private contexts. */
  }
  languageSelect.innerHTML = languages
    .map(([value, label]) => `<option value="${value}">${label}</option>`)
    .join('');
  languageSelect.value = language;
  let rawRules: RecordValue | undefined,
    worker: Worker | undefined,
    workerConfigured = false,
    requestId = 0,
    disposed = false,
    busy = false;
  let pendingText: string | undefined,
    lastText: string | undefined,
    activeMark: HTMLElement | null = null;
  let displayedHighlights: Highlight[] = [];
  let tooltipHideTimer: ReturnType<typeof setTimeout> | undefined;
  output.hidden = true;
  button.disabled = true;

  const setBusy = (value: boolean): void => {
    busy = value;
    root.setAttribute('aria-busy', String(value));
    button.disabled = value || !rawRules;
    button.textContent = value
      ? messages[language].interface.busy
      : messages[language].interface.analyze;
  };
  const cancelTooltipHide = (): void => {
    clearTimeout(tooltipHideTimer);
    tooltipHideTimer = undefined;
  };
  const hideTooltip = (): void => {
    cancelTooltipHide();
    activeMark?.removeAttribute('aria-describedby');
    activeMark = null;
    tooltip.hidden = true;
    tooltip.setAttribute('aria-hidden', 'true');
  };
  const scheduleTooltipHide = (): void => {
    cancelTooltipHide();
    tooltipHideTimer = setTimeout(() => {
      if (document.activeElement !== activeMark) hideTooltip();
    }, 180);
  };
  const positionTooltip = (): void => {
    if (!activeMark || tooltip.hidden) return;
    const box = activeMark.getBoundingClientRect(),
      tip = tooltip.getBoundingClientRect();
    tooltip.style.left = `${Math.max(8, Math.min(window.innerWidth - tip.width - 8, box.left))}px`;
    const above = box.top - tip.height - 8;
    tooltip.style.top = `${above >= 8 ? above : Math.max(8, Math.min(window.innerHeight - tip.height - 8, box.bottom + 8))}px`;
  };
  const showTooltip = (mark: HTMLElement): void => {
    const highlight = displayedHighlights[Number(mark.dataset.highlight)];
    if (!highlight?.reasons.length) return;
    cancelTooltipHide();
    activeMark?.removeAttribute('aria-describedby');
    activeMark = mark;
    tooltip.innerHTML = renderTooltip(highlight.reasons);
    tooltip.hidden = false;
    tooltip.setAttribute('aria-hidden', 'false');
    mark.setAttribute('aria-describedby', tooltip.id);
    positionTooltip();
  };
  const markFrom = (target: EventTarget | null): HTMLElement | null =>
    target instanceof Element ? target.closest<HTMLElement>('.detector__mark') : null;
  const stopWorker = (): void => {
    worker?.terminate();
    worker = undefined;
    workerConfigured = false;
    pendingText = undefined;
    requestId += 1;
    setBusy(false);
  };
  const renderLanguage = (): void => {
    const copy = messages[language].interface;
    input.placeholder = copy.input;
    for (const [role, key] of [
      ['input-label', 'input'],
      ['language-label', 'language'],
      ['evidence-heading', 'evidence'],
      ['breakdown-heading', 'breakdown'],
      ['caveat', 'caveat'],
      ['score-label', 'score'],
    ] as const)
      required(`[data-role="${role}"]`).textContent = copy[key];
    title.textContent = messages[language].interface.title;
    summary.textContent = messages[language].interface.summary;
    document.title = messages[language].interface.documentTitle;
    clear.textContent = copy.clear;
    languageSelect.setAttribute('aria-label', copy.language);
    setBusy(busy);
  };
  const present = (text: string, result: Result, highlights: Highlight[]): void => {
    const copy = messages[language].interface,
      colon = language === 'en' ? ': ' : '：';
    score.textContent = `${result.score.toFixed(2)}%`;
    required('[data-role="score-label"]').textContent =
      copy.score +
      colon +
      (result.score > 50 ? copy.high : result.score > 30 ? copy.medium : copy.low);
    const rows = evidenceRows(result, language);
    hits.innerHTML = rows.length
      ? rows
          .map(
            (row) =>
              `<li><span><strong>${escapeHtml(row.name)}</strong> <small>${escapeHtml(row.detail)}</small>${row.note ? `<br /><small class="detector__rule-note">${escapeHtml(row.note)}</small>` : ''}</span></li>`,
          )
          .join('')
      : `<li>${escapeHtml(copy.noEvidence)}</li>`;
    displayedHighlights = highlights;
    breakdown.innerHTML = renderBreakdown(text, highlights);
    scope.textContent = scopeText(result, language);
    scope.hidden = !scope.textContent;
    output.hidden = false;
    lastText = text;
  };
  const analyze = (text: string): void => {
    hideTooltip();
    error.hidden = true;
    if (!nonspace(text)) {
      output.hidden = true;
      error.textContent = messages[language].interface.empty;
      error.hidden = false;
      return;
    }
    if (!rawRules) return;
    if (busy) stopWorker();
    output.hidden = true;
    pendingText = text;
    setBusy(true);
    if (!worker) {
      worker = new Worker(new URL('./detector.worker.ts', import.meta.url), { type: 'module' });
      const currentWorker = worker;
      worker.onmessage = (
        event: MessageEvent<{
          id: number;
          result?: Result;
          highlights?: Highlight[];
          error?: string;
        }>,
      ): void => {
        if (disposed || event.data.id !== requestId) return;
        const text = pendingText!;
        pendingText = undefined;
        setBusy(false);
        if (event.data.error) {
          error.textContent = event.data.error;
          error.hidden = false;
          stopWorker();
          return;
        }
        present(text, event.data.result!, event.data.highlights!);
      };
      worker.onerror = (): void => {
        if (disposed || worker !== currentWorker) return;
        error.textContent = messages[language].interface.analysisError;
        error.hidden = false;
        stopWorker();
      };
    }
    requestId += 1;
    worker.postMessage({
      id: requestId,
      text,
      language,
      ...(!workerConfigured ? { rules: rawRules } : {}),
    });
    workerConfigured = true;
  };
  const onAnalyze = (): void => analyze(input.value);
  const onInput = (): void => {
    if (busy) stopWorker();
    lastText = undefined;
    output.hidden = true;
    error.hidden = true;
    hideTooltip();
  };
  const onClear = (): void => {
    input.value = '';
    onInput();
    input.focus();
  };
  const onLanguage = (): void => {
    const text = pendingText ?? lastText;
    language = languageSelect.value as Language;
    try {
      localStorage.setItem('qzgao-detector-language', language);
    } catch {
      /* Keep the current choice for this page. */
    }
    renderLanguage();
    if (text !== undefined) analyze(text);
  };
  const over = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse') {
      const mark = markFrom(event.target);
      if (mark && breakdown.contains(mark)) showTooltip(mark);
    }
  };
  const out = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse') return;
    const mark = markFrom(event.target),
      related = event.relatedTarget as Node | null;
    if (mark && (!related || (!mark.contains(related) && !tooltip.contains(related))))
      scheduleTooltipHide();
  };
  const down = (event: PointerEvent): void => {
    const mark = markFrom(event.target);
    if (event.pointerType !== 'touch' || !mark || !breakdown.contains(mark)) return;
    event.preventDefault();
    if (activeMark === mark) hideTooltip();
    else showTooltip(mark);
  };
  const focus = (event: FocusEvent): void => {
    const mark = markFrom(event.target);
    if (mark && breakdown.contains(mark)) showTooltip(mark);
  };
  const blur = (event: FocusEvent): void => {
    if (markFrom(event.target)) hideTooltip();
  };
  const outside = (event: PointerEvent): void => {
    const target = event.target as Node;
    if (activeMark && !activeMark.contains(target) && !tooltip.contains(target)) hideTooltip();
  };
  const leaveTip = (event: PointerEvent): void => {
    if (
      event.pointerType === 'mouse' &&
      (!event.relatedTarget || !activeMark?.contains(event.relatedTarget as Node))
    )
      scheduleTooltipHide();
  };
  const key = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') hideTooltip();
  };
  const listeners: Array<[EventTarget, string, EventListenerOrEventListenerObject, boolean?]> = [
    [button, 'click', onAnalyze],
    [clear, 'click', onClear],
    [input, 'input', onInput],
    [languageSelect, 'change', onLanguage],
    [breakdown, 'pointerover', over as EventListener],
    [breakdown, 'pointerout', out as EventListener],
    [breakdown, 'pointerdown', down as EventListener],
    [breakdown, 'focusin', focus as EventListener],
    [breakdown, 'focusout', blur as EventListener],
    [tooltip, 'pointerleave', leaveTip as EventListener],
    [tooltip, 'pointerenter', cancelTooltipHide],
    [document, 'pointerdown', outside as EventListener],
    [document, 'keydown', key as EventListener],
    [window, 'scroll', positionTooltip, true],
    [window, 'resize', positionTooltip],
  ];
  for (const [target, type, handler, capture] of listeners)
    target.addEventListener(type, handler, capture);
  renderLanguage();
  void fetch('/data/detector_rules.json')
    .then((response) => {
      if (!response.ok) throw new Error(String(response.status));
      return response.json();
    })
    .then((value) => {
      if (disposed) return;
      rawRules = value;
      setBusy(false);
    })
    .catch(() => {
      if (!disposed) {
        error.textContent = messages[language].interface.loadError;
        error.hidden = false;
      }
    });
  return (): void => {
    disposed = true;
    cancelTooltipHide();
    worker?.terminate();
    for (const [target, type, handler, capture] of listeners)
      target.removeEventListener(type, handler, capture);
    tooltip.remove();
    scope.remove();
    error.remove();
  };
}
