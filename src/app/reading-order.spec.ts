import { AnaphoraRanking, DiscourseAnalysis, DiscourseUpdate, GswbDiscriminant, PragmaticProfile } from './models/models';
import {
  ReadingCriterion,
  compareProfiles,
  globalLmScores,
  globalReadingOrder,
  surfaceAgainst,
  surfaceAgainstCounts,
} from './reading-order';

const profile = (pronouns: number[], binding = [0, 0, 0], accommodation = [0, 0, 0]): PragmaticProfile =>
  ({ pronouns, binding, accommodation });

const reading = (id: string, semanticOrigin: string, pragmaticProfile?: PragmaticProfile): DiscourseAnalysis => ({
  id, semanticOrigin, drsString: '', ruleBranch: 1, anaphoraMapping: { relations: [] } as any, collapsed: false,
  ...(pragmaticProfile ? { pragmaticProfile } : {}),
});

const update = (discourse: DiscourseAnalysis[], anaphoraRanking?: AnaphoraRanking): DiscourseUpdate => ({
  id: 'du-s', sourceElementId: 's', sourceElementKind: 'sequence', discourse, semDiscourseMapping: {},
  ...(anaphoraRanking ? { anaphoraRanking } : {}),
});

const scope = (associatedSolutions: string[], surfaceAligned: boolean | null): GswbDiscriminant =>
  ({ id: 'd', type: 'scope', identifier: 'd', associatedSolutions, surfaceAligned });

const ranking = (branches: AnaphoraRanking['branches'], methods?: any[], averager?: any): AnaphoraRanking => ({
  method: 'm', ...(methods ? { methods } : {}), ...(averager ? { averager } : {}),
  model: '', layers: [], pooling: '', createdAt: '', relations: [], branches, warnings: [],
});

const order = (discourse: DiscourseAnalysis[], criteria: ReadingCriterion[], extra: {
  discriminants?: GswbDiscriminant[]; anaphoraRanking?: AnaphoraRanking; averager?: any;
} = {}) => globalReadingOrder({
  updates: [update(discourse, extra.anaphoraRanking)],
  discriminants: extra.discriminants ?? [],
  criteria,
  averager: extra.averager ?? 'borda',
});

