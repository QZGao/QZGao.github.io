import messages from './i18n.json';
import { Pattern } from './python-compat';
import type { Language, RecordValue as R, Rules } from './model';

export const detectorMessages = messages;
export const cumulativeMethods = new Set([
  'sentence_families',
  'subject_repetition',
  'clause_rhythm',
  'discourse_order',
  'adjacent_overlap',
  'linked_expressions',
]);
type MessageKey = keyof typeof messages.en.engine;
export const locales = Object.keys(detectorMessages) as Language[];
export function language(value: string): Language {
  const aliases: Record<string, Language> = {
    'zh-TW': 'zh-Hant',
    'zh-CN': 'zh-Hans',
    'zh-HK': 'yue-Hant',
    'yue-TW': 'yue-Hant',
    'yue-HK': 'yue-Hant',
    'yue-CN': 'yue-Hans',
  };
  const result = aliases[value] ?? value;
  if (!(result in detectorMessages))
    throw new Error(message('zh-Hant', 'locale_error', { language: value }));
  return result as Language;
}
export function message(locale: Language, key: MessageKey, values: R = {}): string {
  return detectorMessages[locale].engine[key].replace(
    /\{([^}:]+)(?::[^}]+)?\}/g,
    (_, name: string) =>
      name in values ? (values[name] === null ? 'None' : String(values[name])) : `{${name}}`,
  );
}
const object = (x: unknown): x is R => !!x && typeof x === 'object' && !Array.isArray(x);
const keys = (x: R, required: string[]): boolean => required.every((k) => k in x);

