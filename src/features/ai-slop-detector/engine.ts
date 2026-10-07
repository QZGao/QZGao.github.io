/** A direct port of the Python detector. Public offsets are Unicode code points. */
import {
  Pattern,
  Text,
  bisectLeft,
  bisectRight,
  close,
  fsum,
  isSpace,
  mean,
  nonspace,
  round,
  spanKey,
  spanSort,
  sum,
  type Span,
} from './python-compat';
import { language as resolveLanguage, message, detectorMessages, cumulativeMethods } from './rules';
import type { Language, RecordValue as R, Result, Rules } from './model';
export { loadRules } from './rules';
export type { Language, Result, Rules } from './model';

type Primitive = Map<number, { positive: Span[]; negative: Span[] }>;
type Weights = Map<number, Map<string, number>>;
type Details = Map<number, Map<string, R>>;
const overlap = (a: Span, b: Span): boolean => a[0] < b[1] && a[1] > b[0];
const slice = <T>(values: T[], count: number): T[] => values.slice(0, count);
const maxFirst = <T>(values: T[], value: (x: T) => number): T | undefined => {
  let best: T | undefined;
  for (const item of values) if (best === undefined || value(item) > value(best)) best = item;
  return best;
};
const spanValues = (value: Map<string, number>): number[] => [...value.values()];

