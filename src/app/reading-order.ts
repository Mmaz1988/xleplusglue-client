import {
  AnaphoraAverager,
  AnaphoraRanking,
  DiscourseAnalysis,
  DiscourseUpdate,
  GswbDiscriminant,
  PragmaticProfile,
} from './models/models';

/** The criteria a discourse's readings can be ordered by (N4): surface alignment, the rows of the
 *  pragmatic profile matrix in their fixed priority, and the LM ranking. */
export const READING_CRITERIA = ['surface', 'pronouns', 'binding', 'accommodation', 'lm'] as const;
export type ReadingCriterion = typeof READING_CRITERIA[number];

const MATRIX_ROWS = ['pronouns', 'binding', 'accommodation'] as const;
type MatrixRow = typeof MATRIX_ROWS[number];

/** What a view orders a discourse's readings with: the discourse updates the readings belong
 *  to (their profiles and LM rankings), the scope discriminants of its sentences, and the
 *  session's averager. */
export interface ReadingOrderContext {
  updates: DiscourseUpdate[];
  discriminants: GswbDiscriminant[];
  averager: AnaphoraAverager;
}

/** The reading filters (N4): they hide readings; a hidden reading is never in the top k
 *  (`selectedReadingIds`). */
export const READING_FILTERS = ['unbound', 'accommodated'] as const;
export type ReadingFilter = typeof READING_FILTERS[number];

/** Whether a reading is hidden by a filter: an unbound pronoun, an accommodated presupposition.
 *  A reading without a profile is never hidden. */
export function hiddenByFilter(reading: DiscourseAnalysis, filter: ReadingFilter): boolean {
  const profile = reading.pragmaticProfile;
  if (!profile) return false;
  return filter === 'unbound'
    ? (profile.pronouns?.[2] ?? 0) > 0
    : (profile.accommodation ?? []).some(count => count > 0);
}

/** The criteria and filters that apply to these readings, for a context-sensitive panel:
 *  surface alignment where there are scope discriminants, a matrix row where some reading has
 *  a choice in it, the LM where a ranking exists; a filter where it would hide something. */
export function applicableReadingOptions(context: ReadingOrderContext): {
  criteria: ReadingCriterion[];
  filters: ReadingFilter[];
} {
  const readings = context.updates.flatMap(update => update.discourse);
  const rowUsed = (row: MatrixRow) => readings.some(reading =>
    (reading.pragmaticProfile?.[row] ?? []).some(count => count > 0));
  const criteria = READING_CRITERIA.filter(criterion => {
    if (criterion === 'surface') return context.discriminants.some(discriminant => discriminant.type === 'scope');
    if (criterion === 'lm') return context.updates.some(update => !!update.anaphoraRanking);
    return rowUsed(criterion);
  });
  const filters = READING_FILTERS.filter(filter => readings.some(reading => hiddenByFilter(reading, filter)));
  return { criteria, filters };
}

export const CRITERION_LABELS: Record<ReadingCriterion, string> = {
  surface: 'surface alignment',
  pronouns: 'pronouns',
  binding: 'presupposition binding',
  accommodation: 'accommodation',
  lm: 'LM ranking',
};

export const CRITERION_HINTS: Record<ReadingCriterion, string> = {
  surface: 'Prefers readings whose scope follows the word order: counts the scopings that go '
    + 'against the surface, fewer first.',
  pronouns: 'Structural, from the reading\'s pragmatic profile: more pronouns bound (in one complex '
    + 'condition with their antecedent) first, then referential ones; unbound pronouns last. The '
    + 'words play no role.',
  binding: 'Structural: presuppositions bound to an antecedent, the higher the site the better '
    + '(global, then intermediate, then local).',
  accommodation: 'Structural: accommodated presuppositions, the higher the site the better '
    + '(global, then intermediate, then local).',
  lm: 'Lexical: how plausible the language-model rankers (the session\'s ranker settings) find '
    + 'the chosen antecedents, compared across all readings.',
};

export const FILTER_HINTS: Record<ReadingFilter, string> = {
  unbound: 'Hides readings that leave a pronoun unbound, a(x,/).',
  accommodated: 'Hides readings that accommodate a presupposition. Proper names are usually '
    + 'accommodated.',
};

