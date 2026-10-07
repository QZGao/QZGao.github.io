/** JSON-driven rule/event records retain the Python result field names. */
export type Language = 'zh-Hant' | 'zh-Hans' | 'yue-Hant' | 'yue-Hans' | 'en';
// Heterogeneous rule methods are validated by loadRules before evaluation.
export type RecordValue = Record<string, any>;
export type Rules = RecordValue & {
  rules: RecordValue[];
  interactions: RecordValue[];
  scoring: RecordValue;
  windowing: RecordValue;
};
export type Result = RecordValue & {
  score: number;
  rules: RecordValue[];
  interactions: RecordValue[];
  additional_features: RecordValue[];
};
