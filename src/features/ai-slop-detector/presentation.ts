import messages from './i18n.json';
import { Text } from './python-compat';
import type { Language, RecordValue as R, Result, Rules } from './model';

type WeightLevel = 1 | 2 | 3;
export type HighlightReason = {
  title: string;
  note: string;
  level: WeightLevel;
  levelLabel: string;
  metrics: Array<{ label: string; value: string }>;
  details: string[];
};
export type Highlight = {
  start: number;
  end: number;
  level: WeightLevel;
  reasons: HighlightReason[];
};
export type WindowResult = { result: Result; window: R };
function format(language: Language, key: keyof typeof messages.en.evidence, args: R): string {
  return messages[language].evidence[key].replace(/\{([^}]+)\}/g, (_, name: string) =>
    String(args[name]),
  );
}
const fixed = (value: number): string => Number(value.toFixed(4)).toString();
export function evidenceRows(
  result: Result,
  language: Language,
): Array<{ name: string; note: string; detail: string; evidence: number }> {
  const rows: Array<{
    name: string;
    note: string;
    detail: string;
    evidence: number;
  }> = [];
  for (const g of result.rules) {
    if (g.evidence <= 0) continue;
    const details = [format(language, 'matches', { count: g.positive_count })];
    if (g.positive_weighted_count !== undefined)
      details.push(
        format(language, 'weighted', {
          count: fixed(g.positive_weighted_count),
        }),
      );
    const structural = Math.max(
      g.paragraph_templates?.matched_paragraphs ?? 0,
      g.sequence_templates?.matched_paragraphs ?? 0,
    );
    if (structural) details.push(format(language, 'paragraphs', { count: structural }));
    details.push(format(language, 'evidence', { value: fixed(g.evidence) }));
    rows.push({
      name: g.name,
      note: g.note,
      detail: details.join(' · '),
      evidence: g.evidence,
    });
  }
  for (const g of result.interactions) {
    if (g.evidence <= 0) continue;
    rows.push({
      name: g.name,
      note: '',
      detail: [
        format(language, 'matches', { count: g.match_count }),
        format(language, 'evidence', { value: fixed(g.evidence) }),
      ].join(' · '),
      evidence: g.evidence,
    });
  }
  for (const g of result.additional_features) {
    if (g.evidence <= 0) continue;
    const detail =
      g.method === 'construction_repetition'
        ? format(language, 'pairs', { count: g.pair_count })
        : format(language, 'weighted', { count: fixed(g.equivalent_matches) });
    rows.push({
      name: g.name,
      note: g.note,
      detail: `${detail} · ${format(language, 'evidence', { value: fixed(g.evidence) })}`,
      evidence: g.evidence,
    });
  }
  return rows.sort((a, b) => b.evidence - a.evidence);
}

function level(config: R, ratio: number): 1 | 2 | 3 {
  const levels = config.weight_levels ?? [];
  if (levels[1] && ratio >= levels[1].start_ratio) return 3;
  if (levels[0] && ratio >= levels[0].start_ratio) return 2;
  return 1;
}
export function mergeHighlights(input: Highlight[]): Highlight[] {
  const uniqueReasons = (reasons: HighlightReason[]): HighlightReason[] => [
    ...new Map(reasons.map((reason) => [JSON.stringify(reason), reason])).values(),
  ];
  const result: Highlight[] = [];
  for (const mark of [...input].sort((a, b) => a.start - b.start || a.end - b.end)) {
    const last = result.at(-1);
    if (last && mark.start < last.end) {
      last.end = Math.max(last.end, mark.end);
      last.level = Math.max(last.level, mark.level) as WeightLevel;
      last.reasons = uniqueReasons([...last.reasons, ...mark.reasons]);
    } else result.push({ ...mark, reasons: uniqueReasons(mark.reasons) });
  }
  return result;
}