/** How the checked orderings combine, for the panel's heading. */
export const ORDER_HINT = 'Each checked ordering ranks the readings; the ranks are fused (Borda or '
  + 'RRF, as the session\'s ranker averager), so a reading better on every checked ordering comes '
  + 'first.';

/** What the view's top k keeps, for the k control. */
export const TOP_K_HINT = 'Keeps the readings on the first k places of the order, after the filters; '
  + 'tied readings share a place. In regression, what "Run inference" sends to Vampire for this item.';

export const FILTER_LABELS: Record<ReadingFilter, string> = {
  unbound: 'readings with an unbound pronoun',
  accommodated: 'readings with an accommodated presupposition',
};

/** A reading's place in the global order: 1 is best, tied readings share a place, and places
 *  are dense (1, 2, 2, 3), so k places hold every reading tied with the k-th. */
export interface ReadingPlace {
  id: string;
  place: number;
  /** The fused score the place comes from, in [0, 1]. */
  score: number;
}

const RRF_K = 60;
const EPSILON = 1e-9;

/** Per semantic reading id: how many scope discriminants it belongs to take scope against the
 *  surface order. Unknown alignment (`surfaceAligned` absent or null) is not counted. */
export function surfaceAgainstCounts(discriminants: GswbDiscriminant[]): Map<string, number> {
  const counts = new Map<string, number>();
  discriminants
    .filter(discriminant => discriminant.type === 'scope' && discriminant.surfaceAligned === false)
    .forEach(discriminant => (discriminant.associatedSolutions ?? [])
      .forEach(id => counts.set(id, (counts.get(id) ?? 0) + 1)));
  return counts;
}

/** A reading's scopings against the surface: a merged reading's id is the composite of its
 *  sentences' reading ids (`compositeAnalysisId`), each counted with its own discriminants. */
export function surfaceAgainst(semanticOrigin: string, counts: Map<string, number>): number {
  return semanticOrigin.split('+').reduce((sum, part) => sum + (counts.get(part) ?? 0), 0);
}

/** Compares two profiles over the checked matrix rows; negative when `a` is better. Rows go in
 *  their fixed priority; within a row more in the best column wins, then more in the next. A tie
 *  on the checked rows goes to fewer distinct columns used. A reading without a profile (an old
 *  document) comes after every reading with one. */
export function compareProfiles(
  a: PragmaticProfile | undefined,
  b: PragmaticProfile | undefined,
  rows: readonly MatrixRow[],
): number {
  if (!a || !b) return (a ? 0 : 1) - (b ? 0 : 1);
  for (const row of MATRIX_ROWS.filter(row => rows.includes(row))) {
    for (const column of [0, 1]) {
      const difference = (b[row]?.[column] ?? 0) - (a[row]?.[column] ?? 0);
      if (difference) return difference;
    }
  }
  const distinctColumns = (profile: PragmaticProfile) => rows
    .reduce((sum, row) => sum + (profile[row] ?? []).filter(count => count > 0).length, 0);
  return distinctColumns(a) - distinctColumns(b);
}

/** Competition ranks ("1224"): 1 + the number of items strictly better under `compare`, a
 *  total preorder (negative: `a` better, 0: tied). Sorted once, since a discourse can have
 *  a thousand readings. */
function competitionRanks<T>(items: T[], compare: (a: T, b: T) => number): number[] {
  const order = items.map((_, index) => index).sort((a, b) => compare(items[a], items[b]));
  const ranks = new Array<number>(items.length);
  order.forEach((index, position) => {
    const previous = order[position - 1];
    ranks[index] = position > 0 && compare(items[previous], items[index]) === 0 ? ranks[previous] : position + 1;
  });
  return ranks;
}

/** Higher first, missing last; equal values (two missing among them) tie. */
function descending(a: number | null, b: number | null): number {
  const left = a ?? -Infinity;
  const right = b ?? -Infinity;
  return left === right ? 0 : right - left;
}

/** Every reading's LM score across ALL readings of the discourse, from the rankings of its
 *  updates. lm ranks only within one
 *  semantic reading, so its combined `score` is not comparable across them (Borda and RRF are
 *  rank based); the rankers' own scores are, and are fused here over all readings the way lm's
 *  `fuse_branches` fuses within one. One ranker: its score. Null where no ranker scored. */
