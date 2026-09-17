import { TestBed } from '@angular/core/testing';
import { Subject, throwError } from 'rxjs';
import { DataService } from '../data.service';
import {
  anaphoraRankingCaption,
  anaphoraRankingRequest,
  attachAnaphoraRanking,
  carryAnaphoraRanking,
  needsAnaphoraRanking,
  orderByAnaphoraRanking,
  validateDiscourseUpdate,
} from '../analysis-model';
import { AnaphoraRanking, DiscourseAnalysis, DiscourseUpdate, XlePlusGlueDocument } from '../models/models';
import { AnaphoraRankingOutcome, AnaphoraRankingResult, AnaphoraRankingService } from './anaphora-ranking.service';

const structure = { id: 'syn', constraints: [], annotations: [], choiceSpace: {} } as any;
const drs = { id: 'drs', constraints: [], annotations: [], choiceSpace: {} } as any;

function branch(id: string, bindings: [string, string][], semanticOrigin = 'sem-1'): DiscourseAnalysis {
  return {
    id,
    semanticOrigin,
    drsString: '',
    ruleBranch: 1,
    collapsed: false,
    anaphoraMapping: {
      relations: bindings.map(([pronoun, antecedent]) =>
        ({ pronounReferentId: `s1:${pronoun.slice(1)}`, pronounDisplay: pronoun, antecedent, stateLabel: 's1' })),
    },
  };
}

function update(discourse: DiscourseAnalysis[]): DiscourseUpdate {
  return {
    id: 'du-sentence-1',
    sourceElementId: 'sentence-1',
    sourceElementKind: 'sentence',
    discourse,
    semDiscourseMapping: { 'sem-1': discourse.map(entry => entry.id) },
  };
}

function documentWith(discourseUpdate?: DiscourseUpdate, graph: any = drs): XlePlusGlueDocument {
  return {
    id: 'doc',
    semanticType: 'lfgxdrt',
    sentences: [{
      id: 'sentence-1',
      text: 'the big cat ate the black dog it barked',
      syntax: [{ synId: 'syn-1', structure, graph: { graphElements: [] } as any }],
      semantics: [{ syntacticOrigin: 'syn-1', semId: 'sem-1', semString: 'P', semType: 'lfgxdrt', graph }],
      synSemMapping: { 'syn-1': ['sem-1'] },
    }],
    sequences: [],
    elements: [{ kind: 'sentence', id: 'sentence-1' }],
    discourseUpdates: discourseUpdate ? [discourseUpdate] : [],
  };
}

function ranking(ranks: [string, number, number | null][]): AnaphoraRanking {
  return {
    method: 'cosine-description',
    model: 'test-model',
    layers: [-1],
    pooling: 'mean',
    createdAt: 'now',
    relations: [
      { semanticOrigin: 'sem-1', pronoun: 'x4', antecedent: 'x1', pronounText: 'it', antecedentText: 'the big cat', cosine: 0.816, recencyRank: 2 },
      { semanticOrigin: 'sem-1', pronoun: 'x4', antecedent: 'x2', pronounText: 'it', antecedentText: 'the black dog', cosine: 0.788, recencyRank: 1 },
    ],
    branches: ranks.map(([discourseId, rank, score]) => ({ discourseId, rank, score })),
    warnings: [],
  };
}

