import { DiscourseAnalysis, PragmaticChoice, PragmaticSelection } from './models/models';

/**
 * Pragmatic discriminants (xleplusglue docs/plans/PRAGMATIC_DISCRIMINANTS_PLAN.md, D1-D9, D2a,
 * and hiding readings by hand): the alternatives a discourse's PCDRS readings hold, grouped
 * into choice points, listed where they split the readings, and the narrowing a selection of
 * them makes. One procedure for analysis, chat and regression; GSWB computes every reading's
 * choices (D1), nothing here reads the printed PCDRS.
 */

export type PragmaticKind = PragmaticChoice['kind'];

/** One alternative as listed: held by the readings in `associatedSolutions` (reading ids). */
export interface PragmaticAlternative {
  /** The choice's id; a refinement's (D2a) adds the box and the semantic reading. */
  id: string;
  kind: PragmaticKind;
  point: string;
  label: string;
  associatedSolutions: string[];
  /** A refinement of an intermediate site: the id of the INTERMEDIATE alternative it refines,
   *  within `semanticOrigin` only, where state labels name the same box (D2a). */
  refines?: string;
  semanticOrigin?: string;
}

/** A pronoun or a p-box with the alternatives listed for it (D6). */
export interface PragmaticChoicePoint {
  kind: PragmaticKind;
  point: string;
  label: string;
  alternatives: PragmaticAlternative[];
}

export const NO_PRAGMATIC_SELECTION: PragmaticSelection = { choiceIds: [], hiddenReadingIds: [] };

/** Every alternative the readings hold, with the readings holding it; null when a reading has
 *  no choices (stored before them, or GSWB could not key them): then none is listed (D1). */
export function pragmaticAlternatives(readings: DiscourseAnalysis[]): PragmaticAlternative[] | null {
  if (!readings.length || readings.some(reading => !Array.isArray(reading.choices))) return null;
  const byId = new Map<string, PragmaticAlternative>();
  const hold = (id: string, make: () => Omit<PragmaticAlternative, 'associatedSolutions'>, reading: string) => {
    const alternative = byId.get(id) ?? { ...make(), associatedSolutions: [] };
    if (!alternative.associatedSolutions.includes(reading)) alternative.associatedSolutions.push(reading);
    byId.set(id, alternative);
  };
  readings.forEach(reading => reading.choices!.forEach(choice => {
    hold(choice.id, () => ({ id: choice.id, kind: choice.kind, point: choice.point, label: alternativeLabel(choice) }), reading.id);
    if (choice.target === 'INTERMEDIATE' && choice.site) {
      hold(refinementId(choice.id, choice.site, reading.semanticOrigin), () => ({
        id: refinementId(choice.id, choice.site!, reading.semanticOrigin),
        kind: choice.kind,
        point: choice.point,
        label: `${choice.siteLabel ?? 'box'} (${choice.site})`,
        refines: choice.id,
        semanticOrigin: reading.semanticOrigin,
      }), reading.id);
    }
  }));
  return [...byId.values()];
}

function refinementId(id: string, site: string, semanticOrigin: string): string {
  return `${id}:${site}@${semanticOrigin}`;
}

function alternativeLabel(choice: PragmaticChoice): string {
  switch (choice.resolution) {
    case 'ANTECEDENT': return choice.targetLabel;
    case 'UNBOUND': return 'unbound';
    case 'BOUND': return `bound to ${choice.targetLabel}`;
    default: return choice.targetLabel;
  }
}

/** The readings holding every selected alternative (D7); an id no alternative has (a stale
 *  selection) keeps nothing. Hidden readings are left to `withoutHidden`. */
export function narrowedByPragmatics(
  readings: DiscourseAnalysis[], alternatives: PragmaticAlternative[] | null, choiceIds: string[],
): DiscourseAnalysis[] {
  if (!choiceIds.length) return readings;
  const byId = new Map((alternatives ?? []).map(alternative => [alternative.id, alternative]));
  return readings.filter(reading => choiceIds.every(id => byId.get(id)?.associatedSolutions.includes(reading.id)));
}

export function withoutHidden<T extends { id: string }>(readings: T[], selection: PragmaticSelection | undefined): T[] {
  const hidden = new Set(selection?.hiddenReadingIds ?? []);
  return hidden.size ? readings.filter(reading => !hidden.has(reading.id)) : readings;
}

/** What a discourse's pragmatic selection leaves of `readings`, hidden readings excluded: what
 *  reaches the inference. The selection's alternatives are computed over every reading of the
 *  update, so narrowing a part of them (by scope, say) does not change what they mean. */