export function loadRules(input: unknown, requested: string = 'zh-Hant'): Rules {
  const locale = language(requested);
  const invalid = (field: string): never => {
    throw new Error(message(locale, 'density_error', { field }));
  };
  const number = (value: unknown, label: string, zero = false): number => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (!zero && value === 0))
      throw new Error(
        message(locale, 'number', {
          label,
          kind: detectorMessages[locale].engine[zero ? 'nonnegative' : 'positive_number'],
        }),
      );
    return value;
  };
  const integer = (value: unknown, label: string, minimum = 1): number => {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) invalid(label);
    return value as number;
  };
  const labels = (value: unknown, label: string): void => {
    if (!object(value) || locales.some((l) => typeof value[l] !== 'string' || !value[l].trim()))
      invalid(label);
  };
  const patterns = (list: unknown, id: unknown, field: string): Pattern[] => {
    if (!Array.isArray(list) || !list.length || list.some((p) => typeof p !== 'string' || !p))
      throw new Error(message(locale, 'patterns', { gid: id, polarity: field }));
    return (list as string[]).map((p, i) => {
      try {
        return new Pattern(p);
      } catch {
        throw new Error(
          message(locale, 'regex', {
            gid: id,
            polarity: field,
            index: i + 1,
            position: null,
          }),
        );
      }
    });
  };
  const separator = (cfg: R, key: string, id: unknown): void => {
    cfg[`_${key}`] = patterns([cfg[key]], id, key)[0];
    if (cfg[`_${key}`].search('')) invalid(key);
  };
  const config = structuredClone(input) as Rules;
  if (!Array.isArray(config.rules) || config.rules.length !== 24)
    throw new Error(detectorMessages[locale].engine.groups);
  const w = config.windowing;
  if (!object(w) || !keys(w, ['target_characters', 'minimum_characters', 'paragraph_separator']))
    invalid('windowing');
  integer(w.target_characters, 'windowing.target_characters');
  integer(w.minimum_characters, 'windowing.minimum_characters');
  if (!(
    Math.floor(w.target_characters / 2) < w.minimum_characters &&
    w.minimum_characters <= w.target_characters
  ))
    invalid('windowing length range');
  separator(w, 'paragraph_separator', 'windowing');
  const fragments = config.regex_fragments ?? {};
  if (!object(fragments)) invalid('regex_fragments');
  for (const [name, p] of Object.entries(fragments)) {
    if (
      !/^[A-Za-z_][A-Za-z_0-9]*$/.test(name) ||
      typeof p !== 'string' ||
      !p ||
      p.includes('{{') ||
      p.includes('}}')
    )
      invalid('regex_fragments');
  }
  const expand = (value: any): void => {
    if (Array.isArray(value)) {
      value.forEach(expand);
      return;
    }
    if (!object(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (
        [
          'positive',
          'negative',
          'patterns',
          'unless_patterns',
          'exclude_spans',
          'context_patterns',
        ].includes(key) &&
        Array.isArray(child)
      ) {
        value[key] = child.map((p) =>
          typeof p !== 'string'
            ? p
            : p.replace(/\{\{([A-Za-z_][A-Za-z_0-9]*)\}\}/g, (_, name: string) => {
                if (!(name in fragments)) invalid(`regex_fragments.${name}`);
                return `(?:${fragments[name]})`;
              }),
        );
      } else expand(child);
    }
  };
  expand(config.rules);
  expand(config.interactions);
  if (!object(config.scoring)) throw new Error(detectorMessages[locale].engine.scoring);
  for (const k of ['minimum_characters', 'frequency_unit', 'evidence_scale'])
    number(config.scoring[k], `scoring.${k}`);
  const tiers = (g: R): void => {
    const repeat = g.repetition_weighting;
    if (repeat !== undefined) {
      if (!object(repeat) || !keys(repeat, ['start_count', 'full_count']))
        invalid('repetition_weighting');
      number(repeat.start_count, 'start_count', true);
      number(repeat.full_count, 'full_count');
      if (repeat.full_count <= repeat.start_count) invalid('repetition_weighting ordering');
    }
    if (!Array.isArray(g.weight_levels) || g.weight_levels.length !== 2) invalid('weight_levels');
    let weight = g.weight;
    let end = 0;
    for (const t of g.weight_levels) {
      if (!object(t) || !keys(t, ['weight', 'start_ratio', 'full_ratio', 'count_prior']))
        invalid('weight_levels');
      for (const k of ['weight', 'start_ratio', 'full_ratio', 'count_prior'])
        number(t[k], `weight_levels.${k}`, ['weight', 'start_ratio'].includes(k));
      if (t.weight < weight || t.start_ratio < end || t.full_ratio <= t.start_ratio)
        invalid('weight_levels: ordering');
      weight = t.weight;
      end = t.full_ratio;
    }
  };
  const refinements = (g: R): void => {
    const list = g.match_refinements ?? [];
    if (!Array.isArray(list)) invalid('match_refinements');
    const ids = new Set();
    for (const p of list) {
      if (!object(p) || !keys(p, ['id', 'weight', 'patterns'])) invalid('match_refinements entry');
      if (typeof p.id !== 'string' || !p.id || ids.has(p.id)) invalid('match_refinements.id');
      ids.add(p.id);
      number(p.weight, 'match_refinements.weight', true);
      if (p.weight > 1 || !['sentence', 'paragraph'].includes(p.context_scope ?? 'sentence'))
        invalid('match_refinements.weight or scope');
      p._patterns = patterns(p.patterns, g.id, p.id);
      for (const k of ['unless_patterns', 'context_patterns', 'unless_context_patterns'])
        p[`_${k}`] = p[k]?.length ? patterns(p[k], g.id, k) : [];
    }
    if (g.shared_expression !== undefined) {
      const s = g.shared_expression;
      if (!object(s) || !keys(s, ['source_rule', 'weight'])) invalid('shared_expression');
      integer(s.source_rule, 'shared_expression.source_rule');
      if (s.source_rule > 24 || s.source_rule === g.id) invalid('shared_expression.source_rule');
      number(s.weight, 'shared_expression.weight', true);
      if (s.weight > 1) invalid('shared_expression.weight');
    }
  };
  for (const g of config.rules) {
    if (!object(g)) throw new Error(detectorMessages[locale].engine.group_object);
    integer(g.id, 'id', Number.MIN_SAFE_INTEGER);
    for (const k of ['weight', 'negative_weight', 'saturation_frequency'])
      number(g[k], `${g.id}.${k}`, k !== 'saturation_frequency');
    for (const k of ['names', 'notes']) labels(g[k], `${g.id}.${k}`);
    if (g.positive_subtypes !== undefined) {
      if ('positive' in g || !Array.isArray(g.positive_subtypes) || !g.positive_subtypes.length)
        invalid('positive_subtypes');
      g._positive_subtypes = {};
      g.positive = [];
      for (const s of g.positive_subtypes) {
        if (
          !object(s) ||
          !keys(s, ['id', 'patterns']) ||
          typeof s.id !== 'string' ||
          !s.id ||
          s.id in g._positive_subtypes
        )
          invalid('positive_subtypes entry');
        g._positive_subtypes[s.id] = patterns(s.patterns, g.id, s.id);
        g.positive.push(...s.patterns);
      }
    }
    const local = g.local_scoring;
    if (local !== undefined) {
      if (!object(local) || (g.method ?? 'regex') !== 'regex') invalid('local_scoring');
      if (['clause_families', 'fixed_families'].includes(local.method)) {
        if (
          !keys(local, [
            'method',
            'clause_separator',
            'base_factor',
            'cooccurrence_prior',
            'families',
            'default_family',
          ])
        )
          invalid('local_scoring');
        number(local.base_factor, 'base_factor', true);
        number(local.cooccurrence_prior, 'cooccurrence_prior');
        if (
          local.base_factor > 1 ||
          typeof local.default_family !== 'string' ||
          !local.default_family ||
          !Array.isArray(local.families) ||
          !local.families.length
        )
          invalid('local_scoring family');
        const ids = new Set([local.default_family]);
        for (const f of local.families) {
          if (
            !object(f) ||
            !keys(f, ['id', 'patterns', 'scale']) ||
            typeof f.id !== 'string' ||
            !f.id ||
            ids.has(f.id) ||
            typeof f.scale !== 'boolean' ||
            !['search', 'fullmatch'].includes(f.match ?? 'fullmatch')
          )
            invalid('local_scoring family');
          ids.add(f.id);
          f._patterns = patterns(f.patterns, g.id, f.id);
        }
      } else if (local.method === 'hedge_stack') {
        if (
          !keys(local, [
            'method',
            'clause_separator',
            'target_subtype',
            'hit_prior',
            'hit_power',
            'patterns',
          ]) ||
          !(local.target_subtype in (g._positive_subtypes ?? {}))
        )
          invalid('local_scoring');
        number(local.hit_prior, 'hit_prior');
        number(local.hit_power, 'hit_power');
        local._patterns = patterns(local.patterns, g.id, 'hedge words');
      } else invalid('local_scoring.method');
      separator(local, 'clause_separator', g.id);
      local._separator = local._clause_separator;
    }
    refinements(g);
    tiers(g);
    const template = g.paragraph_patterns;
    if (template !== undefined) {
      if (
        !object(template) ||
        !keys(template, [
          'position',
          'patterns',
          'minimum_paragraphs',
          'repeat_prior',
          'saturation_frequency',
          'paragraph_separator',
          'sentence_separator',
        ]) ||
        !['start', 'end'].includes(template.position)
      )
        invalid('paragraph_patterns');
      for (const k of ['minimum_paragraphs', 'repeat_prior', 'saturation_frequency'])
        number(template[k], k);
      for (const k of ['paragraph_separator', 'sentence_separator']) separator(template, k, g.id);
      template._patterns = patterns(template.patterns, g.id, 'paragraph_patterns');
    }
    const sequence = g.sequence_patterns;
    if (sequence !== undefined) {
      if (
        !object(sequence) ||
        !keys(sequence, [
          'paragraph_separator',
          'sentence_separator',
          'minimum_paragraphs',
          'repeat_prior',
          'saturation_frequency',
          'max_sentence_gap',
          'max_characters',
          'stages',
        ])
      )
        invalid('sequence_patterns');
      for (const k of ['minimum_paragraphs', 'repeat_prior', 'saturation_frequency'])
        number(sequence[k], k);
      for (const k of ['max_sentence_gap', 'max_characters']) integer(sequence[k], k);
      for (const k of ['paragraph_separator', 'sentence_separator']) separator(sequence, k, g.id);
      if (!Array.isArray(sequence.stages) || sequence.stages.length < 2) invalid('stages');
      const ids = new Set();
      for (const stage of sequence.stages) {
        if (
          !object(stage) ||
          !keys(stage, ['id', 'patterns']) ||
          typeof stage.id !== 'string' ||
          !stage.id ||
          ids.has(stage.id)
        )
          invalid('stage');
        ids.add(stage.id);
        stage._patterns = patterns(stage.patterns, g.id, stage.id);
      }
    }
    if (g.match_scaling !== undefined) {
      const s = g.match_scaling;
      if (!object(s) || !keys(s, ['patterns', 'unless_patterns', 'factor']))
        invalid('match_scaling');
      number(s.factor, 'match_scaling.factor', true);
      if (s.factor > 1) invalid('match_scaling.factor');
      for (const k of ['patterns', 'unless_patterns']) s[`_${k}`] = patterns(s[k], g.id, k);
    }
    g._exclude_spans = g.exclude_spans?.length
      ? patterns(g.exclude_spans, g.id, 'exclude_spans')
      : [];
    if (g.method === 'logic_surge') {
      const d = g.density;
      if (
        !object(d) ||
        !keys(d, [
          'paragraph_separator',
          'sentence_separator',
          'clause_separator',
          'minimum_unit_characters',
          'minimum_paragraphs',
          'delta_scale',
          'tail_density_scale',
          'hit_prior',
          'levels',
          'lexicon',
        ])
      )
        invalid('density');
      if (d.repetition_support !== undefined && d.repetition_support !== 'relative_event_strength')
        invalid('density.repetition_support');
      for (const k of [
        'minimum_unit_characters',
        'minimum_paragraphs',
        'delta_scale',
        'tail_density_scale',
        'hit_prior',
      ])
        number(d[k], k);
      for (const k of ['delta_power', 'hit_power']) number(d[k] ?? 1, k);
      for (const k of ['paragraph_separator', 'sentence_separator', 'clause_separator'])
        separator(d, k, g.id);
      if (!object(d.levels) || !keys(d.levels, ['sentence', 'paragraph']))
        invalid('density.levels');
      for (const level of ['sentence', 'paragraph']) {
        const l = d.levels[level];
        if (!object(l) || !keys(l, ['previous_units', 'tail_units'])) invalid('density.levels');
        integer(l.previous_units, 'previous_units');
        integer(l.tail_units, 'tail_units');
      }
      if (!Array.isArray(d.lexicon) || !d.lexicon.length) invalid('lexicon');
      const ids = new Set();
      for (const term of d.lexicon) {
        if (
          !object(term) ||
          !keys(term, ['id', 'weight', 'patterns']) ||
          typeof term.id !== 'string' ||
          !term.id ||
          ids.has(term.id)
        )
          invalid('lexicon');
        ids.add(term.id);
        number(term.weight, 'lexicon.weight');
        if (term.weight > 1) invalid('lexicon.weight');
        term._patterns = patterns(term.patterns, g.id, term.id);
      }
      if (d.attribution !== undefined) {
        const a = d.attribution;
        if (!object(a) || !keys(a, ['patterns', 'factor'])) invalid('attribution');
        number(a.factor, 'attribution.factor', true);
        if (a.factor > 1) invalid('attribution.factor');
        a._patterns = patterns(a.patterns, g.id, 'attribution');
        if (a._patterns.some((p: Pattern) => !p.groupNames.has('cue'))) invalid('attribution.cue');
      }
      continue;
    }
    if ((g.method ?? 'regex') !== 'regex') invalid('method');
    let total = 0;
    for (const k of ['positive', 'negative']) {
      if (!Array.isArray(g[k]) || g[k].some((p: unknown) => typeof p !== 'string' || !p))
        throw new Error(message(locale, 'patterns', { gid: g.id, polarity: k }));
      total += g[k].length;
      g[`_${k}`] = g[k].length ? patterns(g[k], g.id, k) : [];
    }
    if (!total) throw new Error(message(locale, 'empty_group', { gid: g.id }));
    if (g.match_units !== undefined) {
      const u = g.match_units;
      if (!object(u) || !['match', 'anchor'].includes(u.exclusion_target ?? 'match'))
        invalid('match_units');
      if (
        g._positive.some((p: Pattern) => !p.groupNames.has('anchor') || p.groupNames.has('_event'))
      )
        invalid('match_units.anchor');
      g._anchor_patterns = patterns(
        g._positive.map((p: Pattern) => `(?=(?P<_event>${p.pattern}))`),
        g.id,
        'anchor patterns',
      );
    }
    if (g.closing_candidates !== undefined) {
      const c = g.closing_candidates;
      if (
        !object(c) ||
        !keys(c, [
          'patterns',
          'paragraph_separator',
          'sentence_separator',
          'clause_separator',
          'max_characters',
          'ordinary_factor',
          'candidate_factor',
          'full_factor',
          'repeat_prior',
        ])
      )
        invalid('closing_candidates');
      for (const k of [
        'ordinary_factor',
        'candidate_factor',
        'full_factor',
        'repeat_prior',
        'max_characters',
      ])
        number(c[k], k, k.endsWith('factor'));
      if (c.candidate_factor > c.full_factor || c.full_factor > 1 || c.ordinary_factor > 1)
        invalid('closing_candidates factors');
      for (const k of ['paragraph_separator', 'sentence_separator', 'clause_separator'])
        separator(c, k, g.id);
      c._patterns = patterns(c.patterns, g.id, 'closing candidates');
    }
  }
  if (
    config.rules
      .map((g) => g.id)
      .sort((a, b) => a - b)
      .some((id, i) => id !== i + 1)
  )
    throw new Error(detectorMessages[locale].engine.ids);
  const byId = new Map(config.rules.map((g) => [g.id, g]));
  for (const g of config.rules)
    if (g.shared_expression && !byId.get(g.shared_expression.source_rule)?._anchor_patterns)
      invalid('shared_expression requires an anchored source');
  if (!Array.isArray(config.interactions)) invalid('interactions');
  const interactionIds = new Set();
  const extensions = new Set();
  for (const e of config.interactions) {
    if (
      !object(e) ||
      !keys(e, ['id', 'kind', 'names', 'config']) ||
      typeof e.id !== 'string' ||
      !/^[a-z][a-z0-9_]*$/.test(e.id) ||
      interactionIds.has(e.id)
    )
      invalid('interaction');
    interactionIds.add(e.id);
    labels(e.names, 'interaction.names');
    const c = e.config;
    if (!object(c)) invalid(e.id);
    let refs: number[] = [];
    if (e.kind === 'context') {
      if (
        !keys(c, [
          'contexts',
          'source_weights',
          'boundaries',
          'scoring',
          'distance_scale',
          'cooccurs_with_rules',
          'max_distance',
        ])
      )
        invalid('context_combination');
      integer(c.max_distance, 'max_distance', 0);
      number(c.distance_scale, 'distance_scale');
      refs = c.cooccurs_with_rules;
      if (
        !Array.isArray(refs) ||
        !refs.length ||
        new Set(refs).size !== refs.length ||
        !object(c.source_weights) ||
        refs.some((id: number) => !(String(id) in c.source_weights))
      )
        invalid('context_combination.sources');
      for (const id of refs) number(c.source_weights[String(id)], 'source weight', true);
      for (const [field, scalar] of [
        ['contexts', 'weight'],
        ['boundaries', 'factor'],
      ]) {
        if (!Array.isArray(c[field]) || (field === 'contexts' && !c[field].length)) invalid(field);
        for (const entry of c[field]) {
          if (!object(entry) || !keys(entry, ['patterns', scalar])) invalid(field);
          number(entry[scalar], field, true);
          if (scalar === 'factor' && entry[scalar] > 1) invalid('boundary factor');
          entry._patterns = patterns(entry.patterns, e.id, field);
        }
      }
    } else if (e.kind === 'tail_surge') {
      if (
        !keys(c, [
          'surge_rule',
          'source_rule',
          'source_weight',
          'deduplication_group',
          'minimum_paragraphs',
          'scoring',
        ]) ||
        byId.get(c.surge_rule)?.method !== 'logic_surge' ||
        typeof c.deduplication_group !== 'string' ||
        !c.deduplication_group
      )
        invalid(e.id);
      number(c.source_weight, e.id, true);
      refs = [c.source_rule];
    } else if (e.kind === 'opening_closing') {
      if (
        !keys(c, [
          'opening_rule',
          'closing_rule',
          'minimum_paragraphs',
          'repeat_prior',
          'scoring',
        ]) ||
        byId.get(c.opening_rule)?.paragraph_patterns?.position !== 'start' ||
        byId.get(c.closing_rule)?.method !== 'logic_surge'
      )
        invalid(e.id);
      number(c.repeat_prior, e.id);
    } else if (e.kind === 'sequence_extension') {
      const stages = byId.get(c.target_rule)?.sequence_patterns?.stages;
      if (
        !keys(c, ['target_rule', 'stage', 'source_rules']) ||
        !stages?.some((s: R) => s.id === c.stage)
      )
        invalid(e.id);
      const key = `${c.target_rule}:${c.stage}`;
      if (extensions.has(key)) invalid(`${e.id}.duplicate stage extension`);
      extensions.add(key);
      refs = c.source_rules;
      if (!Array.isArray(refs) || !refs.length || new Set(refs).size !== refs.length)
        invalid(`${e.id}.source_rules`);
    } else invalid('interaction.kind');
    if (
      refs.some(
        (id) =>
          !Number.isInteger(id) || !byId.has(id) || (byId.get(id)?.method ?? 'regex') !== 'regex',
      )
    )
      invalid(`${e.id}.primitive sources`);
    if (e.kind !== 'sequence_extension') {
      if (e.kind !== 'context') number(c.minimum_paragraphs, e.id);
      if (
        !object(c.scoring) ||
        !keys(c.scoring, ['weight', 'weight_levels', 'saturation_frequency'])
      )
        invalid(`${e.id}.scoring`);
      number(c.scoring.weight, e.id, true);
      number(c.scoring.saturation_frequency, e.id);
      tiers(c.scoring);
    }
  }
  const candidate = config.candidate_scoring;
  if (candidate) {
    const c = candidate.cadence,
      list = c.list_labels;
    for (const key of ['pattern', 'exclude_lead_in'])
      list[`_${key}`] = patterns([list[key]], 'cadence', key)[0];
    if (number(c.smoothstep_mix, 'cadence.smoothstep_mix', true) > 1)
      invalid('cadence.smoothstep_mix');
    integer(list.minimum_run, 'cadence.list_labels.minimum_run');
    const n = candidate.negative_subtypes;
    byId.get(9)!.local_scoring = {
      method: 'candidate_negative_subtypes',
      factors: n.factors,
      _subtypes: Object.fromEntries(
        Object.entries(n.patterns).map(([name, value]) => [name, patterns(value, 9, name)]),
      ),
    };
    if (n.context) {
      if (
        !keys(n.context, ['previous_prefix', 'sentence_separator', 'maximum_characters']) ||
        typeof n.context.previous_prefix !== 'string' ||
        !n.context.previous_prefix
      )
        invalid('negative_subtypes.context');
      integer(n.context.maximum_characters, 'negative_subtypes.context.maximum_characters');
      byId.get(9)!.local_scoring.context = {
        ...n.context,
        _separator: patterns([n.context.sentence_separator], 9, 'negative context separator')[0],
      };
    }
  }
  if (config.additional_features !== undefined && !Array.isArray(config.additional_features))
    invalid('additional_features');
  const featureIds = new Set();
  for (const f of config.additional_features ?? []) {
    if (!object(f) || typeof f.id !== 'string' || !f.id || featureIds.has(f.id))
      invalid('additional_features.id');
    featureIds.add(f.id);
    labels(f.names, `${f.id}.names`);
    labels(f.notes, `${f.id}.notes`);
    if (f.method === 'phrase_type_density') {
      for (const k of ['strength', 'frequency_saturation', 'count_prior', 'type_prior'])
        number(f[k], `${f.id}.${k}`);
      if (!Array.isArray(f.phrases) || !f.phrases.length) invalid(`${f.id}.phrases`);
      const ids = new Set();
      for (const p of f.phrases) {
        if (!object(p) || typeof p.id !== 'string' || !p.id || ids.has(p.id))
          invalid(`${f.id}.phrases.id`);
        ids.add(p.id);
        if (patterns([p.pattern], f.id, 'pattern')[0].search(''))
          invalid(`${f.id}.phrases.empty_match`);
      }
      f._pattern = patterns(
        [f.phrases.map((p: R, i: number) => `(?P<p${i}>${p.pattern})`).join('|')],
        f.id,
        'combined_pattern',
      )[0];
      f._pattern = new Pattern(f._pattern.pattern, false);
      f._type_weights = {};
      f._covered_by_rules = {};
      const buckets = new Map<string, { priority: number; weight: number; patterns: string[] }>();
      f.phrases.forEach((p: R, i: number) => {
        const weight = number(p.weight ?? 1, `${f.id}.phrase.weight`),
          priority = integer(p.priority ?? 0, `${f.id}.phrase.priority`, 0);
        f._type_weights[p.id] = weight;
        f._covered_by_rules[p.id] = p.covered_by_rules ?? [];
        if (
          !Array.isArray(f._covered_by_rules[p.id]) ||
          f._covered_by_rules[p.id].some((id: number) => !byId.has(id))
        )
          invalid('covered_by_rules');
        if (
          p.reported_weight !== undefined &&
          number(p.reported_weight, 'reported_weight', true) > weight
        )
          invalid('reported_weight');
        const key = `${priority}:${weight}`;
        if (!buckets.has(key)) buckets.set(key, { priority, weight, patterns: [] });
        buckets.get(key)!.patterns.push(`(?P<p${i}>${p.pattern})`);
      });
      f._phrase_buckets = [...buckets.values()]
        .sort((a, b) => b.priority - a.priority || b.weight - a.weight)
        .map((bucket) => new Pattern(bucket.patterns.join('|'), false));
    } else if (f.method === 'construction_repetition') {
      for (const k of [
        'minimum_markers',
        'minimum_marker_types',
        'minimum_content_bigrams',
        'comparison_window',
        'lexical_window',
        'lexical_stride',
      ])
        integer(f[k], `${f.id}.${k}`);
      for (const k of ['strength', 'repetition_prior', 'novelty_width'])
        number(f[k], `${f.id}.${k}`);
      for (const k of ['similarity', 'maximum_content_overlap', 'novelty_start']) {
        number(f[k], `${f.id}.${k}`, true);
        if (f[k] > 1) invalid(`${f.id}.${k}`);
      }
      if (!Array.isArray(f.markers) || !f.markers.length) invalid(`${f.id}.markers`);
      const ids = new Set();
      for (const m of f.markers) {
        if (
          !object(m) ||
          typeof m.id !== 'string' ||
          !m.id ||
          ids.has(m.id) ||
          typeof m.informative !== 'boolean'
        )
          invalid(`${f.id}.markers`);
        ids.add(m.id);
        number(m.weight, `${f.id}.markers.weight`, true);
        if (['lexical', 'punctuation'].includes(m.id) && (m.weight || m.informative))
          invalid(`${f.id}.markers.non_evidence`);
        if (patterns([m.pattern], f.id, 'pattern')[0].search('')) invalid(`${f.id}.empty_match`);
      }
      f._han = patterns([f.han_pattern], f.id, 'han_pattern')[0];
      f._sentences = patterns([f.sentence_pattern], f.id, 'sentence_pattern')[0];
      if (f._han.search('') || f._sentences.search('')) invalid(`${f.id}.empty_match`);
      f._markers = patterns(
        [f.markers.map((m: R, i: number) => `(?P<m${i}>${m.pattern})`).join('|')],
        f.id,
        'combined_pattern',
      )[0];
    } else if (
      f.method === 'template_repetition' ||
      f.method === 'self_disclosure' ||
      cumulativeMethods.has(f.method)
    ) {
      number(f.weight, `${f.id}.weight`, true);
      number(f.saturation_frequency, `${f.id}.saturation_frequency`);
      tiers(f);
      if (f.method === 'template_repetition') {
        f._sentences = new Pattern(f.sentence_pattern, false);
        if (f._sentences.search('')) invalid(`${f.id}.sentence_pattern.empty_match`);
      }
      if (f.families !== undefined) {
        if (!Array.isArray(f.families) || !f.families.length) invalid(`${f.id}.families`);
        const ids = new Set();
        for (const family of f.families) {
          if (typeof family.id !== 'string' || !family.id || ids.has(family.id))
            invalid(`${f.id}.families.id`);
          ids.add(family.id);
          family._patterns = patterns(family.patterns, f.id, 'family');
          if (family._patterns.some((p: Pattern) => p.search('')))
            invalid(`${f.id}.families.empty_match`);
        }
      }
      if ('pattern' in f) {
        f._pattern = patterns([f.pattern], f.id, 'pattern')[0];
        if (f._pattern.search('')) invalid(`${f.id}.empty_pattern`);
      }
      if (f.roles !== undefined) {
        if (!object(f.roles) || !Object.keys(f.roles).length) invalid(`${f.id}.roles`);
        f._roles = Object.fromEntries(
          Object.entries(f.roles).map(([key, value]) => [key, new Pattern(value as string, false)]),
        );
        if (Object.values(f._roles).some((p: any) => p.search('')))
          invalid(`${f.id}.roles.empty_match`);
      }
      for (const key of ['first_patterns', 'second_patterns', 'exclude_patterns'])
        if (key in f) f[`_${key}`] = patterns(f[key], f.id, key);
      for (const key of [
        'minimum_clause_characters',
        'minimum_bigrams',
        'maximum_gap',
        'maximum_boundaries',
      ])
        if (key in f) integer(f[key], `${f.id}.${key}`, key.startsWith('maximum_') ? 0 : 1);
      for (const key of [
        'maximum_cv',
        'overlap',
        'minimum_length_ratio',
        'quoted_complement_weight',
      ])
        if (key in f && number(f[key], `${f.id}.${key}`, key === 'quoted_complement_weight') > 1)
          invalid(`${f.id}.${key}`);
      for (const key of ['strength', 'repeat_prior'])
        if (key in f) number(f[key], `${f.id}.${key}`);
      if (f.method === 'subject_repetition') integer(f.capture, `${f.id}.capture`);
      const required: R = {
        sentence_families: ['families'],
        subject_repetition: ['pattern', 'capture'],
        clause_rhythm: ['roles', 'minimum_clause_characters', 'maximum_cv'],
        discourse_order: ['roles', 'strength', 'repeat_prior'],
        adjacent_overlap: [
          'overlap',
          'minimum_bigrams',
          'minimum_length_ratio',
          'strength',
          'repeat_prior',
        ],
        linked_expressions: [
          'first_patterns',
          'second_patterns',
          'exclude_patterns',
          'maximum_gap',
          'maximum_boundaries',
        ],
      };
      if (required[f.method]?.some((key: string) => !(key in f)))
        invalid(`${f.id}.required_fields`);
      if (f.method === 'self_disclosure') {
        if (
          !Number.isInteger(f.source_rule) ||
          !byId.has(f.source_rule) ||
          config.additional_features.filter(
            (x: R) => x.method === f.method && x.source_rule === f.source_rule,
          ).length !== 1
        )
          invalid(`${f.id}.source_rule`);
        for (const key of [
          'identity_patterns',
          'capability_patterns',
          'exclude_patterns',
          'reporting_prefix_patterns',
        ]) {
          f[`_${key}`] = patterns(f[key], f.id, key);
          if (f[`_${key}`].some((p: Pattern) => p.search(''))) invalid(`${f.id}.${key}`);
        }
        f._boundaries = new Pattern(f.boundary_pattern, false);
        if (f._boundaries.search('')) invalid(`${f.id}.boundary_pattern`);
      }
    } else invalid(`${f.id}.method`);
  }
  for (const g of config.rules) {
    if (g.fallback_strength) {
      const f = g.fallback_strength;
      if (
        !keys(f, ['patterns', 'factor']) ||
        !g._anchor_patterns ||
        number(f.factor, 'fallback_strength.factor', true) > 1
      )
        invalid('fallback_strength');
      const selected = new Set(
        patterns(f.patterns, g.id, 'fallback_strength.patterns').map((p) => p.pattern),
      );
      if ([...selected].some((p) => !g._positive.some((x: Pattern) => x.pattern === p)))
        invalid('fallback_strength.patterns');
      g._primary_anchor_patterns = g._anchor_patterns.filter(
        (_: Pattern, i: number) => !selected.has(g._positive[i].pattern),
      );
    }
    const options = g.frequency_families;
    if (!options) continue;
    if (
      g.id !== 9 ||
      !keys(options, ['enabled', 'families']) ||
      typeof options.enabled !== 'boolean' ||
      !Array.isArray(options.families)
    )
      invalid('frequency_families');
    options._pooled_contexts = options.pooled_contexts?.length
      ? patterns(options.pooled_contexts, 9, 'pooled_contexts')
      : [];
    const ids = new Set();
    for (const f of options.families) {
      if (
        !keys(f, ['id', 'names', 'patterns', 'local_subtypes']) ||
        typeof f.id !== 'string' ||
        !f.id ||
        ids.has(f.id)
      )
        invalid('frequency_families.family');
      ids.add(f.id);
      labels(f.names, 'frequency_families.names');
      if (
        !Array.isArray(f.local_subtypes) ||
        f.local_subtypes.some(
          (s: string) => !['contrast', 'scalar', 'cognitive', 'qualification', 'other'].includes(s),
        )
      )
        invalid('frequency_families.local_subtypes');
      if ('question_sentence' in f && typeof f.question_sentence !== 'boolean')
        invalid('frequency_families.question_sentence');
      f._patterns = f.patterns.length ? patterns(f.patterns, 9, f.id) : [];
    }
  }
  const scaling = config.evidence_scaling;
  if (scaling !== undefined) {
    if (!object(scaling) || !keys(scaling, ['rules', 'additional_features']))
      invalid('evidence_scaling');
    for (const kind of ['rules', 'additional_features']) {
      const ids = new Set(config[kind].map((g: R) => String(g.id)));
      if (!object(scaling[kind])) invalid(`evidence_scaling.${kind}`);
      for (const [id, item] of Object.entries(scaling[kind]) as [string, R][]) {
        if (!ids.has(id) || !keys(item, ['factor'])) invalid('evidence_scaling.entry');
        number(item.factor, 'evidence_scaling.factor', true);
        for (const c of item.contexts ?? []) {
          if (!keys(c, ['id', 'names', 'patterns', 'factor'])) invalid('evidence_scaling.context');
          labels(c.names, 'evidence_scaling.context.names');
          number(c.factor, 'evidence_scaling.context.factor', true);
          c._patterns = patterns(c.patterns, id, 'evidence context');
        }
        if (item.repetition) {
          if (!keys(item.repetition, ['increment', 'skip_first', 'count_prior']))
            invalid('evidence_scaling.repetition');
          for (const k of ['increment', 'skip_first', 'count_prior'])
            number(item.repetition[k], k, k !== 'count_prior');
        }
      }
    }
  }
  if (!Array.isArray(config.span_contexts ?? [])) invalid('span_contexts');
  const contextIds = new Set();
  const contextFields: R = {
    attribution: ['maximum_characters', 'patterns'],
    question_echo: ['minimum_characters', 'minimum_distinct_questions'],
    scope_link: [
      'maximum_characters',
      'minimum_shared_trigrams',
      'scope_patterns',
      'limitation_patterns',
      'generic_terms',
    ],
    editorial_section: ['maximum_characters', 'patterns'],
    duplicate_passage: ['minimum_characters'],
  };
  for (const item of config.span_contexts ?? []) {
    if (
      !object(item) ||
      !contextFields[item.method] ||
      !keys(item, [
        'id',
        'method',
        'enabled',
        'factor',
        'rules',
        'names',
        ...contextFields[item.method],
      ]) ||
      typeof item.id !== 'string' ||
      !item.id ||
      contextIds.has(item.id) ||
      typeof item.enabled !== 'boolean'
    )
      invalid('span_contexts.entry');
    contextIds.add(item.id);
    labels(item.names, 'span_contexts.names');
    if (
      number(item.factor, 'span_contexts.factor', true) > 1 ||
      !Array.isArray(item.rules) ||
      !item.rules.length ||
      item.rules.some((id: number) => !byId.has(id))
    )
      invalid('span_contexts.rules/factor');
    for (const field of ['patterns', 'scope_patterns', 'limitation_patterns'])
      item[`_${field}`] = field in item ? patterns(item[field], item.id, field) : [];
    for (const field of [
      'maximum_characters',
      'minimum_characters',
      'minimum_distinct_questions',
      'minimum_shared_trigrams',
    ])
      if (field in item) integer(item[field], field);
    if (
      'generic_terms' in item &&
      (!Array.isArray(item.generic_terms) ||
        item.generic_terms.some((x: any) => typeof x !== 'string' || !x))
    )
      invalid('span_contexts.generic_terms');
  }
  if (config.reporting_names) {
    const n = config.reporting_names;
    if (!keys(n, ['enabled', 'patterns', 'reporting_suffix']) || typeof n.enabled !== 'boolean')
      invalid('reporting_names');
    n._patterns = patterns(n.patterns, 'reporting_names', 'patterns');
    if (n._patterns.some((p: Pattern) => !p.groupNames.has('name')))
      invalid('reporting_names.capture');
    patterns([n.reporting_suffix], 'reporting_names', 'suffix');
  }
  return config;
}