describe('reading order', () => {
  describe('profile matrix', () => {
    const all = ['pronouns', 'binding', 'accommodation'] as const;

    it('compares rows in fixed priority: a better pronoun row outweighs any binding row', () => {
      const boundPronoun = profile([1, 0, 0], [0, 0, 0], [0, 0, 1]);
      const unboundPronoun = profile([0, 0, 1], [1, 0, 0], [0, 0, 0]);
      expect(compareProfiles(boundPronoun, unboundPronoun, all)).toBeLessThan(0);
    });

    it('within a row, more in the best column wins, then more in the next', () => {
      expect(compareProfiles(profile([1, 0, 1]), profile([0, 2, 0]), all)).toBeLessThan(0);
      expect(compareProfiles(profile([0, 2, 0]), profile([0, 1, 1]), all)).toBeLessThan(0);
    });

    it('only the checked rows count', () => {
      const a = profile([0, 0, 1], [1, 0, 0]);
      const b = profile([1, 0, 0], [0, 0, 1]);
      expect(compareProfiles(a, b, all)).toBeGreaterThan(0);
      expect(compareProfiles(a, b, ['binding'])).toBeLessThan(0);
    });

    it('a tie on the checked rows goes to fewer distinct columns', () => {
      // Readings of different parses can count different pronouns or p-boxes: equal in every
      // row's first two columns, they differ in the worst one only.
      const fewer = profile([1, 0, 0], [1, 0, 0]);
      const more = profile([1, 0, 1], [1, 0, 0]);
      expect(compareProfiles(fewer, more, ['pronouns', 'binding'])).toBeLessThan(0);
      // Only the checked rows' columns are counted.
      const local = profile([1, 0, 0], [1, 0, 0], [0, 0, 1]);
      expect(compareProfiles(local, fewer, ['pronouns', 'binding'])).toBe(0);
      expect(compareProfiles(local, fewer, ['pronouns', 'binding', 'accommodation'])).toBeGreaterThan(0);
    });

    it('a reading without a profile comes after every reading with one', () => {
      expect(compareProfiles(profile([0, 0, 3]), undefined, all)).toBeLessThan(0);
      expect(compareProfiles(undefined, undefined, all)).toBe(0);
    });
  });

  describe('surface alignment', () => {
    it('counts the scopings against the surface of every part of a merged reading', () => {
      const counts = surfaceAgainstCounts([
        scope(['a-s0', 'b-s1'], false),
        scope(['a-s0'], false),
        scope(['a-s1'], true),
        scope(['a-s1'], null),
        { ...scope(['a-s1'], false), type: 'mc' },
      ]);
      expect(surfaceAgainst('a-s0+b-s1', counts)).toBe(3);
      expect(surfaceAgainst('a-s1+b-s0', counts)).toBe(0);
    });
  });

  describe('LM scores across readings', () => {
    it('reads one ranker\'s score as is, across semantic readings', () => {
      const scores = globalLmScores([ranking([
        { discourseId: 'p1', score: 0.9, rank: 1, scores: { m: 0.4 } },
        { discourseId: 'p2', score: 0.1, rank: 1, scores: { m: 0.7 } },
      ], ['m'])], ['p1', 'p2', 'p3']);
      expect(scores.get('p1')).toBe(0.4);
      expect(scores.get('p2')).toBe(0.7);
      expect(scores.get('p3')).toBeNull();
    });

    it('fuses several rankers over all readings, not within one', () => {
      // Within its own reading each branch was first (rank 1, score 1); across readings p2
      // leads on both rankers.
      const scores = globalLmScores([ranking([
        { discourseId: 'p1', score: 1, rank: 1, scores: { a: 0.2, b: 0.3 } },
        { discourseId: 'p2', score: 1, rank: 1, scores: { a: 0.8, b: 0.9 } },
      ], ['a', 'b'], 'borda')], ['p1', 'p2']);
      expect(scores.get('p2')!).toBeGreaterThan(scores.get('p1')!);
    });
  });

  describe('global order', () => {
    it('puts a reading better on every checked criterion first', () => {
      const discourse = [
        reading('p1', 's0', profile([0, 0, 1])),
        reading('p2', 's1', profile([1, 0, 0])),
      ];
      const anaphoraRanking = ranking([
        { discourseId: 'p1', score: 0.2, rank: 1, scores: { m: 0.2 } },
        { discourseId: 'p2', score: 0.8, rank: 1, scores: { m: 0.8 } },
      ], ['m']);
      for (const averager of ['borda', 'rrf']) {
        const placed = order(discourse, ['surface', 'pronouns', 'lm'], {
          discriminants: [scope(['s0'], false)], anaphoraRanking, averager,
        });
        expect(placed.map(entry => [entry.id, entry.place])).toEqual([['p2', 1], ['p1', 2]]);
      }
    });

    it('does not let one criterion\'s priority decide a trade-off', () => {
      // p1 is best on the matrix, p2 on surface and LM: two criteria against one.
      const discourse = [
        reading('p1', 's0', profile([1, 0, 0])),
        reading('p2', 's1', profile([0, 0, 1])),
      ];
      const anaphoraRanking = ranking([
        { discourseId: 'p1', score: 0.2, rank: 1, scores: { m: 0.2 } },
        { discourseId: 'p2', score: 0.8, rank: 1, scores: { m: 0.8 } },
      ], ['m']);
      const placed = order(discourse, ['surface', 'pronouns', 'lm'], {
        discriminants: [scope(['s0'], false)], anaphoraRanking,
      });
      expect(placed.map(entry => entry.id)).toEqual(['p2', 'p1']);
    });

    it('counts places densely, ties sharing one and keeping the update\'s order', () => {
      const discourse = [
        reading('p1', 's0', profile([0, 1, 0])),
        reading('p2', 's0', profile([1, 0, 0])),
        reading('p3', 's1', profile([0, 1, 0])),
        reading('p4', 's1', profile([0, 0, 1])),
      ];
      const placed = order(discourse, ['pronouns']);
      expect(placed.map(entry => [entry.id, entry.place]))
        .toEqual([['p2', 1], ['p1', 2], ['p3', 2], ['p4', 3]]);
    });

    it('orders across semantic readings, so many scope readings do not crowd out the rest', () => {
      // Three readings of one scope reading, all unbound, against one bound reading of another.
      const discourse = [
        reading('a1', 'wide', profile([0, 0, 1])),
        reading('a2', 'wide', profile([0, 0, 1])),
        reading('a3', 'wide', profile([0, 0, 1])),
        reading('b1', 'narrow', profile([1, 0, 0])),
      ];
      expect(order(discourse, ['pronouns'])[0].id).toBe('b1');
    });

    it('a criterion that tells nothing apart changes nothing', () => {
      const discourse = [
        reading('p1', 's0', profile([0, 1, 0])),
        reading('p2', 's1', profile([1, 0, 0])),
      ];
      // No LM ranking and no scoping against the surface.
      expect(order(discourse, ['surface', 'pronouns', 'lm']).map(entry => entry.id)).toEqual(['p2', 'p1']);
      // Nothing checked: one place, the update's order.
      expect(order(discourse, []).map(entry => [entry.id, entry.place])).toEqual([['p1', 1], ['p2', 1]]);
    });

    it('fuses a weighted session like Borda: criteria have no priority', () => {
      const discourse = [
        reading('p1', 's0', profile([1, 0, 0])),
        reading('p2', 's1', profile([0, 0, 1])),
      ];
      const discriminants = [scope(['s0'], false)];
      const weighted = order(discourse, ['surface', 'pronouns'], { discriminants, averager: 'weighted' });
      const borda = order(discourse, ['surface', 'pronouns'], { discriminants, averager: 'borda' });
      expect(weighted).toEqual(borda);
      expect(weighted.map(entry => entry.place)).toEqual([1, 1]);
    });
  });
});
