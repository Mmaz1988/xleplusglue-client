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

/** Competition ranks ("1224"): 1 + the number of items strictly better under `compare`. */
function competitionRanks<T>(items: T[], compare: (a: T, b: T) => number): number[] {
  return items.map(item => 1 + items.filter(other => compare(other, item) < 0).length);
}

/** Every reading's LM score across ALL readings of the discourse. lm ranks only within one
 *  semantic reading, so its combined `score` is not comparable across them (Borda and RRF are
 *  rank based); the rankers' own scores are, and are fused here over all readings the way lm's
 *  `fuse_branches` fuses within one. One ranker: its score. Null where no ranker scored. */
export function globalLmScores(ranking: AnaphoraRanking | undefined, ids: string[]): Map<string, number | null> {
  const scores = new Map<string, number | null>(ids.map(id => [id, null]));
  if (!ranking) return scores;
  const byId = new Map(ranking.branches.map(branch => [branch.discourseId, branch]));
  const rankers = ranking.methods?.length ? ranking.methods : [ranking.method];
  // Old rankings carry only the combined score; read it as the one ranker's.
  const own = ids.map(id => {
    const branch = byId.get(id);
    return branch?.scores ? rankers.map(ranker => branch.scores![ranker] ?? null) : [branch?.score ?? null];
  });
  const m = own[0]?.length ?? 0;
  const n = ids.length;
  const ranks = Array.from({ length: m }, (_, r) =>
    competitionRanks(own.map(values => values[r]), (a, b) => (b ?? -Infinity) - (a ?? -Infinity)));
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
 *  first; tied readings keep the update's order. */
export function globalReadingOrder(request: {
  update: DiscourseUpdate;
  /** Scope discriminants of the sentences the update's element spans. */
  discriminants: GswbDiscriminant[];
  criteria: readonly ReadingCriterion[];
  averager: AnaphoraAverager;
}): ReadingPlace[] {
  const readings = request.update.discourse;
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
    const scores = globalLmScores(request.update.anaphoraRanking, readings.map(reading => reading.id));
    const lm = readings.map(reading => scores.get(reading.id) ?? null);
    rankings.push(competitionRanks(readings.map((_, i) => i), (a, b) => (lm[b] ?? -Infinity) - (lm[a] ?? -Infinity)));
  }

  const averager = request.averager === 'rrf' ? 'rrf' : 'borda';
  const fused = readings.map((reading, i) => ({
    id: reading.id,
    score: rankings.length ? fuse(rankings.map(ranks => ranks[i]), readings.length, averager) : 1,
    index: i,
  }));
  const distinctScores = fused.map(entry => entry.score)
    .filter((score, i, all) => all.findIndex(other => Math.abs(other - score) < EPSILON) === i);
  return fused
    .map(entry => ({
      id: entry.id,
      score: entry.score,
      place: 1 + distinctScores.filter(score => score - entry.score > EPSILON).length,
      index: entry.index,
    }))
    .sort((a, b) => a.place - b.place || a.index - b.index)
    .map(({ id, place, score }) => ({ id, place, score }));
}