describe('anaphora ranking document helpers', () => {
  const twoBranches = () => update([branch('b-dog', [['x4', 'x2']]), branch('b-cat', [['x4', 'x1']])]);

  it('builds the lm request from the stored syntax and semantic graph, with referent labels', () => {
    const prepared = anaphoraRankingRequest(documentWith(), twoBranches());
    expect('request' in prepared).toBeTrue();
    if (!('request' in prepared)) return;
    expect(prepared.request.syntax).toEqual({ 'syn-1': structure });
    expect(prepared.request.semantics).toEqual([{ semanticOrigin: 'sem-1', syntacticOrigin: 'syn-1', drs }]);
    expect(prepared.request.branches).toEqual([
      { discourseId: 'b-dog', semanticOrigin: 'sem-1', relations: [{ pronoun: 'x4', antecedent: 'x2' }] },
      { discourseId: 'b-cat', semanticOrigin: 'sem-1', relations: [{ pronoun: 'x4', antecedent: 'x1' }] },
    ]);
  });

  it('does not ask lm when nothing is bound or the graph is not stored', () => {
    expect('reason' in anaphoraRankingRequest(documentWith(), update([branch('b', [])]))).toBeTrue();
    expect('reason' in anaphoraRankingRequest(documentWith(undefined, null), twoBranches())).toBeTrue();
    expect(needsAnaphoraRanking(update([branch('b', [])]))).toBeFalse();
    expect(needsAnaphoraRanking(twoBranches())).toBeTrue();
  });

  it('rejects a ranking of a branch the update does not have', () => {
    const ranked = { ...twoBranches(), anaphoraRanking: ranking([['b-dog', 1, 0.8], ['b-gone', 2, 0.1]]) };
    expect(() => validateDiscourseUpdate(documentWith(ranked), ranked)).toThrowError(/b-gone/);
    const valid = { ...twoBranches(), anaphoraRanking: ranking([['b-dog', 2, 0.788], ['b-cat', 1, 0.816]]) };
    expect(() => validateDiscourseUpdate(documentWith(valid), valid)).not.toThrow();
  });

  it('keeps a ranking across re-upserts with the same bindings, drops it when the bindings change', () => {
    const ranked = { ...twoBranches(), anaphoraRanking: ranking([['b-dog', 2, 0.788], ['b-cat', 1, 0.816]]) };
    expect(carryAnaphoraRanking(ranked, twoBranches()).anaphoraRanking).toBe(ranked.anaphoraRanking);
    const regenerated = update([branch('b-dog', [['x4', 'x3']]), branch('b-cat', [['x4', 'x1']])]);
    expect(carryAnaphoraRanking(ranked, regenerated).anaphoraRanking).toBeUndefined();
  });

  it('attaches a late ranking only to the update it was computed for', () => {
    const asked = twoBranches();
    const result = ranking([['b-dog', 2, 0.788], ['b-cat', 1, 0.816]]);
    expect(attachAnaphoraRanking(documentWith(asked), asked, result)?.anaphoraRanking).toBe(result);
    const replaced = update([branch('b-other', [['x4', 'x1']])]);
    expect(attachAnaphoraRanking(documentWith(replaced), asked, result)).toBeNull();
    expect(attachAnaphoraRanking(documentWith(), asked, result)).toBeNull();
  });

  it('orders by rank, keeping generation order for ties and unranked branches last', () => {
    const branches = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    const result = ranking([['a', 2, 0.5], ['b', 1, 0.9], ['c', 2, 0.5]]);
    expect(orderByAnaphoraRanking(branches, result).map(entry => entry.id)).toEqual(['b', 'a', 'c', 'd']);
    expect(orderByAnaphoraRanking(branches, undefined).map(entry => entry.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('captions a branch with its rank, score and each binding', () => {
    const ranked = { ...twoBranches(), anaphoraRanking: ranking([['b-dog', 2, 0.788], ['b-cat', 1, 0.816]]) };
    expect(anaphoraRankingCaption(ranked, 'b-cat'))
      .toBe('rank 1 · mean cos 0.816 · it → the big cat (cos 0.82, recency 2)');
    expect(anaphoraRankingCaption(twoBranches(), 'b-cat')).toBe('');
  });
});

describe('AnaphoraRankingService', () => {
  let service: AnaphoraRankingService;
  let dataService: jasmine.SpyObj<DataService>;

  beforeEach(() => {
    dataService = jasmine.createSpyObj<DataService>('DataService', ['lmRankAnaphora']);
    TestBed.configureTestingModule({ providers: [{ provide: DataService, useValue: dataService }] });
    service = TestBed.inject(AnaphoraRankingService);
  });

  it('sends one request at a time', () => {
    const first = new Subject<AnaphoraRanking>();
    const second = new Subject<AnaphoraRanking>();
    dataService.lmRankAnaphora.and.returnValues(first, second);
    const discourseUpdate = update([branch('b-cat', [['x4', 'x1']])]);
    const results: AnaphoraRankingResult[] = [];

    service.rank(documentWith(), discourseUpdate).subscribe(result => results.push(result));
    service.rank(documentWith(), discourseUpdate).subscribe(result => results.push(result));
    expect(dataService.lmRankAnaphora).toHaveBeenCalledTimes(1);

    first.next(ranking([['b-cat', 1, 0.8]]));
    first.complete();
    expect(dataService.lmRankAnaphora).toHaveBeenCalledTimes(2);
    expect(results.map(result => result.status)).toEqual(['ranked']);

    second.error({ status: 0 });
    expect(results.map(result => result.status)).toEqual(['ranked', 'unavailable']);
  });

  it('reports lm being down as unavailable and never errors', () => {
    dataService.lmRankAnaphora.and.returnValue(throwError(() => ({ status: 0 })));
    const discourseUpdate = update([branch('b-cat', [['x4', 'x1']])]);
    let outcome: AnaphoraRankingOutcome | undefined;
    let errored = false;

    service.rankAndAttach(() => documentWith(discourseUpdate), discourseUpdate)
      .subscribe({ next: value => outcome = value, error: () => errored = true });

    expect(errored).toBeFalse();
    expect(outcome?.result).toEqual({ status: 'unavailable', reason: 'lm service unreachable' });
    expect(outcome?.update).toBeNull();
  });

  it('does not call lm when there is nothing to rank', () => {
    let result: AnaphoraRankingResult | undefined;
    service.rank(documentWith(), update([branch('b', [])])).subscribe(value => result = value);
    expect(result?.status).toBe('not-applicable');
    expect(dataService.lmRankAnaphora).not.toHaveBeenCalled();
  });

  it('drops a ranking whose update was replaced while lm was working', () => {
    const pending = new Subject<AnaphoraRanking>();
    dataService.lmRankAnaphora.and.returnValue(pending);
    const asked = update([branch('b-cat', [['x4', 'x1']])]);
    let current = documentWith(asked);
    let outcome: AnaphoraRankingOutcome | undefined;

    service.rankAndAttach(() => current, asked).subscribe(value => outcome = value);
    current = documentWith(update([branch('b-new', [['x4', 'x2']])]));
    pending.next(ranking([['b-cat', 1, 0.8]]));
    pending.complete();

    expect(outcome?.result.status).toBe('ranked');
    expect(outcome?.update).toBeNull();
  });
});