export function globalLmScores(rankings: AnaphoraRanking[], ids: string[]): Map<string, number | null> {
  const scores = new Map<string, number | null>(ids.map(id => [id, null]));
  // The discourse's updates are ranked with the session's rankers, so the first names them.
  const ranking = rankings[0];
  if (!ranking) return scores;
  const byId = new Map(rankings.flatMap(each => each.branches).map(branch => [branch.discourseId, branch]));
  const rankers = ranking.methods?.length ? ranking.methods : [ranking.method];
  // Old rankings carry only the combined score; read it as the one ranker's.
  const own = ids.map(id => {
    const branch = byId.get(id);
    return branch?.scores ? rankers.map(ranker => branch.scores![ranker] ?? null) : [branch?.score ?? null];
  });
  const m = own[0]?.length ?? 0;
  const n = ids.length;
  const ranks = Array.from({ length: m }, (_, r) =>
    competitionRanks(own.map(values => values[r]), descending));
  ids.forEach((id, i) => {
    const values = own[i];
    if (values.every(value => value === null)) return;
    if (m === 1) {
      scores.set(id, values[0]);
      return;
    }
    const averager = ranking.averager ?? 'borda';
    if (averager === 'weighted') {
      const weights = values.map((_, position) => m - position);
      scores.set(id, values.reduce((sum, value, r) => sum + weights[r] * (value ?? 0), 0)
        / weights.reduce((sum, weight) => sum + weight, 0));
      return;
    }
    scores.set(id, fuse(values.map((value, r) => value === null ? null : ranks[r][i]), n, averager));
  });
  return scores;
}

/** One combined score in [0, 1] from per-criterion ranks among n items, null meaning unranked
 *  (contributes 0). borda: the mean of (n - rank) / (n - 1); rrf: the sum of 1 / (60 + rank),
 *  scaled so first everywhere is 1. Both are monotone in every rank, so an item better on every
 *  criterion always scores higher. */
function fuse(ranks: (number | null)[], n: number, averager: AnaphoraAverager): number {
  const m = ranks.length;
  if (averager === 'rrf') {
    return ranks.reduce<number>((sum, rank) => sum + (rank === null ? 0 : 1 / (RRF_K + rank)), 0) / (m / (RRF_K + 1));
  }
  return ranks.reduce<number>((sum, rank) => sum + (rank === null ? 0 : n === 1 ? 1 : (n - rank) / (n - 1)), 0) / m;
}

/** One global order over every reading of a discourse, across its semantic readings (N4).
 *  Each checked criterion ranks the readings; the checked matrix rows are one criterion
 *  (`compareProfiles`). The ranks are fused with the session's averager, so a reading better on
 *  every checked criterion comes first and trade-offs go by how far ahead a reading is, not by
 *  a criterion's priority -- which is why `weighted`, a fusion by priority, fuses as Borda here.
 *  A criterion with nothing to tell the readings apart (no LM ranking, no profiles, no scoping
 *  against the surface) ranks them all first and changes nothing. Returns the readings best
 *  first; tied readings keep the updates' order. */
export function globalReadingOrder(request: ReadingOrderContext & {
  criteria: readonly ReadingCriterion[];
}): ReadingPlace[] {
  const readings = request.updates.flatMap(update => update.discourse);
  if (!readings.length) return [];
  const checked = READING_CRITERIA.filter(criterion => request.criteria.includes(criterion));
  const rows = MATRIX_ROWS.filter(row => checked.includes(row));
  const rankings: number[][] = [];

  if (checked.includes('surface')) {
    const counts = surfaceAgainstCounts(request.discriminants);
    const against = readings.map(reading => surfaceAgainst(reading.semanticOrigin, counts));
    rankings.push(competitionRanks(readings.map((_, i) => i), (a, b) => against[a] - against[b]));
  }
  if (rows.length) {
    rankings.push(competitionRanks(readings, (a: DiscourseAnalysis, b: DiscourseAnalysis) =>
      compareProfiles(a.pragmaticProfile, b.pragmaticProfile, rows)));
  }
  if (checked.includes('lm')) {
    const lmRankings = request.updates.map(update => update.anaphoraRanking)
      .filter((ranking): ranking is AnaphoraRanking => !!ranking);
    const scores = globalLmScores(lmRankings, readings.map(reading => reading.id));
    const lm = readings.map(reading => scores.get(reading.id) ?? null);
    rankings.push(competitionRanks(lm, descending));
  }

  const averager = request.averager === 'rrf' ? 'rrf' : 'borda';
  const fused = readings.map((reading, i) => ({
    id: reading.id,
    score: rankings.length ? fuse(rankings.map(ranks => ranks[i]), readings.length, averager) : 1,
    index: i,
  }));
  // Best first, tied readings in the updates' order; a place per distinct score.
  const sorted = [...fused].sort((a, b) =>
    (Math.abs(a.score - b.score) < EPSILON ? 0 : b.score - a.score) || a.index - b.index);
  let place = 0;
  return sorted.map((entry, position) => {
    if (position === 0 || sorted[position - 1].score - entry.score > EPSILON) place++;
    return { id: entry.id, place, score: entry.score };
  });
}