export function buildHighlights(
  windows: WindowResult[],
  selected: Result,
  config: Rules,
  language: Language,
): Highlight[] {
  const rules = new Map(config.rules.map((g) => [g.id, g]));
  const interactions = new Map(config.interactions.map((g) => [g.id, g]));
  const features = new Map((config.additional_features ?? []).map((g: R) => [g.id, g]));
  const marks: Highlight[] = [];
  const seen = new Set<string>();
  // Prefer the final scoring window, then the strongest other window containing
  // each event. All marked events come from real locally scored reports.
  const winner = (w: R): boolean =>
    w.start === selected.scoring_window.start && w.end === selected.scoring_window.end;
  const ordered = [...windows].sort(
    (a, b) =>
      Number(winner(b.window)) - Number(winner(a.window)) ||
      b.result.score - a.result.score ||
      a.window.start - b.window.start,
  );
  for (const { result } of ordered) {
    const add = (kind: string, g: R, event: R, l: 1 | 2 | 3, note = ''): void => {
      if (!(event.start < event.end)) return;
      const key = `${kind}:${g.id}:${event.start}:${event.end}`;
      if (seen.has(key)) return;
      seen.add(key);
      const labels = messages[language].tooltip;
      const reason: HighlightReason = {
        title: g.name,
        note,
        level: l,
        levelLabel: messages[language].evidence[(['base', 'one', 'two'] as const)[l - 1]],
        metrics: [{ label: labels.evidence, value: fixed(g.evidence) }],
        details: [],
      };
      if (g.effective_weight !== undefined)
        reason.metrics.push({
          label: labels.weight,
          value: fixed(g.effective_weight),
        });
      if (event.match_weight !== undefined)
        reason.metrics.push({
          label: labels.local,
          value: fixed(event.match_weight),
        });
      if (g.cadence_multiplier !== undefined)
        reason.metrics.push({
          label: labels.cadence,
          value: `×${fixed(g.cadence_multiplier)}`,
        });
      if (g.evidence_scaling?.factor !== undefined)
        reason.metrics.push({
          label: labels.scaling,
          value: `×${fixed(g.evidence_scaling.factor)}`,
        });
      const family = g.frequency_families?.find(
        (f: R) => f.id === event.local_scoring?.frequency_family,
      );
      if (family)
        reason.details.push(
          format(language, 'family', {
            name: family.name,
            count: fixed(family.weighted_count),
          }),
        );
      const context = event.local_scoring?.span_context ?? event.span_context;
      if (context)
        for (const c of context.contexts)
          reason.details.push(
            format(language, 'context', {
              name: c.names[language],
              factor: fixed(context.factor),
            }),
          );
      if (event.reporting_context) reason.details.push(messages[language].evidence.reported);
      for (const r of event.local_scoring?.refinements ?? [])
        if (r.id === 'shared_expression')
          reason.details.push(format(language, 'shared', { value: r.source_rule }));
      marks.push({
        start: event.start,
        end: event.end,
        level: l,
        reasons: [reason],
      });
    };
    for (const g of result.rules) {
      if (g.evidence <= 0) continue;
      const cfg = rules.get(g.id)!,
        l = level(cfg, g.weight_frequency_ratio),
        note = g.note;
      const events =
        g.frequency_basis === 'paragraph_strength_percent'
          ? [...(g.counted_events ?? []), ...(g.repetition_support_events ?? [])]
          : g.examples.positive;
      for (const event of events) {
        const family = g.frequency_families?.find(
          (f: R) => f.id === event.local_scoring?.frequency_family,
        );
        if (event.match_weight !== 0)
          add('rule', g, event, family ? level(cfg, family.frequency_ratio) : l, note);
      }
      if (g.paragraph_templates?.frequency > 0)
        for (const event of g.paragraph_templates.events) add('template', g, event, l, note);
      if (g.sequence_templates?.frequency > 0)
        for (const event of g.sequence_templates.events) add('sequence', g, event, l, note);
    }
    for (const g of result.interactions) {
      if (g.evidence <= 0) continue;
      const cfg = interactions.get(g.id)!.config,
        l = level(cfg.scoring, g.frequency / cfg.scoring.saturation_frequency);
      for (const event of g.events) add('interaction', g, event, l);
    }
    for (const g of result.additional_features) {
      if (g.evidence <= 0) continue;
      const cfg = features.get(g.id) as R;
      const l = cfg?.weight_levels
        ? level(cfg, g.weight_frequency_ratio ?? g.frequency / cfg.saturation_frequency)
        : 1;
      for (const event of g.events) {
        if (event.match_weight === 0) continue;
        add('feature', g, event, l, g.note);
        if (event.related_sentence) add('feature', g, event.related_sentence, l, g.note);
        for (const related of event.related_sentences ?? []) add('feature', g, related, l, g.note);
      }
    }
  }
  return mergeHighlights(marks);
}

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
export function renderBreakdown(value: string, marks: Highlight[]): string {
  const text = new Text(value),
    parts: string[] = [];
  let cursor = 0;
  for (const [index, mark] of marks.entries()) {
    if (mark.start > cursor) parts.push(escapeHtml(text.slice(cursor, mark.start)));
    parts.push(
      `<span class="detector__mark detector__mark--${mark.level}" tabindex="0" data-highlight="${index}">${escapeHtml(text.slice(mark.start, mark.end))}</span>`,
    );
    cursor = mark.end;
  }
  if (cursor < text.length) parts.push(escapeHtml(text.slice(cursor)));
  return parts.join('');
}

/** Render structured evidence with escaped text, never user-supplied markup. */
export function renderTooltip(reasons: HighlightReason[]): string {
  return reasons
    .map(
      (reason) => `
    <section class="detector__tooltip-rule">
      <div class="detector__tooltip-heading">
        <strong class="detector__tooltip-title">${escapeHtml(reason.title)}</strong>
        <span class="detector__tooltip-level detector__tooltip-level--${reason.level}">${escapeHtml(reason.levelLabel)}</span>
      </div>
      ${reason.note ? `<p class="detector__tooltip-note">${escapeHtml(reason.note)}</p>` : ''}
      ${reason.metrics.length ? `<dl class="detector__tooltip-metrics">${reason.metrics.map((metric) => `<div><dt>${escapeHtml(metric.label)}</dt><dd>${escapeHtml(metric.value)}</dd></div>`).join('')}</dl>` : ''}
      ${reason.details.map((detail) => `<p class="detector__tooltip-detail">${escapeHtml(detail)}</p>`).join('')}
    </section>`,
    )
    .join('');
}