export function matchSpans(patterns: Pattern[], text: Text, excluded: Span[] = []): Span[] {
  const found = new Map<string, Span>();
  for (const pattern of patterns)
    for (const m of pattern.finditer(text)) {
      const span = m.span();
      if (m.end > m.start && !excluded.some((x) => overlap(x, span)))
        found.set(spanKey(span), span);
    }
  const merged: Span[] = [];
  for (const [a, b] of [...found.values()].sort(spanSort)) {
    const last = merged.at(-1);
    if (last && a < last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return merged;
}

export function splitSpans(text: Text, start: number, end: number, separator: Pattern): Span[] {
  const spans: Span[] = [];
  let cursor = start;
  for (const m of separator.finditer(text, start, end)) {
    if (m.start === m.end) continue;
    spans.push([cursor, m.start]);
    cursor = m.end;
  }
  spans.push([cursor, end]);
  return spans.flatMap(([left, right]) => {
    while (left < right && isSpace(text.chars[left])) left += 1;
    while (right > left && isSpace(text.chars[right - 1])) right -= 1;
    return left < right ? [[left, right] as Span] : [];
  });
}

const SENTENCE_BOUNDARY = new Pattern(
  '[。！？!?]+[”’」\u300f"]*|(?<!\\d)\\.(?!\\d)[”’"]*(?=\\s|$)|\\r?\\n+',
);
export function sentenceContexts(text: Text): Span[] {
  const spans: Span[] = [];
  let cursor = 0;
  for (const m of SENTENCE_BOUNDARY.finditer(text)) {
    const end = m.group().includes('\n') ? m.start : m.end;
    let start = cursor;
    while (start < end && isSpace(text.chars[start])) start += 1;
    if (start < end) spans.push([start, end]);
    cursor = m.end;
  }
  while (cursor < text.length && isSpace(text.chars[cursor])) cursor += 1;
  if (cursor < text.length) spans.push([cursor, text.length]);
  return spans;
}
function example(
  text: Text,
  start: number,
  end: number,
  sentences: Span[],
  starts = sentences.map((s) => s[0]),
  ends = sentences.map((s) => s[1]),
): R {
  const first = bisectRight(ends, start);
  const last = bisectLeft(starts, end) - 1;
  let left = start;
  let right = end;
  if (first <= last && first < sentences.length) {
    left = Math.min(start, sentences[first][0]);
    right = Math.max(end, sentences[last][1]);
  }
  return {
    start,
    end,
    text: text.slice(start, end),
    sentence: { start: left, end: right, text: text.slice(left, right) },
  };
}

function anchoredMatches(text: Text, group: R, excluded: Span[]): [Span[], Map<string, R>] {
  const candidates = new Map<string, number[]>();
  for (const p of group._anchor_patterns as Pattern[])
    for (const m of p.finditer(text)) {
      const [a, b] = m.span('anchor');
      const [left, right] = m.span('_event');
      const region: Span = group.match_units.exclusion_target === 'anchor' ? [a, b] : [left, right];
      if (a < 0 || a === b || excluded.some((x) => overlap(x, region))) continue;
      candidates.set([a, b, left, right].join(','), [a, b, left, right]);
    }
  const events: R[] = [];
  for (const [a, b, left, right] of [...candidates.values()].sort(tupleSort)) {
    const last = events.at(-1);
    if (last && a < last.anchor.end) {
      last.anchor.end = Math.max(last.anchor.end, b);
      last.extent.start = Math.min(last.extent.start, left);
      last.extent.end = Math.max(last.extent.end, right);
    } else
      events.push({
        anchor: { start: a, end: b },
        extent: { start: left, end: right },
      });
  }
  const spans: Span[] = [];
  const details = new Map<string, R>();
  events.forEach((event, i) => {
    const a = event.anchor.start;
    let b = event.extent.end;
    if (i + 1 < events.length) b = Math.min(b, events[i + 1].anchor.start);
    while (b > event.anchor.end && '，,；;：: \t\r\n'.includes(text.chars[b - 1])) b -= 1;
    spans.push([a, b]);
    details.set(spanKey([a, b]), event);
  });
  return [spans, details];
}
function tupleSort(a: any[], b: any[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    if (a[i] === b[i]) continue;
    return a[i] < b[i] ? -1 : 1;
  }
  return a.length - b.length;
}

function closingMatches(
  text: Text,
  group: R,
  original: Span[],
  edges: R,
  excluded: Span[],
): [Span[], Map<string, R>] {
  const c = group.closing_candidates;
  const candidates: Span[] = [];
  for (const [pa, pb] of splitSpans(text, 0, text.length, c._paragraph_separator)) {
    if (edges.end_paragraph && pb === text.length) continue;
    const sentences = splitSpans(text, pa, pb, c._sentence_separator);
    if (!sentences.length) continue;
    const [a, b] = sentences.at(-1)!;
    for (const [ca, cb] of splitSpans(text, a, b, c._clause_separator)) {
      const matches = matchSpans(c._patterns, new Text(text.slice(ca, cb)));
      if (
        matches.some(
          ([x, y]) =>
            nonspace(text.slice(ca + x, ca + y)) <= c.max_characters &&
            !excluded.some((s) => overlap(s, [ca + x, ca + y])),
        )
      ) {
        candidates.push([a, b]);
        break;
      }
    }
  }
  const count = candidates.length;
  const repeats = Math.max(0, count - 1);
  const reliability = repeats / (repeats + c.repeat_prior);
  const factor = c.candidate_factor + (c.full_factor - c.candidate_factor) * reliability;
  const kept = original.filter((s) => !candidates.some((t) => overlap(s, t)));
  const details = new Map<string, R>();
  kept.forEach((s) => details.set(spanKey(s), { subtype: 'ordinary', factor: c.ordinary_factor }));
  candidates.forEach((s) =>
    details.set(spanKey(s), {
      subtype: 'repeated_closing',
      factor,
      matched_paragraphs: count,
      repeat_reliability: reliability,
    }),
  );
  return [[...kept, ...candidates].sort(spanSort), details];
}

function localScoring(
  text: Text,
  group: R,
  spans: Span[],
  weights: Map<string, number>,
): Map<string, R> {
  const cfg = group.local_scoring;
  const details = new Map<string, R>();
  if (cfg.method === 'candidate_negative_subtypes') {
    for (const [index, [a, b]] of spans.entries()) {
      const key = spanKey([a, b]);
      let left = a,
        right = b;
      if (cfg.context) {
        const c = cfg.context,
          prefix = new Text(c.previous_prefix);
        if (a >= prefix.length && text.slice(a - prefix.length, a) === prefix.value)
          left -= prefix.length;
        right = c._separator.search(text, a)?.start ?? text.length;
        if (index + 1 < spans.length) right = Math.min(right, spans[index + 1][0]);
        right = Math.min(right, a + c.maximum_characters);
        const scaling = group.match_scaling;
        const weak =
          scaling &&
          scaling._patterns.some((p: Pattern) => p.search(text.slice(a, right))) &&
          !scaling._unless_patterns.some((p: Pattern) => p.search(text.slice(left, right)));
        if (scaling && !group.closing_candidates) weights.set(key, weak ? scaling.factor : 1);
      }
      const subtype =
        weights.get(key)! < 1
          ? 'cognitive'
          : (['contrast', 'scalar', 'qualification'].find((k) =>
              cfg._subtypes[k].some((p: Pattern) => p.search(text.slice(left, right))),
            ) ?? 'other');
      const factor = cfg.factors[subtype];
      weights.set(key, weights.get(key)! * factor);
      details.set(key, { subtype, factor });
      if (cfg.context)
        Object.assign(details.get(key)!, {
          context_start: left,
          context_end: right,
        });
    }
    if (group.fallback_strength) {
      const anchors = (group._primary_anchor_patterns as Pattern[]).flatMap((p) =>
        [...p.finditer(text)].map((m) => m.span('anchor')[0]),
      );
      for (const [a, b] of spans)
        if (!anchors.some((anchor) => a <= anchor && anchor < b)) {
          const key = spanKey([a, b]);
          weights.set(key, weights.get(key)! * group.fallback_strength.factor);
          details.get(key)!.fallback_factor = group.fallback_strength.factor;
        }
    }
    return details;
  }
  const clauses = splitSpans(text, 0, text.length, cfg._separator);
  const starts = clauses.map((s) => s[0]);
  const ends = clauses.map((s) => s[1]);
  const indices = (a: number, b: number): number[] =>
    Array.from(
      { length: Math.max(0, bisectLeft(starts, b) - bisectRight(ends, a)) },
      (_, i) => i + bisectRight(ends, a),
    );
  if (['clause_families', 'fixed_families'].includes(cfg.method)) {
    const assignments = new Map<string, [string, boolean]>();
    const families = new Map<number, Set<string>>();
    for (const [a, b] of spans) {
      const fragment = text.slice(a, b);
      const family = cfg.families.find((f: R) =>
        f._patterns.some((p: Pattern) =>
          f.match === 'search' ? !!p.search(fragment) : p.fullmatch(fragment),
        ),
      );
      const name = family?.id ?? cfg.default_family;
      assignments.set(spanKey([a, b]), [name, !!family?.scale]);
      for (const i of indices(a, b)) {
        if (!families.has(i)) families.set(i, new Set());
        families.get(i)!.add(name);
      }
    }
    for (const [a, b] of spans) {
      const key = spanKey([a, b]);
      const [name, scale] = assignments.get(key)!;
      const neighbors = Math.max(0, ...indices(a, b).map((i) => (families.get(i)?.size ?? 0) - 1));
      let factor = scale
        ? cfg.base_factor +
          ((1 - cfg.base_factor) * neighbors) / (neighbors + cfg.cooccurrence_prior)
        : 1;
      if (scale && cfg.method === 'fixed_families') factor = cfg.base_factor;
      weights.set(key, weights.get(key)! * factor);
      details.set(key, {
        subtype: name,
        other_clause_families: neighbors,
        factor,
      });
    }
  } else {
    const stacked = matchSpans(group._positive_subtypes[cfg.target_subtype], text);
    const other = matchSpans(
      Object.entries(group._positive_subtypes)
        .filter(([k]) => k !== cfg.target_subtype)
        .flatMap(([, v]) => v as Pattern[]),
      text,
    );
    for (const span of spans) {
      const [a, b] = span;
      if (!stacked.some((s) => overlap(s, span)) || other.some((s) => overlap(s, span))) continue;
      const peak = Math.max(
        0,
        ...indices(a, b).map(
          (i) =>
            matchSpans(
              cfg._patterns,
              new Text(text.slice(Math.max(a, clauses[i][0]), Math.min(b, clauses[i][1]))),
            ).length,
        ),
      );
      const factor = (peak / (peak + cfg.hit_prior)) ** cfg.hit_power;
      const key = spanKey(span);
      weights.set(key, weights.get(key)! * factor);
      details.set(key, {
        subtype: cfg.target_subtype,
        peak_clause_hits: peak,
        factor,
      });
    }
  }
  return details;
}

function refinements(
  text: Text,
  config: Rules,
  primitive: Primitive,
  weights: Weights,
  local: Details,
  eventDetails: Details,
  sentences: Span[],
): void {
  const paragraphs = splitSpans(text, 0, text.length, config.windowing._paragraph_separator);
  for (const group of config.rules) {
    const gid = group.id;
    const values = primitive.get(gid);
    if (!values) continue;
    const profiles = group.match_refinements ?? [];
    const discount = group.shared_expression;
    if (!profiles.length && !discount) continue;
    for (const [a, b] of values.positive) {
      const key = spanKey([a, b]);
      const fragment = text.slice(a, b);
      const applied: R[] = [];
      const ws = weights.get(gid)!;
      for (const profile of profiles) {
        if (
          !profile._patterns.some((p: Pattern) => p.search(fragment)) ||
          profile._unless_patterns.some((p: Pattern) => p.search(fragment))
        )
          continue;
        if (profile._context_patterns.length || profile._unless_context_patterns.length) {
          const context = example(
            text,
            a,
            b,
            profile.context_scope === 'paragraph' ? paragraphs : sentences,
          ).sentence.text;
          if (
            profile._context_patterns.length &&
            !profile._context_patterns.some((p: Pattern) => p.search(context))
          )
            continue;
          if (profile._unless_context_patterns.some((p: Pattern) => p.search(context))) continue;
        }
        const before = ws.get(key)!;
        ws.set(key, Math.min(before, profile.weight));
        applied.push({ id: profile.id, before, after: ws.get(key) });
      }
      if (discount) {
        const shared = [...(eventDetails.get(discount.source_rule)?.values() ?? [])]
          .map((e) => e.anchor)
          .filter((e) => e.start < b && e.end > a && Math.abs(e.start - a) <= 2);
        if (shared.length) {
          const before = ws.get(key)!;
          ws.set(key, before * discount.weight);
          applied.push({
            id: 'shared_expression',
            source_rule: discount.source_rule,
            before,
            after: ws.get(key),
            anchors: shared,
          });
        }
      }
      if (applied.length) {
        if (!local.has(gid)) local.set(gid, new Map());
        const d = local.get(gid)!;
        if (!d.has(key)) d.set(key, {});
        d.get(key)!.refinements = applied;
      }
    }
  }
}

function logicSurges(text: Text, group: R, edges: R): R {
  const cfg = group.density;
  const paragraphs: R[] = [];
  for (const [pa, pb] of splitSpans(text, 0, text.length, cfg._paragraph_separator)) {
    if (
      !cfg._sentence_separator.search(text, pa, pb) &&
      !cfg._clause_separator.search(text, pa, pb)
    )
      continue;
    const weights = Array<number>(pb - pa).fill(0);
    const terms = new Map<string, R>();
    for (const entry of cfg.lexicon)
      for (const p of entry._patterns as Pattern[])
        for (const m of p.finditer(text, pa, pb)) {
          const [a, b] = m.span();
          if (a === b) continue;
          for (let pos = a; pos < b; pos += 1)
            if (!isSpace(text.chars[pos]))
              weights[pos - pa] = Math.max(weights[pos - pa], entry.weight);
          const key = spanKey([a, b]);
          if (!terms.has(key) || terms.get(key)!.weight < entry.weight)
            terms.set(key, {
              start: a,
              end: b,
              text: text.slice(a, b),
              weight: entry.weight,
              category: entry.id,
            });
        }
    const rawWeights = [...weights];
    const attributed = new Set<number>();
    const attribution = cfg.attribution;
    if (attribution) {
      for (const p of attribution._patterns as Pattern[])
        for (const m of p.finditer(text, pa, pb)) {
          const [a, b] = m.span('cue');
          if (pa <= a && a < b && b <= pb) for (let pos = a; pos < b; pos += 1) attributed.add(pos);
        }
      for (const pos of attributed) weights[pos - pa] *= attribution.factor;
      for (const term of terms.values()) {
        let covered = 0;
        for (let pos = term.start; pos < term.end; pos += 1) covered += Number(attributed.has(pos));
        if (covered) {
          term.base_weight = term.weight;
          term.weight *= 1 - ((1 - attribution.factor) * covered) / (term.end - term.start);
          term.attributed = true;
        }
      }
    }
    const coverage = [0],
      rawCoverage = [0],
      characters = [0];
    weights.forEach((weight, i) => {
      coverage.push(coverage.at(-1)! + weight);
      rawCoverage.push(rawCoverage.at(-1)! + rawWeights[i]);
      characters.push(characters.at(-1)! + Number(!isSpace(text.chars[pa + i])));
    });
    const density = (units: Span[], prefix = coverage): number =>
      sum(units.map(([a, b]) => prefix[b - pa] - prefix[a - pa])) /
      Math.max(
        sum(units.map(([a, b]) => characters[b - pa] - characters[a - pa])),
        cfg.minimum_unit_characters * units.length,
      );
    const candidate = (units: Span[], level: string): R | null => {
      const options = cfg.levels[level];
      let best: R | null = null;
      for (let width = 1; width <= Math.min(options.tail_units, units.length - 1); width += 1) {
        const tail = units.slice(-width);
        const previous = units.slice(
          Math.max(0, units.length - width - options.previous_units),
          -width,
        );
        const before = density(previous),
          after = density(tail),
          delta = close(after, before) ? 0 : Math.max(0, after - before);
        const a = tail[0][0],
          b = tail.at(-1)![1];
        const matches = [...terms.values()]
          .filter((t) => t.start < b && t.end > a)
          .sort((x, y) => x.start - y.start || x.end - y.end);
        const merged: Span[] = [];
        for (const term of matches) {
          const left = Math.max(a, term.start),
            right = Math.min(b, term.end);
          const last = merged.at(-1);
          if (last && left < last[1]) last[1] = Math.max(right, last[1]);
          else merged.push([left, right]);
        }
        const hits = merged.length;
        const strengthFor = (diff: number, tailDensity: number): number =>
          (((diff / (diff + cfg.delta_scale)) ** (cfg.delta_power ?? 1) * tailDensity) /
            (tailDensity + cfg.tail_density_scale)) *
          (hits / (hits + cfg.hit_prior)) ** (cfg.hit_power ?? 1);
        const rawBefore = density(previous, rawCoverage),
          rawTail = density(tail, rawCoverage),
          rawDelta = close(rawBefore, rawTail) ? 0 : Math.max(0, rawTail - rawBefore);
        const rawStrength = strengthFor(rawDelta, rawTail);
        const strength = Math.min(strengthFor(delta, after), rawStrength);
        if (strength > 0) {
          const event: R = {
            level,
            start: a,
            end: b,
            text: text.slice(a, b),
            previous_start: previous[0][0],
            previous_end: previous.at(-1)![1],
            previous_density: before,
            tail_density: after,
            density_delta: delta,
            strength,
            raw_strength: rawStrength,
            raw_previous_density: rawBefore,
            raw_tail_density: rawTail,
            tail_hits: hits,
            previous_units: previous.length,
            tail_units: width,
            terms: matches,
          };
          const [factor, contexts] = spanContextFactor(a, b, group.id, group._span_contexts ?? []);
          if (factor < 1) {
            event.span_context = { factor, before: event.strength, contexts };
            event.strength *= factor;
          }
          if (event.strength > 0 && (!best || event.strength > best.strength)) best = event;
        }
      }
      return best;
    };
    const sentences = splitSpans(text, pa, pb, cfg._sentence_separator);
    const sentenceEvents: R[] = [];
    for (const [a, b] of sentences) {
      if ((edges.start_sentence && a === 0) || (edges.end_sentence && b === text.length)) continue;
      const e = candidate(splitSpans(text, a, b, cfg._clause_separator), 'sentence');
      if (e) sentenceEvents.push(e);
    }
    const paragraphEvent =
      edges.end_paragraph && pb === text.length ? null : candidate(sentences, 'paragraph');
    const events = [...sentenceEvents, ...(paragraphEvent ? [paragraphEvent] : [])];
    const strongest = maxFirst(events, (e) => e.strength) ?? null;
    paragraphs.push({
      start: pa,
      end: pb,
      sentence_events: sentenceEvents,
      paragraph_event: paragraphEvent,
      strongest,
    });
  }
  const counted = paragraphs.map((p) => p.strongest).filter(Boolean);
  const result: R = {
    paragraphs,
    counted,
    frequency:
      (100 * sum(counted.map((e) => e.strength))) /
      Math.max(paragraphs.length, cfg.minimum_paragraphs),
  };
  if (cfg.repetition_support === 'relative_event_strength') {
    const support: R[] = [];
    for (const p of paragraphs) {
      const events: R[] = [...p.sentence_events, ...(p.paragraph_event ? [p.paragraph_event] : [])];
      const clusters: R[] = [];
      for (const e of events.sort((a, b) => a.start - b.start || a.end - b.end)) {
        const cluster = clusters.at(-1);
        if (cluster && e.start < cluster.end) {
          cluster.end = Math.max(cluster.end, e.end);
          if (e.strength > cluster.event.strength) cluster.event = e;
        } else clusters.push({ end: e.end, event: e });
      }
      const independent = clusters.map((c) => c.event);
      if (independent.length) {
        const peak = Math.max(...independent.map((e) => e.strength));
        support.push(
          ...independent.map((e) => ({
            ...e,
            relative_support: e.strength / peak,
          })),
        );
      }
    }
    result.support_count = fsum(support.map((e) => e.relative_support));
    result.support_events = support;
  }
  return result;
}

function paragraphTemplates(text: Text, cfg: R, edges: R): R {
  const events: R[] = [];
  let count = 0;
  for (const [pa, pb] of splitSpans(text, 0, text.length, cfg._paragraph_separator)) {
    if (!cfg._sentence_separator.search(text, pa, pb)) continue;
    count += 1;
    if (
      (cfg.position === 'start' && pa === 0 && edges.start_paragraph) ||
      (cfg.position === 'end' && pb === text.length && edges.end_paragraph)
    )
      continue;
    const sentences = splitSpans(text, pa, pb, cfg._sentence_separator);
    if (!sentences.length) continue;
    const [a, b] = cfg.position === 'start' ? sentences[0] : sentences.at(-1)!;
    const spans = matchSpans(cfg._patterns, new Text(text.slice(a, b)));
    if (spans.length)
      events.push({
        start: a,
        end: b,
        text: text.slice(a, b),
        matches: spans.map(([x, y]) => ({
          start: a + x,
          end: a + y,
          text: text.slice(a + x, a + y),
        })),
      });
  }
  const repeats = Math.max(0, events.length - 1),
    reliability = repeats / (repeats + cfg.repeat_prior);
  return {
    position: cfg.position,
    paragraph_count: count,
    matched_paragraphs: events.length,
    reliability,
    frequency: ((100 * events.length) / Math.max(count, cfg.minimum_paragraphs)) * reliability,
    events,
  };
}

export function effectiveWeight(group: R, ratio: number, count: number): number {
  let value = group.weight,
    previous = value;
  for (const tier of group.weight_levels) {
    const x = Math.max(
      0,
      Math.min(1, (ratio - tier.start_ratio) / (tier.full_ratio - tier.start_ratio)),
    );
    const blend = (x * x * (3 - 2 * x) * count) / (count + tier.count_prior);
    value += (tier.weight - previous) * blend;
    previous = tier.weight;
  }
  const r = group.repetition_weighting;
  if (r) {
    const factor = Math.max(
      0,
      Math.min(1, (count - r.start_count) / (r.full_count - r.start_count)),
    );
    value = group.weight + (value - group.weight) * factor;
  }
  return value;
}

function contextMatches(
  text: Text,
  sentences: Span[],
  cfg: R,
  primitive: Primitive,
  weights: Weights,
): R[] {
  const events: R[] = [];
  for (const [sa, sb] of sentences) {
    const contexts = cfg.contexts.flatMap((item: R) =>
      matchSpans(item._patterns, new Text(text.slice(sa, sb))).map(([a, b]) => [
        sa + a,
        sa + b,
        item.weight,
      ]),
    );
    const support: R[] = [];
    for (const gid of cfg.cooccurs_with_rules)
      for (const [a, b] of primitive.get(gid)!.positive) {
        if (!(sa <= a && a < b && b <= sb)) continue;
        for (const [x, y, anchorWeight] of contexts) {
          const distance = Math.max(0, a - y, x - b);
          if (distance > cfg.max_distance) continue;
          const [left, right] = y <= a ? [y, a] : b <= x ? [b, x] : [a, a];
          const boundaries: number[][] = [];
          for (const item of cfg.boundaries)
            for (const p of item._patterns as Pattern[])
              for (const m of p.finditer(text, left, right))
                if (m.end > m.start) boundaries.push([m.start, m.end, item.factor]);
          const merged: number[][] = [];
          for (const [start, end, factor] of boundaries.sort(tupleSort)) {
            const last = merged.at(-1);
            if (last && start < last[1]) {
              last[1] = Math.max(last[1], end);
              last[2] = Math.min(last[2], factor);
            } else merged.push([start, end, factor]);
          }
          const boundaryFactor = merged.reduce((v, s) => v * s[2], 1),
            distanceFactor = 1 / (1 + distance / cfg.distance_scale),
            sourceWeight = cfg.source_weights[String(gid)],
            localWeight = weights.get(gid)!.get(spanKey([a, b]))!;
          support.push({
            rule_id: gid,
            start: a,
            end: b,
            text: text.slice(a, b),
            context_start: x,
            context_end: y,
            context_weight: anchorWeight,
            source_weight: sourceWeight,
            local_weight: localWeight,
            distance,
            distance_factor: distanceFactor,
            boundary_factor: boundaryFactor,
            boundary_count: merged.length,
            strength: anchorWeight * sourceWeight * boundaryFactor * distanceFactor * localWeight,
          });
        }
      }
    const strongest = maxFirst(support, (e) => e.strength);
    if (strongest)
      events.push({
        start: Math.min(strongest.start, strongest.context_start),
        end: Math.max(strongest.end, strongest.context_end),
        sentence: { start: sa, end: sb, text: text.slice(sa, sb) },
        strength: strongest.strength,
        selected_support: strongest,
        support,
      });
  }
  return events;
}

function sequenceTemplates(
  text: Text,
  cfg: R,
  extensions: R[],
  primitive: Primitive,
  weights: Weights,
): R {
  const events: R[] = [];
  let paragraphCount = 0;
  for (const [pa, pb] of splitSpans(text, 0, text.length, cfg._paragraph_separator)) {
    if (!cfg._sentence_separator.search(text, pa, pb)) continue;
    paragraphCount += 1;
    const sentences = splitSpans(text, pa, pb, cfg._sentence_separator);
    const candidates: R[][] = cfg.stages.map((stage: R) =>
      sentences.flatMap(([a, b], i) =>
        matchSpans(stage._patterns, new Text(text.slice(a, b))).map(([x, y]) => ({
          stage: stage.id,
          sentence_index: i,
          start: a + x,
          end: a + y,
          text: text.slice(a + x, a + y),
        })),
      ),
    );
    for (const extension of extensions) {
      const target = cfg.stages.findIndex((s: R) => s.id === extension.config.stage);
      for (const source of extension.config.source_rules)
        for (const [a, b] of primitive.get(source)!.positive)
          sentences.forEach(([sa, sb], i) => {
            if (sa <= a && a < b && b <= sb)
              candidates[target].push({
                stage: extension.config.stage,
                sentence_index: i,
                start: a,
                end: b,
                text: text.slice(a, b),
                via_rule: source,
                via_interaction: extension.id,
                local_weight: weights.get(source)!.get(spanKey([a, b])),
              });
          });
    }
    for (const options of candidates)
      options.sort((a, b) =>
        tupleSort(
          [a.sentence_index, a.start, a.end, a.via_interaction ?? '', a.via_rule ?? 0],
          [b.sentence_index, b.start, b.end, b.via_interaction ?? '', b.via_rule ?? 0],
        ),
      );
    const extend = (path: R[]): R[] | undefined => {
      if (path.length === candidates.length) return path;
      for (const item of candidates[path.length]) {
        const last = path.at(-1);
        if (
          last &&
          (!(
            1 <= item.sentence_index - last.sentence_index &&
            item.sentence_index - last.sentence_index <= cfg.max_sentence_gap
          ) ||
            item.end - path[0].start > cfg.max_characters)
        )
          continue;
        const found = extend([...path, item]);
        if (found) return found;
      }
    };
    const found = extend([]);
    if (found) {
      const a = sentences[found[0].sentence_index][0],
        b = sentences[found.at(-1)!.sentence_index][1];
      events.push({
        start: a,
        end: b,
        text: text.slice(a, b),
        stages: found,
        strength: Math.min(...found.map((s) => s.local_weight ?? 1)),
      });
    }
  }
  const repeats = Math.max(0, events.length - 1),
    reliability = repeats / (repeats + cfg.repeat_prior);
  return {
    paragraph_count: paragraphCount,
    matched_paragraphs: events.length,
    reliability,
    frequency:
      ((100 * sum(events.map((e) => e.strength))) /
        Math.max(paragraphCount, cfg.minimum_paragraphs)) *
      reliability,
    events,
  };
}

function evaluateInteractions(
  text: Text,
  config: Rules,
  sentences: Span[],
  primitive: Primitive,
  structures: Map<number, R>,
  openings: Map<number, R>,
  sequences: Map<number, R>,
  multiplier: number,
  examples: number,
  locale: Language,
  weights: Weights,
): R[] {
  const pending: Array<[R, R]> = [];
  for (const entry of config.interactions) {
    const c = entry.config,
      kind = entry.kind;
    const item: R = {
      id: entry.id,
      name: entry.names[locale],
      kind,
      events: [],
      candidate_count: 0,
      evidence: 0,
    };
    if (kind === 'context') {
      item.events = contextMatches(text, sentences, c, primitive, weights);
      item.frequency_basis = 'weighted_matches_per_characters';
      item.frequency_unit = config.scoring.frequency_unit;
    } else if (kind === 'tail_surge') {
      const paragraphs = structures.get(c.surge_rule)!.paragraphs;
      item.paragraph_count = paragraphs.length;
      item.frequency_basis = 'weighted_events_per_100_paragraphs';
      item.frequency_unit = 100;
      for (const p of paragraphs)
        for (const surge of [
          ...p.sentence_events,
          ...(p.paragraph_event ? [p.paragraph_event] : []),
        ]) {
          const matches = primitive
            .get(c.source_rule)!
            .positive.filter(([a, b]) => surge.start <= a && a < b && b <= surge.end)
            .map(([a, b]) => ({
              rule_id: c.source_rule,
              start: a,
              end: b,
              text: text.slice(a, b),
              local_weight: weights.get(c.source_rule)!.get(spanKey([a, b]))!,
            }));
          if (matches.length)
            item.events.push({
              start: surge.start,
              end: surge.end,
              text: surge.text,
              level: surge.level,
              strength:
                surge.strength * c.source_weight * Math.max(...matches.map((m) => m.local_weight)),
              surge_strength: surge.strength,
              support: matches,
            });
        }
    } else if (kind === 'opening_closing') {
      const paragraphs = structures.get(c.closing_rule)!.paragraphs,
        openingEvents = openings.get(c.opening_rule)!.events;
      item.paragraph_count = paragraphs.length;
      item.frequency_basis = 'weighted_pairs_per_100_paragraphs';
      item.frequency_unit = 100;
      item.opening_count = 0;
      item.closing_count = 0;
      for (const p of paragraphs) {
        const opening = openingEvents.find(
            (e: R) => p.start <= e.start && e.start < e.end && e.end <= p.end,
          ),
          closing = p.paragraph_event;
        item.opening_count += Number(!!opening);
        item.closing_count += Number(!!closing);
        if (opening && closing && opening.end <= closing.start)
          item.events.push({
            start: opening.start,
            end: closing.end,
            text: text.slice(opening.start, closing.end),
            strength: closing.strength,
            opening,
            closing,
          });
      }
      item.paired_count = item.events.length;
      item.expected_pairs_under_independence =
        (item.opening_count * item.closing_count) / Math.max(1, paragraphs.length);
      const repeats = Math.max(0, item.events.length - 1);
      item.repetition_reliability = repeats / (repeats + c.repeat_prior);
    } else {
      const seq = sequences.get(c.target_rule)!;
      item.scored_in_rule = c.target_rule;
      item.frequency_basis = 'scored_in_target_rule';
      item.events = seq.events.filter((e: R) =>
        e.stages.some((s: R) => s.via_interaction === entry.id),
      );
      item.frequency = seq.frequency;
      item.target_matched_paragraphs = seq.matched_paragraphs;
    }
    item.candidate_count = item.events.length;
    pending.push([entry, item]);
  }
  const selected = new Map<string, Span[]>();
  const winners = new Map<number, R[]>();
  const candidates: any[][] = [];
  pending.forEach(([entry, item], i) => {
    if (entry.kind === 'tail_surge') {
      winners.set(i, []);
      for (const e of item.events) candidates.push([-e.strength, e.start, e.end, entry.id, i, e]);
    }
  });
  candidates.sort((a, b) => tupleSort(a.slice(0, 5), b.slice(0, 5)));
  for (const [, a, b, , index, event] of candidates) {
    const family = pending[index][0].config.deduplication_group;
    const occupied = selected.get(family) ?? [];
    selected.set(family, occupied);
    if (!occupied.some((s) => overlap(s, [a, b]))) {
      occupied.push([a, b]);
      winners.get(index)!.push(event);
    }
  }
  return pending.map(([entry, item], i) => {
    const c = entry.config,
      kind = entry.kind;
    if (kind === 'tail_surge')
      item.events = winners.get(i)!.sort((a, b) => a.start - b.start || a.end - b.end);
    if (kind !== 'sequence_extension') {
      let count = sum(item.events.map((e: R) => e.strength));
      let frequency =
        kind === 'context'
          ? multiplier * count
          : (100 * count) / Math.max(item.paragraph_count, c.minimum_paragraphs);
      if (kind === 'opening_closing') {
        frequency *= item.repetition_reliability;
        count *= item.repetition_reliability;
      }
      const ratio = frequency / c.scoring.saturation_frequency,
        weight = effectiveWeight(c.scoring, ratio, count);
      Object.assign(item, {
        frequency,
        weighted_count: count,
        effective_weight: weight,
        weight: c.scoring.weight,
        level_1_weight: c.scoring.weight_levels[0].weight,
        level_2_weight: c.scoring.weight_levels[1].weight,
        evidence: (weight * ratio) / (1 + ratio),
      });
    }
    item.match_count = item.events.length;
    item.suppressed_count = item.candidate_count - item.match_count;
    for (const e of item.events)
      if (!e.sentence) e.sentence = example(text, e.start, e.end, sentences).sentence;
    item.events = slice(item.events, examples);
    return item;
  });
}

function bigrams(text: string, options: R): string[] {
  const result: string[] = [];
  for (const match of (options._han as Pattern).finditer(text)) {
    const run = new Text(match.group());
    for (let i = 0; i < run.length - 1; i += 1) result.push(run.slice(i, i + 2));
  }
  return result;
}
function structureUnits(text: Text, options: R): R[] {
  const units: R[] = [];
  for (const match of (options._sentences as Pattern).finditer(text)) {
    const part = new Text(match.group());
    if (!options._han.search(part)) continue;
    const tokens: string[] = [],
      markers: R[] = [],
      frame: string[] = [],
      content: string[] = [];
    let cursor = 0;
    for (const m of (options._markers as Pattern).finditer(part)) {
      const key = Object.keys(m.native.groups!).find((k) => m.native.groups![k] !== undefined)!;
      const marker = options.markers[Number(key.slice(1))];
      const before = part.slice(cursor, m.start);
      content.push(before, marker.id === 'lexical' ? m.group() : ' ');
      if (options._han.search(before)) frame.push('X');
      if (marker.id === 'lexical') {
        if (!frame.length || frame.at(-1) !== 'X') frame.push('X');
        cursor = m.end;
        continue;
      }
      frame.push(
        marker.id === 'punctuation' ? (';；'.includes(m.group()) ? 'semi' : 'comma') : marker.id,
      );
      cursor = m.end;
      if (marker.weight <= 0) continue;
      tokens.push(marker.id);
      markers.push({
        id: marker.id,
        start: match.start + m.start,
        end: match.start + m.end,
        text: m.group(),
        weight: marker.weight,
      });
    }
    content.push(part.slice(cursor));
    if (options._han.search(part.slice(cursor))) frame.push('X');
    units.push({
      start: match.start,
      end: match.end,
      tokens,
      markers,
      frame,
      content: new Set(bigrams(content.join(''), options)),
    });
  }
  return units;
}
function alignment(left: string[], right: string[], weights: R, trace = false): [number, Span[]] {
  let previous = Array<number>(right.length + 1).fill(0);
  const table: number[][] = trace ? [previous] : [];
  for (const token of left) {
    const row = [0];
    right.forEach((other, j) =>
      row.push(
        token === other
          ? Math.max(row.at(-1)!, previous[j + 1], previous[j] + weights[token])
          : Math.max(row.at(-1)!, previous[j + 1]),
      ),
    );
    previous = row;
    if (trace) table.push(row);
  }
  const matched: Span[] = [];
  if (trace) {
    let i = left.length,
      j = right.length;
    while (i && j) {
      if (
        left[i - 1] === right[j - 1] &&
        Math.abs(table[i][j] - table[i - 1][j - 1] - weights[left[i - 1]]) < 1e-10
      ) {
        matched.push([i - 1, j - 1]);
        i -= 1;
        j -= 1;
      } else if (table[i - 1][j] >= table[i][j - 1]) i -= 1;
      else j -= 1;
    }
  }
  return [previous.at(-1)!, matched.reverse()];
}
function novelty(text: Text, options: R): R {
  const grams = bigrams(text.value, options),
    size = options.lexical_window;
  if (grams.length < size) return { diversity: null, factor: 0 };
  const starts = new Set<number>();
  for (let i = 0; i <= grams.length - size; i += options.lexical_stride) starts.add(i);
  starts.add(grams.length - size);
  const values = [...starts]
    .sort((a, b) => a - b)
    .map((a) => new Set(grams.slice(a, a + size)).size / size);
  const diversity = mean(values);
  return {
    diversity,
    factor: Math.max(0, Math.min(1, (diversity - options.novelty_start) / options.novelty_width)),
  };
}
function constructionEvidence(text: Text, options: R): R {
  const units = structureUnits(text, options),
    weights = Object.fromEntries(options.markers.map((m: R) => [m.id, m.weight]));
  const eligible = units.map(
    (u) =>
      u.tokens.length >= options.minimum_markers &&
      new Set(u.tokens).size >= options.minimum_marker_types &&
      u.content.size >= options.minimum_content_bigrams,
  );
  const counts = units.map((u) => {
    const c = new Map<string, number>();
    for (const t of u.tokens) c.set(t, (c.get(t) ?? 0) + 1);
    return c;
  });
  const masses = units.map((u) => sum(u.tokens.map((t: string) => weights[t]))),
    degrees = Array<number>(units.length).fill(0),
    pairs: R[] = [];
  for (let i = 0; i < units.length; i += 1) {
    if (!eligible[i]) continue;
    const left = units[i];
    for (let j = i + 1; j < Math.min(units.length, i + options.comparison_window); j += 1) {
      if (!eligible[j]) continue;
      const right = units[j],
        mass = masses[i] + masses[j];
      const bound = sum(
        [...counts[i]].map(([t, n]) => Math.min(n, counts[j].get(t) ?? 0) * weights[t]),
      );
      if (!mass || (2 * bound) / mass < options.similarity) continue;
      const union = new Set([...left.content, ...right.content]),
        intersection = [...left.content].filter((t) => right.content.has(t));
      const contentOverlap = union.size ? intersection.length / union.size : 1;
      if (contentOverlap > options.maximum_content_overlap) continue;
      const [matched] = alignment(left.tokens, right.tokens, weights),
        similarity = (2 * matched) / mass;
      if (similarity + 1e-12 < options.similarity) continue;
      const [, aligned] = alignment(left.tokens, right.tokens, weights, true);
      const informative = new Set(
        options.markers.filter((m: R) => m.informative).map((m: R) => m.id),
      );
      const information = sum(
        aligned
          .filter(([a]) => informative.has(left.tokens[a]))
          .map(([a]) => weights[left.tokens[a]]),
      );
      const support = matched ? information / matched : 0;
      if (!support) continue;
      degrees[i] += support;
      degrees[j] += support;
      const clean = (unit: R): R =>
        Object.fromEntries(Object.entries(unit).filter(([k]) => k !== 'content'));
      pairs.push({
        left_index: i,
        right_index: j,
        similarity,
        matched_weight: matched,
        content_overlap: contentOverlap,
        support,
        left: clean(left),
        right: clean(right),
        alignment: aligned.map(([a, b]) => ({
          left: left.markers[a],
          right: right.markers[b],
        })),
      });
    }
  }
  const repetition =
      sum(degrees.map((d) => d / (d + options.repetition_prior))) / Math.max(units.length, 1),
    lex = novelty(text, options);
  return {
    sentence_count: units.length,
    pair_count: pairs.length,
    matched_sentence_count: degrees.filter((d) => d > 0).length,
    weighted_degrees: degrees,
    repetition,
    diversity: lex.diversity,
    novelty_factor: lex.factor,
    evidence: options.strength * repetition * lex.factor,
    pairs,
  };
}

const compact = (value: string): string =>
  Array.from(value)
    .filter((c) => !isSpace(c))
    .join('');
const strip = (value: string, characters?: string): string => {
  const chars = Array.from(value);
  const removable = (c: string): boolean =>
    characters === undefined ? isSpace(c) : characters.includes(c);
  let a = 0,
    b = chars.length;
  while (a < b && removable(chars[a])) a += 1;
  while (b > a && removable(chars[b - 1])) b -= 1;
  return chars.slice(a, b).join('');
};
const escapePattern = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function reportingNamePatterns(text: Text, config: Rules): Pattern[] {
  const options = config.reporting_names;
  if (!options?.enabled) return [];
  const names = new Set<string>();
  for (const pattern of options._patterns as Pattern[])
    for (const m of pattern.finditer(text)) {
      const name = strip(m.group('name'));
      if (Array.from(name).length < 2) continue;
      names.add(name);
      for (const suffix of name.split(/[·•・]/).slice(1))
        if (Array.from(suffix).length >= 2) names.add(suffix);
    }
  if (!names.size) return [];
  const sorted = [...names].sort(
    (a, b) => Array.from(b).length - Array.from(a).length || (a < b ? -1 : a > b ? 1 : 0),
  );
  return [
    new Pattern(
      `(?:${sorted.map(escapePattern).join('|')})(?:[（(][^）)\\n]{2,60}[）)])?${options.reporting_suffix}`,
      false,
    ),
  ];
}

function textSpanContexts(text: Text, config: Rules): R[] {
  if (!(config.span_contexts ?? []).some((c: R) => c.enabled)) return [];
  const sentences = sentenceContexts(text),
    output: R[] = [];
  for (const item of config.span_contexts ?? []) {
    if (!item.enabled) continue;
    const emit = (a: number, b: number, details: R = {}): void => {
      if (a < b)
        output.push({
          id: item.id,
          start: a,
          end: b,
          factor: item.factor,
          rules: item.rules,
          names: item.names,
          ...details,
        });
    };
    if (item.method === 'attribution') {
      const quotes: R = { '「': '」', '『': '』', '“': '”', '"': '"' };
      for (const pattern of [
        ...item._patterns,
        ...reportingNamePatterns(text, config),
      ] as Pattern[])
        for (const m of pattern.finditer(text)) {
          let a = m.end;
          while (a < text.length && ' ：:，,\t'.includes(text.chars[a])) a += 1;
          let b = Math.min(text.length, a + item.maximum_characters);
          if (quotes[text.chars[a]]) {
            const end = text.chars.slice(a + 1, b).indexOf(quotes[text.chars[a]]);
            if (end < 0) continue;
            b = a + 1 + end + 1;
          } else {
            const boundary = new Pattern('[。！？!?；;\\n]', false).search(text.slice(a, b));
            if (boundary) b = a + boundary.end;
          }
          emit(a, b, { cue: { start: m.start, end: m.end, text: m.group() } });
        }
    } else if (item.method === 'editorial_section') {
      for (const pattern of item._patterns as Pattern[])
        for (const m of pattern.finditer(text)) {
          let b = Math.min(text.length, m.end + item.maximum_characters);
          const boundary = new Pattern('\\n\\s*\\n', false).search(text.slice(m.end, b));
          if (boundary) b = m.end + boundary.start;
          emit(m.start, b, {
            cue: { start: m.start, end: m.end, text: m.group() },
          });
        }
    } else if (item.method === 'question_echo') {
      const seen = new Map<string, Span>(),
        candidates: R[] = [];
      for (const [i, [a, b]] of sentences.entries()) {
        const body = strip(text.slice(a, b));
        if (!/[？?][」』”"]*$/.test(body)) continue;
        const prefix = new Pattern('^\\s*(?:\\d+[.、．)]\\s*)?', false).search(body)!;
        const normalized = compact(new Text(body).slice(prefix.end));
        if (Array.from(normalized).length < item.minimum_characters) continue;
        if (seen.has(normalized) && i + 1 < sentences.length) {
          const [x, y] = sentences[i + 1];
          if (nonspace(text.slice(x, y)) >= item.minimum_characters)
            candidates.push({
              a,
              b,
              normalized,
              previous: seen.get(normalized),
            });
        } else seen.set(normalized, [a, b]);
      }
      if (new Set(candidates.map((c) => c.normalized)).size >= item.minimum_distinct_questions)
        for (const c of candidates)
          emit(c.a, c.b, {
            previous_start: c.previous[0],
            previous_end: c.previous[1],
          });
    } else if (item.method === 'scope_link') {
      const grams = (body: string): Set<string> =>
        new Set(
          [...body.matchAll(/[\u3400-\u9fff]+/g)].flatMap((m) =>
            Array.from({ length: Math.max(0, m[0].length - 2) }, (_, i) => m[0].slice(i, i + 3)),
          ),
        );
      for (const [i, [a, b]] of sentences.entries()) {
        const body = text.slice(a, b);
        const limits = (item._limitation_patterns as Pattern[]).flatMap((p) => [
          ...p.finditer(body),
        ]);
        if (!limits.length || i === 0) continue;
        const left = Math.max(sentences[Math.max(0, i - 2)][0], a - item.maximum_characters),
          previous = text.slice(left, a);
        if (
          new Pattern('\\n\\s*\\n', false).search(previous) ||
          !item._scope_patterns.some((p: Pattern) => p.search(previous))
        )
          continue;
        const current = grams(body);
        const shared = [...grams(previous)]
          .filter(
            (s) => current.has(s) && !item.generic_terms.some((word: string) => word.includes(s)),
          )
          .sort();
        if (shared.length >= item.minimum_shared_trigrams)
          emit(a + Math.min(...limits.map((m) => m.start)), b, {
            previous_start: left,
            previous_end: a,
            shared_trigrams: shared,
          });
      }
    } else {
      const seen = new Map<string, Span>();
      for (let i = 0; i < sentences.length - 1; i += 1) {
        const a = sentences[i][0],
          b = sentences[i + 1][1];
        const parts = sentences.slice(i, i + 2).map(([x, y]) => compact(text.slice(x, y)));
        if (parts.reduce((n, s) => n + Array.from(s).length, 0) < item.minimum_characters) continue;
        const key = JSON.stringify(parts),
          old = seen.get(key);
        if (old && old[1] <= a) emit(a, b, { previous_start: old[0], previous_end: old[1] });
        else seen.set(key, [a, b]);
      }
    }
  }
  return [...new Map(output.map((e) => [`${e.id}:${e.start}:${e.end}`, e])).values()].sort((a, b) =>
    tupleSort([a.start, a.end, a.id], [b.start, b.end, b.id]),
  );
}

function windowSpanContexts(contexts: R[], start: number, end: number): R[] {
  return contexts.flatMap((e) => {
    if (
      e.start >= end ||
      e.end <= start ||
      (e.previous_start !== undefined && e.previous_start < start) ||
      (e.cue?.start ?? start) < start
    )
      return [];
    const copy: R = {
      ...e,
      start: Math.max(start, e.start) - start,
      end: Math.min(end, e.end) - start,
    };
    for (const key of ['previous_start', 'previous_end']) if (key in copy) copy[key] -= start;
    if (copy.cue)
      copy.cue = {
        ...copy.cue,
        start: copy.cue.start - start,
        end: copy.cue.end - start,
      };
    return [copy];
  });
}

function spanContextFactor(start: number, end: number, gid: number, contexts: R[]): [number, R[]] {
  let factor = 1,
    selected: R[] = [];
  for (const e of contexts) {
    if (!e.rules.includes(gid)) continue;
    const covered = Math.max(0, Math.min(end, e.end) - Math.max(start, e.start));
    if (!covered) continue;
    const current = 1 - ((1 - e.factor) * covered) / Math.max(1, end - start);
    if (current < factor) {
      factor = current;
      selected = [e];
    } else if (current === factor) selected.push(e);
  }
  return [factor, selected];
}

function applySpanMatches(
  config: Rules,
  primitive: Primitive,
  weights: Weights,
  details: Details,
): void {
  for (const [gid] of primitive)
    for (const [key, before] of weights.get(gid)!) {
      const [a, b] = key.split(',').map(Number);
      const [factor, contexts] = spanContextFactor(a, b, gid, config._span_contexts ?? []);
      if (factor >= 1) continue;
      weights.get(gid)!.set(key, before * factor);
      if (!details.has(gid)) details.set(gid, new Map());
      if (!details.get(gid)!.has(key)) details.get(gid)!.set(key, {});
      details.get(gid)!.get(key)!.span_context = {
        factor,
        before,
        after: before * factor,
        contexts,
      };
    }
}

function familyEffectiveWeight(
  text: Text,
  group: R,
  spans: Span[],
  weights: Map<string, number>,
  details: Map<string, R>,
  ratio: number,
  original: number,
  locale: Language,
  separator: Pattern,
): [number, R[] | undefined] {
  const options = group.frequency_families;
  if (!options?.enabled) return [original, undefined];
  const counts = new Map<string, number>(),
    raw = new Map<string, number>();
  const pooled = splitSpans(text, 0, text.length, separator).filter(([a, b]) =>
    options._pooled_contexts.some((p: Pattern) => p.search(text.slice(a, b))),
  );
  for (const [a, b] of spans) {
    const key = spanKey([a, b]),
      local = details.get(key) ?? {};
    const fragment = text.slice(local.context_start ?? a, local.context_end ?? b);
    const boundary = new Pattern('[。！？!?\\n]', false).search(text.slice(a));
    const question = !!boundary && '？?'.includes(boundary.group());
    const family = options.families.find(
      (f: R) =>
        (f.question_sentence && question) ||
        f.local_subtypes.includes(local.subtype) ||
        f._patterns.some((p: Pattern) => p.search(fragment)),
    );
    let id = family?.id ?? 'other';
    if (pooled.some(([x, y]) => x <= a && b <= y)) {
      id = 'other';
      local.frequency_context = 'explicit_narrative_frame';
    }
    counts.set(id, (counts.get(id) ?? 0) + weights.get(key)!);
    raw.set(id, (raw.get(id) ?? 0) + 1);
    local.frequency_family = id;
  }
  const total = fsum(counts.values());
  if (!total) return [group.weight, []];
  const output = [...counts].map(([id, count]) => {
    const share = count / total,
      r = ratio * share;
    return {
      id,
      name:
        options.families.find((f: R) => f.id === id)?.names[locale] ??
        (locale === 'en' ? 'Other negation' : '其他否定'),
      raw_count: raw.get(id),
      weighted_count: count,
      frequency_ratio: r,
      effective_weight: effectiveWeight(group, r, count),
      share,
    };
  });
  return [fsum(output.map((e) => e.share * e.effective_weight)), output];
}

function disclosureEvents(text: Text, feature: R): R {
  const chars = [...text.chars];
  for (const [a, b] of matchSpans(feature._exclude_patterns, text)) chars.fill(' ', a, b);
  const body = new Text(chars.join(''));
  const identities = matchSpans(feature._identity_patterns, body).filter(
    ([a]) =>
      !feature._reporting_prefix_patterns.some((p: Pattern) =>
        p.search(body.slice(Math.max(0, a - 32), a)),
      ),
  );
  const capabilities: any[] = [];
  for (const [a, b] of matchSpans(feature._capability_patterns, body)) {
    const parents = identities.filter(
      ([, y]) =>
        a - y >= 0 &&
        a - y <= feature.maximum_gap &&
        [...feature._boundaries.finditer(body.slice(y, a))].length <= feature.maximum_boundaries,
    );
    if (parents.length) capabilities.push([a, b, parents]);
  }
  return { identities, capabilities };
}
function disclosureWindow(contexts: R, start: number, end: number): R {
  return Object.fromEntries(
    Object.entries(contexts).map(([id, c]) => {
      const inside = c.identities.filter(([a, b]: Span) => start <= a && b <= end) as Span[];
      const included = new Set(inside.map(spanKey)),
        capabilities: any[] = [];
      for (const [a, b, parents] of c.capabilities) {
        const local = parents
          .filter((p: Span) => included.has(spanKey(p)))
          .map(([x, y]: Span) => [x - start, y - start]);
        if (start <= a && b <= end && local.length)
          capabilities.push([a - start, b - start, local]);
      }
      return [
        id,
        {
          identities: inside.map(([a, b]) => [a - start, b - start]),
          capabilities,
        },
      ];
    }),
  );
}
function scoreDisclosure(
  text: Text,
  feature: R,
  config: Rules,
  rules: R[],
  examples: number,
  locale: Language,
): R {
  const c = config._disclosure_contexts?.[feature.id] ?? disclosureEvents(text, feature),
    sentences = sentenceContexts(text);
  const events: R[] = c.identities.map(([a, b]: Span) => ({
    ...example(text, a, b, sentences),
    kind: 'model_identity',
  }));
  for (const [a, b, parents] of c.capabilities) {
    const [x, y] = parents.at(-1);
    events.push({
      ...example(text, a, b, sentences),
      kind: 'capability_limit',
      related_sentence: example(text, x, y, sentences).sentence,
    });
  }
  events.sort((a, b) => a.start - b.start || a.end - b.end);
  const count = events.length,
    denominator = Math.max(nonspace(text.value), config.scoring.minimum_characters),
    unit = config.scoring.frequency_unit;
  const frequency = (unit * count) / denominator,
    ratio = frequency / feature.saturation_frequency,
    weight = effectiveWeight(feature, ratio, count);
  const raw = (weight * frequency) / (frequency + feature.saturation_frequency),
    source = rules.find((g) => g.id === feature.source_rule)?.evidence ?? 0;
  return {
    id: feature.id,
    name: feature.names[locale],
    note: feature.notes[locale],
    method: feature.method,
    source_rule: feature.source_rule,
    raw_matches: count,
    equivalent_matches: count,
    identity_count: c.identities.length,
    capability_count: c.capabilities.length,
    normalization_characters: denominator,
    frequency_unit: unit,
    frequency,
    weight_frequency_ratio: ratio,
    weight: feature.weight,
    effective_weight: weight,
    level_1_weight: feature.weight_levels[0].weight,
    level_2_weight: feature.weight_levels[1].weight,
    raw_evidence: raw,
    source_evidence: source,
    evidence: Math.max(0, raw - source),
    events,
    examples: slice(events, examples),
  };
}

function scoreTemplate(text: Text, f: R, config: Rules, examples: number, locale: Language): R {
  const first = new Map<string, R>(),
    counts: R = {},
    events: R[] = [];
  let raw = 0,
    sentences = 0;
  for (const m of f._sentences.finditer(text)) {
    const body = strip(m.group());
    if (!body) continue;
    sentences += 1;
    let a = m.start,
      b = m.end;
    while (a < b && isSpace(text.chars[a])) a += 1;
    while (b > a && isSpace(text.chars[b - 1])) b -= 1;
    const matched = f.families
      .filter((family: R) => family._patterns.some((p: Pattern) => p.search(body)))
      .map((family: R) => family.id);
    if (!matched.length) continue;
    raw += 1;
    for (const id of matched) counts[id] = (counts[id] ?? 0) + 1;
    const sentence = { start: a, end: b, text: text.slice(a, b) },
      repeated = matched.filter((id: string) => first.has(id));
    if (repeated.length) {
      const related = new Map<string, R>();
      for (const id of repeated) {
        const old = first.get(id)!;
        related.set(spanKey([old.start, old.end]), old);
      }
      events.push({
        ...sentence,
        sentence,
        families: repeated,
        related_sentences: [...related.values()],
      });
    }
    for (const id of matched) if (!first.has(id)) first.set(id, sentence);
  }
  const count = events.length,
    denominator = Math.max(nonspace(text.value), config.scoring.minimum_characters),
    unit = config.scoring.frequency_unit;
  const frequency = (unit * count) / denominator,
    ratio = frequency / f.saturation_frequency,
    weight = effectiveWeight(f, ratio, count);
  return {
    id: f.id,
    name: f.names[locale],
    note: f.notes[locale],
    method: f.method,
    sentence_count: sentences,
    raw_matches: raw,
    family_counts: counts,
    equivalent_matches: count,
    normalization_characters: denominator,
    frequency_unit: unit,
    frequency,
    weight_frequency_ratio: ratio,
    weight: f.weight,
    effective_weight: weight,
    level_1_weight: f.weight_levels[0].weight,
    level_2_weight: f.weight_levels[1].weight,
    evidence: (weight * frequency) / (frequency + f.saturation_frequency),
    events,
    examples: slice(events, examples),
  };
}

function cumulativeRepeats(candidates: R[]): R[] {
  const first = new Map<string, R>(),
    surfaces = new Map<string, Set<string>>(),
    selected = new Map<string, R>();
  for (const c of candidates.sort((a, b) => a.start - b.start || a.end - b.end)) {
    const key = c.family,
      body = compact(c.text);
    if (!surfaces.has(key)) surfaces.set(key, new Set());
    if (surfaces.get(key)!.has(body)) continue;
    surfaces.get(key)!.add(body);
    if (!first.has(key)) {
      first.set(key, c);
      continue;
    }
    const position = spanKey([c.start, c.end]);
    if (!selected.has(position))
      selected.set(position, { ...c, families: [], related_sentences: [] });
    const event = selected.get(position)!;
    event.families.push(key);
    const old = first.get(key)!,
      related = { start: old.start, end: old.end, text: old.text };
    if (
      !event.related_sentences.some(
        (r: R) => r.start === related.start && r.end === related.end && r.text === related.text,
      )
    )
      event.related_sentences.push(related);
    event.strength = Math.max(event.strength ?? 1, c.strength ?? 1);
  }
  return [...selected.values()];
}

function cumulativeMeasure(text: Text, feature: R, sentences: R[], quoteContext?: R): [R[], R] {
  const candidates: R[] = [],
    method = feature.method;
  if (method === 'sentence_families' || method === 'subject_repetition') {
    for (const sentence of sentences) {
      const m =
        method === 'subject_repetition' ? feature._pattern.search(sentence.text) : undefined;
      const families =
        method === 'sentence_families'
          ? feature.families
              .filter((f: R) => f._patterns.some((p: Pattern) => p.search(sentence.text)))
              .map((f: R) => f.id)
          : m
            ? [m.group(feature.capture)]
            : [];
      for (const family of families) {
        let strength = 1;
        if (
          m &&
          ['「', '『', '“', '"'].includes(
            Array.from(strip(new Text(sentence.text).slice(m.end)))[0],
          )
        )
          strength = feature.quoted_complement_weight ?? 1;
        candidates.push({ ...sentence, family, strength });
      }
    }
    return [cumulativeRepeats(candidates), { raw_matches: candidates.length }];
  }
  if (method === 'clause_rhythm') {
    const quotes = new Pattern('「[^」]*」|『[^』]*』|“[^”]*”|"[^"\\n]*"', false);
    for (const sentence of sentences) {
      const body = new Text(sentence.text),
        protectedSpans = [...quotes.finditer(body)].map((m) => m.span());
      let cursor = 0;
      const units: string[] = [],
        punctuation: string[] = [];
      for (const m of new Pattern('[，,；;：:]', false).finditer(body)) {
        if (protectedSpans.some(([a, b]) => a <= m.start && m.start < b)) continue;
        units.push(strip(body.slice(cursor, m.start)));
        punctuation.push(({ ',': '，', ';': '；', ':': '：' } as R)[m.group()] ?? m.group());
        cursor = m.end;
      }
      const tail = [...body.chars.slice(cursor)];
      while (tail.length && '。！？!?」』”"'.includes(tail.at(-1)!)) tail.pop();
      units.push(strip(tail.join('')));
      if (units.length !== 3) continue;
      const sizes = units.map(nonspace);
      if (Math.min(...sizes) < feature.minimum_clause_characters) continue;
      const total = sum(sizes),
        squares = sum(sizes.map((s) => s * s));
      const variation = Math.sqrt((3 * squares - total * total) / 9) / (total / 3);
      if (variation >= feature.maximum_cv) continue;
      const roles = units.map(
        (unit) =>
          Object.entries(feature._roles).find(([, p]) => (p as Pattern).search(unit))?.[0] ??
          'content',
      );
      candidates.push({
        ...sentence,
        family: `${punctuation.join('/')}:${roles.join(',')}`,
        strength: 1 - variation / feature.maximum_cv,
        clause_lengths: sizes,
        cv: variation,
      });
    }
    return [cumulativeRepeats(candidates), { raw_matches: candidates.length }];
  }
  if (method === 'discourse_order') {
    for (let i = 0; i < sentences.length - 2; i += 3) {
      const block = sentences.slice(i, i + 3);
      const roles = block.map((s) => {
        const hits = Object.entries(feature._roles)
          .flatMap(([name, p]) => {
            const m = (p as Pattern).search(s.text);
            return m ? [[m.start, name]] : [];
          })
          .sort(tupleSort);
        return hits[0]?.[1] ?? 'content';
      });
      if (new Set(roles.filter((r) => r !== 'content')).size < 2) continue;
      const a = block[0].start,
        b = block[2].end;
      candidates.push({
        start: a,
        end: b,
        text: text.slice(a, b),
        family: roles.join('/'),
        strength: 1,
      });
    }
    const events = cumulativeRepeats(candidates),
      count = events.length;
    return [
      events,
      {
        raw_matches: candidates.length,
        direct_evidence:
          (((feature.strength * count) / Math.max(1, Math.floor(sentences.length / 3))) * count) /
          (count + feature.repeat_prior),
      },
    ];
  }
  if (method === 'adjacent_overlap') {
    const grams = (body: string): Set<string> =>
      new Set(
        [...body.matchAll(/[\u3400-\u9fff]+/g)].flatMap((m) =>
          Array.from({ length: Math.max(0, m[0].length - 1) }, (_, i) => m[0].slice(i, i + 2)),
        ),
      );
    for (let i = 0; i < sentences.length - 1; i += 1) {
      const left = sentences[i],
        right = sentences[i + 1];
      if (compact(left.text) === compact(right.text)) continue;
      const a = grams(left.text),
        b = grams(right.text);
      if (Math.min(a.size, b.size) < feature.minimum_bigrams) continue;
      const lengths = [nonspace(left.text), nonspace(right.text)],
        overlap = [...a].filter((s) => b.has(s)).length / Math.min(a.size, b.size);
      if (
        overlap < feature.overlap ||
        Math.min(...lengths) / Math.max(...lengths) < feature.minimum_length_ratio
      )
        continue;
      candidates.push({
        ...right,
        family: 'adjacent_overlap',
        strength: 1,
        overlap,
        related_sentences: [left],
      });
    }
    const count = candidates.length;
    return [
      candidates,
      {
        raw_matches: count,
        direct_evidence:
          (((feature.strength * count) / Math.max(1, sentences.length - 1)) * count) /
          (count + feature.repeat_prior),
      },
    ];
  }
  const chars = [...text.chars],
    exclusions: Span[] = quoteContext?.[feature.id] ?? matchSpans(feature._exclude_patterns, text);
  for (const [a, b] of exclusions) chars.fill(' ', a, b);
  const body = new Text(chars.join('')),
    first = matchSpans(feature._first_patterns, body);
  for (const [a, b] of matchSpans(feature._second_patterns, body)) {
    const parents = first.filter(
      ([, y]) =>
        a - y >= 0 &&
        a - y <= feature.maximum_gap &&
        [...new Pattern('[。！？!?\\n]', false).finditer(body.slice(y, a))].length <=
          feature.maximum_boundaries,
    );
    if (parents.length) {
      const x = parents.at(-1)![0];
      candidates.push({
        start: x,
        end: b,
        text: text.slice(x, b),
        family: 'limitation_then_help',
        strength: 1,
      });
    }
  }
  return [candidates, { raw_matches: candidates.length }];
}

function scoreCumulative(
  text: Text,
  feature: R,
  config: Rules,
  examples: number,
  locale: Language,
): R {
  const display = sentenceContexts(text),
    edges = config._window_edges ?? {};
  const sentences = display
    .filter(
      ([a, b]) =>
        !((a === 0 && edges.start_sentence) || (b === text.length && edges.end_sentence)) &&
        /[\u3400-\u9fff]/.test(text.slice(a, b)),
    )
    .map(([a, b]) => ({ start: a, end: b, text: text.slice(a, b) }));
  const [events, details] = cumulativeMeasure(text, feature, sentences, config._cumulative_quotes);
  const count = fsum(events.map((e) => e.strength ?? 1)),
    denominator = Math.max(nonspace(text.value), config.scoring.minimum_characters);
  const frequency = (count * config.scoring.frequency_unit) / denominator,
    ratio = frequency / feature.saturation_frequency,
    weight = effectiveWeight(feature, ratio, count);
  const evidence = details.direct_evidence ?? (weight * ratio) / (1 + ratio);
  for (const e of events) e.sentence = example(text, e.start, e.end, display).sentence;
  return {
    id: feature.id,
    name: feature.names[locale],
    note: feature.notes[locale],
    method: feature.method,
    evidence,
    equivalent_matches: count,
    sentence_count: sentences.length,
    frequency,
    normalization_characters: denominator,
    effective_weight: weight,
    weight: feature.weight,
    level_1_weight: feature.weight_levels[0].weight,
    level_2_weight: feature.weight_levels[1].weight,
    events,
    examples: slice(events, examples),
    ...details,
  };
}

function additionalFeatures(
  text: Text,
  config: Rules,
  examples: number,
  locale: Language,
  ruleResults: R[],
): R[] {
  const size = nonspace(text.value),
    sentences = sentenceContexts(text);
  const features: R[] = config.additional_features ?? [];
  return [
    ...features.filter((f) => !cumulativeMethods.has(f.method)),
    ...features.filter((f) => cumulativeMethods.has(f.method)),
  ].map((feature: R) => {
    if (feature.method === 'template_repetition')
      return scoreTemplate(text, feature, config, examples, locale);
    if (feature.method === 'self_disclosure')
      return scoreDisclosure(text, feature, config, ruleResults, examples, locale);
    if (cumulativeMethods.has(feature.method))
      return scoreCumulative(text, feature, config, examples, locale);
    if (feature.method === 'construction_repetition') {
      const result = constructionEvidence(text, feature);
      const events = result.pairs.map((pair: R) => {
        const l = pair.left,
          r = pair.right,
          sentence = {
            start: r.start,
            end: r.end,
            text: text.slice(r.start, r.end),
          },
          related = {
            start: l.start,
            end: l.end,
            text: text.slice(l.start, l.end),
          };
        return {
          ...sentence,
          sentence,
          related_sentence: related,
          similarity: pair.similarity,
          support: pair.support,
          matched_weight: pair.matched_weight,
          alignment: pair.alignment,
        };
      });
      return {
        ...result,
        id: feature.id,
        name: feature.names[locale],
        note: feature.notes[locale],
        method: feature.method,
        events,
        examples: slice(events, examples),
      };
    }
    const weighted =
      feature._type_weights &&
      (!Object.values(feature._type_weights).every((w) => w === 1) ||
        feature._phrase_buckets.length !== 1);
    const occupied: Span[] = [],
      selected: Array<[number, number, string]> = [];
    for (const p of (weighted ? feature._phrase_buckets : [feature._pattern]) as Pattern[])
      for (const m of p.finditer(text)) {
        if (weighted && occupied.some((s) => overlap(s, m.span()))) continue;
        const key = Object.keys(m.native.groups!).find(
          (k) => /^p\d+$/.test(k) && m.native.groups![k] !== undefined,
        )!;
        selected.push([m.start, m.end, feature.phrases[Number(key.slice(1))].id]);
        occupied.push(m.span());
      }
    if (weighted) selected.sort(tupleSort);
    const events: R[] = selected.map(([a, b, id]) => ({
      ...example(text, a, b, sentences),
      phrase_id: id,
      ...(weighted ? { match_weight: feature._type_weights[id] } : {}),
    }));
    const identities = new Set(selected.map((m) => m[2])),
      types = new Map<string, number>();
    if (weighted)
      for (const event of events) {
        const specification = feature.phrases.find((p: R) => p.id === event.phrase_id);
        if (specification.reported_weight !== undefined) {
          const c = (config._span_contexts ?? []).find(
            (c: R) =>
              c.id === 'attributed_statement' && c.start <= event.start && event.end <= c.end,
          );
          if (c) {
            event.base_match_weight = event.match_weight;
            event.match_weight = Math.min(specification.reported_weight, event.match_weight);
            event.reporting_context = c;
          }
        }
        for (const gid of feature._covered_by_rules[event.phrase_id] ?? []) {
          if (
            (ruleResults.find((g) => g.id === gid)?._scoring_matches ?? []).some(
              (m: R) => m.start <= event.start && event.end <= m.end && m.weight > 0,
            )
          ) {
            event.shared_rule = gid;
            event.base_match_weight = event.match_weight;
            event.match_weight = 0;
            break;
          }
        }
        types.set(event.phrase_id, Math.max(types.get(event.phrase_id) ?? 0, event.match_weight));
      }
    const count = weighted ? fsum(types.values()) : identities.size,
      frequency = (1000 * count) / Math.max(size, 1);
    const evidence =
      feature.strength *
      -Math.expm1(-frequency / feature.frequency_saturation) *
      (count / (count + feature.count_prior)) *
      (count / (count + feature.type_prior));
    return {
      id: feature.id,
      name: feature.names[locale],
      note: feature.notes[locale],
      method: feature.method,
      raw_matches: selected.length,
      equivalent_matches: count,
      ...(weighted ? { raw_type_count: identities.size } : {}),
      normalization_characters: size,
      frequency,
      evidence,
      events,
      examples: slice(events, examples),
    };
  });
}

function evidenceScaling(
  text: Text,
  config: Rules,
  result: Result,
  examples: number,
  locale: Language,
): void {
  const options = config.evidence_scaling;
  if (!options) return;
  for (const kind of ['rules', 'additional_features'])
    for (const g of result[kind]) {
      const item = options[kind][String(g.id)];
      if (!item) continue;
      let factor = item.factor;
      const detail: R = { factor, unscaled_evidence: g.evidence };
      for (const c of item.contexts ?? []) {
        const spans = matchSpans(c._patterns, text);
        if (spans.length) {
          factor = c.factor;
          detail.context = {
            id: c.id,
            name: c.names[locale],
            match_count: spans.length,
            matches: slice(spans, examples).map(([a, b]) => ({
              start: a,
              end: b,
              text: text.slice(a, b),
            })),
          };
          break;
        }
      }
      detail.factor = factor;
      if (item.repetition) {
        const count = g.positive_count,
          r = item.repetition,
          support = Math.max(0, count - r.skip_first) / (count + r.count_prior);
        factor *= 1 + r.increment * support;
        Object.assign(detail, {
          factor,
          repetition_count: count,
          repetition_support: support,
        });
      }
      g.evidence *= factor;
      g.evidence_scaling = detail;
      if ('effective_weight' in g) {
        g.unscaled_effective_weight = g.effective_weight;
        g.effective_weight *= factor;
      }
    }
  result.evidence_sum = fsum(
    ['rules', 'interactions', 'additional_features'].flatMap((kind) =>
      result[kind].map((g: R) => g.evidence),
    ),
  );
  result.score = round(100 * -Math.expm1(-result.evidence_sum / config.scoring.evidence_scale), 2);
  result.decision_threshold = 30;
  result.positive = result.score > 30;
}

function cadence(text: Text, config: Rules): R {
  const options = config.candidate_scoring.cadence,
    density = config.rules.find((g) => g.id === 3)!.density,
    edges = config._window_edges ?? {},
    lengths: number[] = [];
  for (const [a, b] of splitSpans(text, 0, text.length, density._paragraph_separator)) {
    if (
      !density._sentence_separator.search(text, a, b) &&
      !density._clause_separator.search(text, a, b)
    )
      continue;
    for (const [x, y] of splitSpans(text, a, b, density._sentence_separator)) {
      if ((x === 0 && edges.start_sentence) || (y === text.length && edges.end_sentence)) continue;
      const n = nonspace(text.slice(x, y));
      if (n) lengths.push(n);
    }
  }
  const n = lengths.length;
  if (n < options.minimum_sentences)
    return {
      sentence_count: n,
      sample_cv: null,
      signal: 0,
      reliability: 0,
      factor: 1,
    };
  const total = sum(lengths),
    squares = sum(lengths.map((x) => x * x));
  const variation = Math.sqrt((n * squares - total * total) / (n * (n - 1))) / (total / n);
  const signal = Math.max(-1, Math.min(1, (options.center_cv - variation) / options.cv_half_width)),
    supported = Math.min(n, options.reliability_cap),
    reliability = (supported - 1) / (supported + options.reliability_prior);
  return {
    sentence_count: n,
    sample_cv: variation,
    signal,
    reliability,
    factor: Math.max(options.minimum_factor, 1 + options.strength * reliability * signal),
  };
}

export function detectWindow(
  value: string,
  config: Rules,
  examples = 3,
  requested: string = 'zh-Hant',
): Result {
  const locale = resolveLanguage(requested);
  if (examples < 0) throw new Error(detectorMessages[locale].engine.examples_error);
  const text = new Text(value),
    size = nonspace(value);
  if (!size) throw new Error(detectorMessages[locale].engine.empty_text);
  const sentences = sentenceContexts(text),
    settings = config.scoring,
    denominator = Math.max(size, settings.minimum_characters),
    multiplier = settings.frequency_unit / denominator,
    edges = config._window_edges ?? {};
  const primitive: Primitive = new Map(),
    eventDetails: Details = new Map(),
    closingDetails: Details = new Map();
  for (const group of config.rules) {
    if ((group.method ?? 'regex') !== 'regex') continue;
    const excluded = matchSpans(group._exclude_spans, text);
    const values = {
      positive: matchSpans(group._positive, text, excluded),
      negative: matchSpans(group._negative, text, excluded),
    };
    if (group.match_units) {
      const [spans, details] = anchoredMatches(text, group, excluded);
      values.positive = spans;
      eventDetails.set(group.id, details);
    }
    if (group.closing_candidates) {
      const [spans, details] = closingMatches(text, group, values.positive, edges, excluded);
      values.positive = spans;
      closingDetails.set(group.id, details);
    }
    primitive.set(group.id, values);
  }
  const weights: Weights = new Map();
  for (const group of config.rules) {
    const values = primitive.get(group.id);
    if (!values) continue;
    const scaling = group.match_scaling,
      ws = new Map<string, number>();
    weights.set(group.id, ws);
    for (const [a, b] of values.positive) {
      const fragment = text.slice(a, b);
      const weak =
        scaling &&
        scaling._patterns.some((p: Pattern) => p.search(fragment)) &&
        !scaling._unless_patterns.some((p: Pattern) =>
          p.search(example(text, a, b, sentences).sentence.text),
        );
      let weight = weak ? scaling.factor : 1;
      if (closingDetails.has(group.id))
        weight *= closingDetails.get(group.id)!.get(spanKey([a, b]))!.factor;
      ws.set(spanKey([a, b]), weight);
    }
  }
  const local: Details = new Map();
  for (const g of config.rules)
    if (g.local_scoring)
      local.set(g.id, localScoring(text, g, primitive.get(g.id)!.positive, weights.get(g.id)!));
  refinements(text, config, primitive, weights, local, eventDetails, sentences);
  applySpanMatches(config, primitive, weights, local);
  const structures = new Map<number, R>(),
    openings = new Map<number, R>(),
    sequencesByRule = new Map<number, R>(),
    results: R[] = [];
  for (const group of config.rules) {
    let structure: R | undefined;
    let spans: { positive: Span[]; negative: Span[] };
    let pos: number, neg: number;
    if (group.method === 'logic_surge') {
      structure = logicSurges(
        text,
        { ...group, _span_contexts: config._span_contexts ?? [] },
        edges,
      );
      structures.set(group.id, structure);
      spans = {
        positive: structure.counted.map((e: R) => [e.start, e.end]),
        negative: [],
      };
      pos = structure.frequency;
      neg = 0;
    } else {
      spans = primitive.get(group.id)!;
      pos = sum(spans.positive.map((s) => weights.get(group.id)!.get(spanKey(s))!)) * multiplier;
      neg = spans.negative.length * multiplier;
    }
    const net = Math.max(0, pos - group.negative_weight * neg);
    let ratio = net / group.saturation_frequency,
      tierCount = structure
        ? (structure.support_count ?? spans.positive.length)
        : sum(spanValues(weights.get(group.id)!));
    let templates: R | undefined, sequences: R | undefined;
    if (group.paragraph_patterns) {
      templates = paragraphTemplates(text, group.paragraph_patterns, edges);
      openings.set(group.id, templates);
      const r = templates.frequency / group.paragraph_patterns.saturation_frequency;
      if (r > ratio) {
        ratio = r;
        tierCount = templates.matched_paragraphs;
      }
    }
    if (group.sequence_patterns) {
      const extensions = config.interactions.filter(
        (e) => e.kind === 'sequence_extension' && e.config.target_rule === group.id,
      );
      sequences = sequenceTemplates(text, group.sequence_patterns, extensions, primitive, weights);
      sequencesByRule.set(group.id, sequences);
      const r = sequences.frequency / group.sequence_patterns.saturation_frequency;
      if (r > ratio) {
        ratio = r;
        tierCount = sequences.matched_paragraphs;
      }
    }
    let applied = effectiveWeight(group, ratio, tierCount),
      families: R[] | undefined;
    if (!structure)
      [applied, families] = familyEffectiveWeight(
        text,
        group,
        spans.positive,
        weights.get(group.id)!,
        local.get(group.id) ?? new Map(),
        ratio,
        applied,
        locale,
        config.windowing._paragraph_separator,
      );
    const evidence = (applied * ratio) / (1 + ratio);
    const result: R = {
      id: group.id,
      name: group.names[locale],
      positive_count: spans.positive.length,
      negative_count: spans.negative.length,
      positive_frequency: pos,
      negative_frequency: neg,
      net_frequency: net,
      evidence,
      weight: group.weight,
      effective_weight: applied,
      level_1_weight: group.weight_levels[0].weight,
      level_2_weight: group.weight_levels[1].weight,
      weight_frequency_ratio: ratio,
      note: group.notes[locale],
      examples: Object.fromEntries(
        ['positive', 'negative'].map((p) => [
          p,
          slice(spans[p as 'positive' | 'negative'], examples).map(([a, b]) =>
            example(text, a, b, sentences),
          ),
        ]),
      ),
    };
    if (families !== undefined) result.frequency_families = families;
    if (!structure)
      result._scoring_matches = spans.positive.map(([a, b]) => ({
        start: a,
        end: b,
        weight: weights.get(group.id)!.get(spanKey([a, b])),
      }));
    result.frequency_unit = structure ? 100 : settings.frequency_unit;
    result.normalization_denominator = structure
      ? Math.max(structure.paragraphs.length, group.density.minimum_paragraphs)
      : denominator;
    result.frequency_basis = structure ? 'paragraph_strength_percent' : 'matches_per_characters';
    if (structure) {
      result.paragraph_count = structure.paragraphs.length;
      result.sentence_surge_count = sum(
        structure.paragraphs.map((p: R) => p.sentence_events.length),
      );
      result.paragraph_surge_count = sum(
        structure.paragraphs.map((p: R) => Number(p.paragraph_event !== null)),
      );
      result.density_events = slice(
        structure.paragraphs.flatMap((p: R) => [
          ...p.sentence_events,
          ...(p.paragraph_event ? [p.paragraph_event] : []),
        ]),
        examples,
      );
      result.counted_events = slice(structure.counted, examples);
      if (structure.support_count !== undefined) {
        result.repetition_support_count = structure.support_count;
        result.tier_support_count = tierCount;
        result.repetition_support_events = slice(structure.support_events, examples);
      }
    } else {
      result.positive_weighted_count = sum(spanValues(weights.get(group.id)!));
      for (const e of result.examples.positive) {
        const key = spanKey([e.start, e.end]);
        e.match_weight = weights.get(group.id)!.get(key);
        const detail = local.get(group.id)?.get(key),
          identity = eventDetails.get(group.id)?.get(key),
          closing = closingDetails.get(group.id)?.get(key);
        if (detail !== undefined) e.local_scoring = detail;
        if (identity !== undefined) e.event_identity = identity;
        if (closing !== undefined) e.closing_scoring = closing;
      }
    }
    if (templates)
      result.paragraph_templates = {
        ...templates,
        events: slice(templates.events, examples),
      };
    if (sequences)
      result.sequence_templates = {
        ...sequences,
        events: slice(sequences.events, examples),
      };
    results.push(result);
  }
  const interactions = evaluateInteractions(
    text,
    config,
    sentences,
    primitive,
    structures,
    openings,
    sequencesByRule,
    multiplier,
    examples,
    locale,
    weights,
  );
  let rhythm: R | undefined;
  if (config.candidate_scoring) {
    rhythm = cadence(text, config);
    const eligible = new Set(config.candidate_scoring.cadence.eligible_rules);
    for (const g of results)
      if (eligible.has(g.id)) {
        g.unmodified_evidence = g.evidence;
        g.cadence_multiplier = rhythm.factor;
        g.evidence *= rhythm.factor;
      }
  }
  const extras = additionalFeatures(text, config, examples, locale, results);
  for (const g of results) delete g._scoring_matches;
  const evidence =
    fsum(results.map((g) => g.evidence)) +
    fsum(interactions.map((g) => g.evidence)) +
    fsum(extras.map((g) => g.evidence));
  const score = round(100 * -Math.expm1(-evidence / settings.evidence_scale), 2);
  const result: Result = {
    language: locale,
    score,
    characters: size,
    normalization_characters: denominator,
    frequency_unit: settings.frequency_unit,
    evidence_sum: evidence,
    score_description: message(locale, 'score_description'),
    short_text: size < settings.minimum_characters,
    rules: results,
    interactions,
    additional_features: extras,
  };
  if (rhythm)
    Object.assign(result, {
      cadence: rhythm,
      decision_threshold: 30,
      positive: score > 30,
    });
  evidenceScaling(text, config, result, examples, locale);
  return result;
}

export function scoringWindows(text: Text, options: R): Array<[number, number, R]> {
  const target = options.target_characters,
    minimum = options.minimum_characters,
    positions = text.chars.flatMap((c, i) => (isSpace(c) ? [] : [i]));
  const count = (a: number, b: number): number =>
    bisectLeft(positions, b) - bisectLeft(positions, a);
  if (positions.length <= minimum) return [[0, text.length, {}]];
  const paragraphs = splitSpans(text, 0, text.length, options._paragraph_separator),
    units: any[][] = [],
    limit = Math.max(1, target - minimum);
  for (const [pa, pb] of paragraphs) {
    if (count(pa, pb) <= limit) {
      units.push([pa, pb, pa, pb, false, false]);
      continue;
    }
    for (let [sa, sb] of sentenceContexts(new Text(text.slice(pa, pb)))) {
      sa += pa;
      sb += pa;
      if (count(sa, sb) <= limit) units.push([sa, sb, pa, pb, false, false]);
      else {
        const left = bisectLeft(positions, sa),
          right = bisectLeft(positions, sb);
        for (let i = left; i < right; i += limit) {
          const a = i === left ? sa : positions[i],
            b = i + limit >= right ? sb : positions[i + limit];
          units.push([a, b, pa, pb, a !== sa, b !== sb]);
        }
      }
    }
  }
  const packed: any[][] = [];
  for (const unit of units) {
    const last = packed.at(-1);
    if (last && last[2] === unit[2] && last[3] === unit[3] && count(last[0], unit[1]) <= limit)
      packed[packed.length - 1] = [last[0], unit[1], unit[2], unit[3], last[4], unit[5]];
    else packed.push(unit);
  }
  const cumulative = [0];
  for (const u of packed) cumulative.push(cumulative.at(-1)! + count(u[0], u[1]));
  const selected = new Map<string, Span>();
  for (let i = 0; i < packed.length; i += 1) {
    let j = bisectRight(cumulative, cumulative[i] + target) - 1;
    if (cumulative[j] - cumulative[i] >= minimum) selected.set(spanKey([i, j - 1]), [i, j - 1]);
    j = bisectLeft(cumulative, cumulative[i + 1] - target);
    if (cumulative[i + 1] - cumulative[j] >= minimum) selected.set(spanKey([j, i]), [j, i]);
  }
  return [...selected.values()].sort(spanSort).map(([first, last]) => {
    const left = packed[first],
      right = packed[last];
    return [
      left[0],
      right[1],
      {
        start_paragraph: left[0] !== left[2],
        end_paragraph: right[1] !== right[3],
        start_sentence: left[4],
        end_sentence: right[5],
      },
    ];
  });
}

export function shiftOffsets(value: any, offset: number, seen = new Set<any>()): void {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const child of value) shiftOffsets(child, offset, seen);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (
      ['start', 'end', 'previous_start', 'previous_end', 'context_start', 'context_end'].includes(
        key,
      ) &&
      Number.isInteger(child)
    )
      value[key] = (child as number) + offset;
    else shiftOffsets(child, offset, seen);
  }
}

export function detect(
  value: string,
  config: Rules,
  examples = 3,
  requested: string = 'zh-Hant',
  onWindow?: (result: Result, window: R) => void,
): Result {
  const locale = resolveLanguage(requested);
  if (examples < 0) throw new Error(detectorMessages[locale].engine.examples_error);
  const text = new Text(value),
    size = nonspace(value);
  if (!size) throw new Error(detectorMessages[locale].engine.empty_text);
  const candidates = scoringWindows(text, config.windowing),
    cache = new Map<
      string,
      { score: number; evidence: number; characters: number; detail?: Result }
    >(),
    summaries: R[] = [];
  const disclosures = Object.fromEntries(
    (config.additional_features ?? [])
      .filter((f: R) => f.method === 'self_disclosure')
      .map((f: R) => [f.id, disclosureEvents(text, f)]),
  );
  const quotes = Object.fromEntries(
    (config.additional_features ?? [])
      .filter((f: R) => f.method === 'linked_expressions')
      .map((f: R) => [f.id, matchSpans(f._exclude_patterns, text)]),
  );
  const spanContexts = textSpanContexts(text, config);
  const contextsAt = (start: number, end: number): R => ({
    _disclosure_contexts: disclosureWindow(disclosures, start, end),
    _cumulative_quotes: Object.fromEntries(
      Object.entries(quotes).map(([id, spans]) => [
        id,
        (spans as Span[])
          .filter(([a, b]) => a < end && b > start)
          .map(([a, b]) => [Math.max(0, a - start), Math.min(end - start, b - start)]),
      ]),
    ),
    _span_contexts: windowSpanContexts(spanContexts, start, end),
  });
  let best: [number, number, number, R] | undefined;
  for (const [start, end, edges] of candidates) {
    const context = contextsAt(start, end);
    const snippet = text.slice(start, end),
      key = JSON.stringify([
        snippet,
        Object.entries(edges).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        context,
      ]);
    if (!cache.has(key)) {
      const r = detectWindow(
        snippet,
        { ...config, _window_edges: edges, ...context },
        onWindow ? examples : 0,
        locale,
      );
      cache.set(key, {
        score: r.score,
        evidence: r.evidence_sum,
        characters: r.characters,
        ...(onWindow ? { detail: r } : {}),
      });
    }
    const entry = cache.get(key)!;
    const window = {
      start,
      end,
      characters: entry.characters,
      score: entry.score,
      partial_edges: edges,
    };
    summaries.push(window);
    if (!best || entry.evidence > best[0]) best = [entry.evidence, start, end, edges];
    if (onWindow) {
      const r = structuredClone(entry.detail!);
      shiftOffsets(r, start);
      onWindow(r, window);
    }
  }
  if (!best)
    throw new Error(message(locale, 'density_error', { field: 'no valid scoring window' }));
  const [, start, end, edges] = best;
  const result = detectWindow(
    text.slice(start, end),
    { ...config, _window_edges: edges, ...contextsAt(start, end) },
    examples,
    locale,
  );
  result.span_contexts = slice(
    windowSpanContexts(spanContexts, start, end).map((e) => ({
      ...e,
      text: text.slice(start + e.start, start + e.end),
    })),
    examples,
  );
  shiftOffsets(result, start);
  Object.assign(result, {
    document_characters: size,
    scoring_window: {
      start,
      end,
      characters: result.characters,
      partial_edges: edges,
    },
    window_count: candidates.length,
    evaluated_window_count: cache.size,
    window_scores: summaries,
    aggregation: 'maximum_substantial_window',
  });
  return result;
}