/** Which of a discourse's readings go to Vampire (N4 6d): ordered by the checked criteria, the
 *  filtered ones removed, then the readings on the first k places. The session's default
 *  (VampirePreferences.reading_selection); a discourse may have its own. */
export interface ReadingSelection {
  criteria: ReadingCriterion[];
  filters: ReadingFilter[];
  /** Places, not readings: tied readings stay together. Null: every reading. */
  k: number | null;
}

/** Surface alignment checked, no filter, every reading. */
export const DEFAULT_READING_SELECTION: ReadingSelection = { criteria: ['surface'], filters: [], k: null };

/** What a run without a recorded selection sent: every reading. */
export const ALL_READINGS: ReadingSelection = { criteria: [], filters: [], k: null };

const SHORT_CRITERIA: Record<ReadingCriterion, string> = {
  surface: 'surface', pronouns: 'pronouns', binding: 'binding', accommodation: 'accommodation', lm: 'LM',
};

/** A selection in a few words: "all readings", "top 2 by surface + LM, without unbound". */
export function describeReadingSelection(selection: Partial<ReadingSelection>): string {
  const normalized = normalizedReadingSelection(selection);
  const by = normalized.criteria.length ? ` by ${normalized.criteria.map(criterion => SHORT_CRITERIA[criterion]).join(' + ')}` : '';
  const without = normalized.filters.length
    ? `, without ${normalized.filters.map(filter => filter === 'unbound' ? 'unbound pronouns' : 'accommodation').join(' or ')}`
    : '';
  return normalized.k === null ? `all readings${without}` : `top ${normalized.k}${by}${without}`;
}

/** A selection with known criteria and filters and a positive whole k, or null; anything else
 *  in a stored selection is dropped. */
export function normalizedReadingSelection(selection: Partial<ReadingSelection> | null | undefined): ReadingSelection {
  if (!selection) return { ...DEFAULT_READING_SELECTION };
  const k = Number(selection.k);
  return {
    criteria: READING_CRITERIA.filter(criterion => (selection.criteria ?? []).includes(criterion)),
    filters: READING_FILTERS.filter(filter => (selection.filters ?? []).includes(filter)),
    k: selection.k === null || selection.k === undefined || !Number.isFinite(k) ? null : Math.max(1, Math.floor(k)),
  };
}

/** Whether two selections select the same way. */
export function sameReadingSelection(a: ReadingSelection, b: ReadingSelection): boolean {
  const left = normalizedReadingSelection(a);
  const right = normalizedReadingSelection(b);
  return left.k === right.k
    && left.criteria.join() === right.criteria.join()
    && left.filters.join() === right.filters.join();
}

/** Whether the selection needs the LM ranking: it orders by it and cuts at k. */
export function selectionNeedsRanking(selection: ReadingSelection): boolean {
  return selection.k !== null && selection.criteria.includes('lm');
}

/** The ids of the readings `selection` sends to Vampire, best first. Filtered readings are
 *  dropped before counting, so k counts the places of the readings that remain; readings
 *  tied on the k-th place all stay. */
export function selectedReadingIds(context: ReadingOrderContext, selection: ReadingSelection): string[] {
  const readings = new Map(context.updates.flatMap(update => update.discourse).map(reading => [reading.id, reading]));
  const visible = globalReadingOrder({ ...context, criteria: selection.criteria })
    .filter(place => !selection.filters.some(filter => hiddenByFilter(readings.get(place.id)!, filter)));
  if (selection.k === null) return visible.map(place => place.id);
  const kept: string[] = [];
  let places = 0;
  visible.forEach((place, index) => {
    if (index === 0 || visible[index - 1].place !== place.place) places++;
    if (places <= selection.k!) kept.push(place.id);
  });
  return kept;
}