export function pragmaticSurvivors(
  update: { discourse: DiscourseAnalysis[]; pragmaticSelection?: PragmaticSelection },
  readings: DiscourseAnalysis[] = update.discourse,
): DiscourseAnalysis[] {
  const selection = update.pragmaticSelection;
  if (!selection || (!selection.choiceIds.length && !selection.hiddenReadingIds.length)) return readings;
  const narrowed = narrowedByPragmatics(readings, pragmaticAlternatives(update.discourse), selection.choiceIds);
  return withoutHidden(narrowed, selection);
}

/**
 * The choice points to list (D6, D2a): an alternative is listed iff some but not all of
 * `readings` hold it; a choice point iff one of its alternatives is. An intermediate site's
 * refinements are listed only while every survivor comes from one semantic reading, and then
 * only those that split that reading's readings: a reading not resolved semantically is not
 * resolved pragmatically either. A selected alternative is always listed, so it can be
 * deselected. Anaphora first, then presupposition; choice points in text
 * order; referents in text order, then unbound; sites global, intermediate (its refinements
 * after it, outer to inner), in situ.
 */
export function listedChoicePoints(
  readings: DiscourseAnalysis[], alternatives: PragmaticAlternative[] | null, survivors: { id: string }[],
  selectedIds: string[] = [],
): PragmaticChoicePoint[] {
  if (!alternatives) return [];
  const total = readings.length;
  const originOf = new Map(readings.map(reading => [reading.id, reading.semanticOrigin]));
  const origins = new Set(survivors.map(survivor => originOf.get(survivor.id)));
  const origin = origins.size === 1 ? [...origins][0] : undefined;
  const ofOrigin = origin === undefined ? 0 : readings.filter(reading => reading.semanticOrigin === origin).length;
  const listed = alternatives.filter(alternative => selectedIds.includes(alternative.id) || (alternative.refines
    ? alternative.semanticOrigin === origin && alternative.associatedSolutions.length < ofOrigin
    : alternative.associatedSolutions.length > 0 && alternative.associatedSolutions.length < total));

  const pointLabel = new Map<string, string>();
  readings.forEach(reading => (reading.choices ?? []).forEach(choice =>
    pointLabel.set(`${choice.kind}@${choice.point}`, choice.pointLabel)));
  const points = new Map<string, PragmaticChoicePoint>();
  listed.forEach(alternative => {
    const key = `${alternative.kind}@${alternative.point}`;
    const point = points.get(key) ?? { kind: alternative.kind, point: alternative.point, label: pointLabel.get(key) ?? alternative.point, alternatives: [] };
    point.alternatives.push(alternative);
    points.set(key, point);
  });
  const ordered = [...points.values()].sort((a, b) =>
    (a.kind === b.kind ? 0 : a.kind === 'ANAPHORA' ? -1 : 1) || compareSpans(a.point, b.point));
  ordered.forEach(point => point.alternatives.sort(compareAlternatives));
  return ordered;
}

/** The target of an alternative: what follows `=` in its id (a refinement: its box after it). */
function targetOf(alternative: PragmaticAlternative): string {
  const id = alternative.refines ?? alternative.id;
  return id.slice(id.indexOf('=') + 1);
}

const SITE_ORDER: Record<string, number> = { GLOBAL: 0, INTERMEDIATE: 1, LOCAL: 2 };

function compareAlternatives(a: PragmaticAlternative, b: PragmaticAlternative): number {
  const rank = (alternative: PragmaticAlternative) => {
    const target = targetOf(alternative);
    if (target in SITE_ORDER) return 2 + SITE_ORDER[target];
    return target === '/' ? 1 : 0;
  };
  const byRank = rank(a) - rank(b);
  if (byRank) return byRank;
  if (rank(a) === 0) return compareSpans(targetOf(a), targetOf(b));
  // The intermediate alternative before its refinements, these by their box, outer first.
  if (!a.refines !== !b.refines) return a.refines ? 1 : -1;
  return stateNumber(a.id) - stateNumber(b.id);
}

function stateNumber(id: string): number {
  const match = /:s(\d+)@/.exec(id);
  return match ? Number(match[1]) : -1;
}

/** Keys are spans ("17-24", "2-5,9-12", "s>t" for a several-referent binding): by first start. */
function compareSpans(a: string, b: string): number {
  const start = (key: string) => {
    const match = /^(\d+)-/.exec(key);
    return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
  };
  return start(a) - start(b) || a.localeCompare(b);
}
