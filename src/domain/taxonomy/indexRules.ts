import source from '../../../config/passive-rules.json';
import type { AssetClass } from './assetClass';

interface PassiveRule { id: string; asset_class: AssetClass; pattern: string; rationale: string }
const rules = (source.rules as PassiveRule[]).map((rule) => ({ ...rule, regex: new RegExp(rule.pattern, 'i') }));

export type PassiveClassification =
  | { assetClass: AssetClass; ruleId: string; flags: string[]; matchedRuleIds: string[] }
  | { assetClass: 'other'; ruleId: 'PASSIVE_AMBIGUOUS' | 'PASSIVE_UNMATCHED'; flags: string[]; matchedRuleIds: string[] };

/** Name matching is intentionally restricted to regulator-labelled passive families. */
export function classifyPassive(name: string): PassiveClassification {
  const matched = rules.filter((rule) => rule.regex.test(name));
  const matchedRuleIds = matched.map((rule) => rule.id);
  const classes = [...new Set(matched.map((rule) => rule.asset_class))];
  if (classes.length > 1) return { assetClass: 'other', ruleId: 'PASSIVE_AMBIGUOUS', flags: ['PASSIVE_AMBIGUOUS'], matchedRuleIds };
  if (!matched.length) return { assetClass: 'other', ruleId: 'PASSIVE_UNMATCHED', flags: ['PASSIVE_UNMATCHED'], matchedRuleIds: [] };
  const selected = matched[0]!;
  return { assetClass: selected.asset_class, ruleId: selected.id, flags: [], matchedRuleIds };
}
