import { TestBed } from '@angular/core/testing';
import { Subject, throwError } from 'rxjs';
import { DataService } from '../data.service';
import { FormBuilder } from '@angular/forms';
import { SemVisComponent } from '../sem-vis/sem-vis.component';
import { InferenceSettingsComponent } from '../inference-interface/inference-settings/inference-settings.component';
import {
  anaphoraRankingCaption,
  anaphoraSelectionPolicy,
  inferenceResultsFromDocument,
  selectForVampire,
  selectedAnaphoraBranchIds,
  selectReasoningAssignments,
  discourseBranchesForDisplay,
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

  it('captions a substitution ranking with its score and the words substituted', () => {
    const substitution: AnaphoraRanking = {
      ...ranking([['b-dog', 2, -5.668], ['b-cat', 1, -5.258]]),
      method: 'mlm-substitution',
      relations: [{ semanticOrigin: 'sem-1', pronoun: 'x4', antecedent: 'x1', pronounText: 'it', antecedentText: 'big cat',
        score: -5.258, cosine: null, substitution: 'The big cat', recencyRank: 2 }],
    };
    expect(anaphoraRankingCaption({ ...twoBranches(), anaphoraRanking: substitution }, 'b-cat'))
      .toBe('rank 1 · mean score -5.258 · it → big cat (score -5.26, "The big cat", recency 2)');
  });
});

describe('discourseBranchesForDisplay', () => {
  const assignment = (discourseId: string, verdict?: { consistent: boolean; informative: boolean }, failure?: string) => ({
    id: `a-${discourseId}-${Math.random()}`, discourseId, premiseSemanticIds: [], hypothesisSemanticIds: [], ruleBranchIndex: 1,
    checks: {} as any, verdict: verdict ? { ...verdict, relevant: true } : undefined, failure,
  });

  it('groups by reading, orders each reading by rank and captions ranking and verdicts', () => {
    const discourse = update([
      { ...branch('b-dog', [['x4', 'x2']]), drsString: 'drs-dog' },
      { ...branch('b-cat', [['x4', 'x1']]), drsString: 'drs-cat' },
      { ...branch('b2-cat', [['x4', 'x1']], 'sem-2'), drsString: 'drs-2' },
    ]);
    const document = documentWith({ ...discourse, anaphoraRanking: ranking([['b-dog', 3, 0.788], ['b-cat', 1, 0.816], ['b2-cat', 1, 0.816]]) });
    document.reasoningUpdates = [{
      id: 'ru-n0', premiseElementIds: ['sentence-1'], hypothesisElementIds: ['sentence-1'], logicType: 'fof',
      assignments: [
        assignment('b-cat', { consistent: true, informative: true }),
        assignment('b-cat', { consistent: true, informative: false }),
        assignment('b-cat', { consistent: true, informative: true }),
        assignment('b-dog', undefined, 'collapse failed'),
      ] as any,
    }];

    const { solutions, labels, render } = discourseBranchesForDisplay(document);

    expect(render.map(item => [item.id, item.semantic])).toEqual([['b-cat', 'P'], ['b-dog', 'P'], ['b2-cat', 'drs-2']]);
    expect(solutions.map(solution => [solution.id, solution.solution]))
      .toEqual([['b-cat', 'drs-cat'], ['b-dog', 'drs-dog'], ['b2-cat', 'drs-2']]);
    expect(labels[0]).toBe('reading 1/2 · rank 1 · mean cos 0.816 · it → the big cat (cos 0.82, recency 2) · Vampire: neutral ×2, entailment ×1');
    expect(labels[1]).toContain('reading 1/2 · rank 3');
    expect(labels[1]).toContain('Vampire: failed ×1');
    expect(labels[2]).toContain('reading 2/2');
    expect(labels[2]).toContain('no reasoning over this branch');
  });

  it('shows the bindings in generation order when there is no ranking', () => {
    const document = documentWith(update([branch('b-dog', [['x4', 'x2']]), branch('b-none', [])]));
    const { solutions, labels } = discourseBranchesForDisplay(document);
    expect(solutions.map(solution => solution.id)).toEqual(['b-dog', 'b-none']);
    expect(labels).toEqual([
      'reading 1/1 · x4 → x2 · no reasoning over this branch',
      'reading 1/1 · no binding · no reasoning over this branch',
    ]);
  });
});

describe('anaphora branch selection for verdicts', () => {
  // Reading sem-1: b-dog (0.788), b-cat (0.816), b-event (0.871) -- top-1 is the event.
  // Reading sem-2: b2-cat, b2-dog, both unscored.
  const ranked = () => ({
    ...update([
      branch('b-dog', [['x4', 'x2']]), branch('b-cat', [['x4', 'x1']]), branch('b-event', [['x4', 'x3']]),
      branch('b2-cat', [['x4', 'x1']], 'sem-2'), branch('b2-dog', [['x4', 'x2']], 'sem-2'),
    ]),
    anaphoraRanking: ranking([['b-dog', 3, 0.788], ['b-cat', 2, 0.816], ['b-event', 1, 0.871], ['b2-cat', 4, null], ['b2-dog', 4, null]]),
  });
  const verdictFor = { entailment: { consistent: true, informative: false }, neutral: { consistent: true, informative: true } };
  const reasoningOver = (discourse: DiscourseUpdate, outcomes: [string, 'entailment' | 'neutral'][], unlinked: ('entailment' | 'neutral')[] = []) => {
    const document = documentWith(discourse);
    document.reasoningUpdates = [{
      id: 'ru-n0', premiseElementIds: ['sentence-1'], hypothesisElementIds: ['sentence-1'], logicType: 'fof',
      assignments: [
        ...outcomes.map(([discourseId, outcome], index) => ({
          id: `a${index}`, premiseSemanticIds: [], hypothesisSemanticIds: [], ruleBranchIndex: 1, checks: {} as any,
          discourseUpdateId: discourse.id, discourseId, verdict: { ...verdictFor[outcome], relevant: true },
        })),
        ...unlinked.map((outcome, index) => ({
          id: `u${index}`, premiseSemanticIds: [], hypothesisSemanticIds: [], ruleBranchIndex: 1, checks: {} as any,
          verdict: { ...verdictFor[outcome], relevant: true },
        })),
      ] as any,
    }];
    return document;
  };
  const item = { id: 'n0', gold_label: '1' };

  it('keeps the top k per reading and leaves an unscored reading whole', () => {
    expect([...selectedAnaphoraBranchIds(ranked(), { mode: 'top_k', k: 1 })]).toEqual(['b-event', 'b2-cat', 'b2-dog']);
    expect([...selectedAnaphoraBranchIds(ranked(), { mode: 'top_k', k: 2 })]).toEqual(['b-cat', 'b-event', 'b2-cat', 'b2-dog']);
    expect(selectedAnaphoraBranchIds(ranked(), { mode: 'all', k: 1 }).size).toBe(5);
  });

  it('keeps tied branches together and everything when the update is unranked', () => {
    const tied = { ...update([branch('a', [['x4', 'x1']]), branch('b', [['x4', 'x1']]), branch('c', [['x4', 'x2']])]),
      anaphoraRanking: ranking([['a', 1, 0.9], ['b', 1, 0.9], ['c', 3, 0.1]]) };
    expect([...selectedAnaphoraBranchIds(tied, { mode: 'top_k', k: 1 })]).toEqual(['a', 'b']);
    expect(selectedAnaphoraBranchIds(update([branch('a', [['x4', 'x1']]), branch('c', [['x4', 'x2']])]), { mode: 'top_k', k: 1 }).size).toBe(2);
  });

  it('selects before Vampire: only the top k per reading are sent, everything when unranked', () => {
    const prepared = ['b-dog', 'b-cat', 'b-event', 'b2-cat', 'b2-dog', 'unrelated'].map(mappingId => ({ mappingId }));
    const top1 = selectForVampire(ranked(), prepared, { mode: 'top_k', k: 1 });
    expect(top1.items.map(item => item.mappingId)).toEqual(['b-event', 'b2-cat', 'b2-dog', 'unrelated']);
    expect(top1.applied).toBeTrue();

    const unranked = selectForVampire(update([branch('b-dog', [['x4', 'x2']])]), prepared, { mode: 'top_k', k: 1 });
    expect(unranked.items.length).toBe(6);
    expect(unranked.applied).toBeFalse();
    expect(selectForVampire(ranked(), prepared, { mode: 'all', k: 1 }).items.length).toBe(6);
  });

  it('compares stored results restricted to a selection', () => {
    // All five branches: 2 entailment vs 3 neutral -> neutral. Top-1: the event (entailment)
    // plus the unscored reading's two branches (entailment, neutral) -> 2 vs 1 -> entailment.
    const document = reasoningOver(ranked(), [
      ['b-dog', 'neutral'], ['b-cat', 'neutral'], ['b-event', 'entailment'], ['b2-cat', 'entailment'], ['b2-dog', 'neutral'],
    ]);

    const all = inferenceResultsFromDocument(document, [item], {})['n0'];
    const top1 = inferenceResultsFromDocument(document, [item], {}, { mode: 'top_k', k: 1 })['n0'];

    expect(all.predictedLabel).toBe('0');
    expect(all.anaphoraSelection).toEqual({ mode: 'all', k: 1, applied: true, used: 5, total: 5 });
    expect(top1.predictedLabel).toBe('1');
    expect(top1.mismatch).toBeFalse();
    expect(top1.anaphoraSelection).toEqual({ mode: 'top_k', k: 1, applied: true, used: 3, total: 5 });

    // Without an override the report takes every stored assignment: a top-k run only stored
    // the selected ones, so a recorded top-k selection is not applied a second time.
    document.reasoningUpdates![0].anaphoraSelection = { mode: 'top_k', k: 1, applied: true };
    expect(inferenceResultsFromDocument(document, [item], {})['n0'].predictedLabel).toBe('0');
    expect(inferenceResultsFromDocument(document, [item], {})['n0'].anaphoraSelection)
      .toEqual({ mode: 'top_k', k: 1, applied: true, used: 5, total: 5 });
  });

  it('counts unlinked assignments, and says when there was no ranking to apply', () => {
    const unranked = reasoningOver(update([branch('b-dog', [['x4', 'x2']]), branch('b-cat', [['x4', 'x1']])]),
      [['b-dog', 'neutral'], ['b-cat', 'neutral']], ['entailment']);
    const { assignments, applied } = selectReasoningAssignments(unranked, unranked.reasoningUpdates![0], { mode: 'top_k', k: 1 });
    expect(assignments.length).toBe(3);
    expect(applied).toBeFalse();
  });

  it('reads the policy from Vampire preferences, defaulting to every branch', () => {
    expect(anaphoraSelectionPolicy(undefined)).toEqual({ mode: 'all', k: 1 });
    expect(anaphoraSelectionPolicy({ logic_type: 0, model_building: true, max_duration: 10, layered: false }))
      .toEqual({ mode: 'all', k: 1 });
    expect(anaphoraSelectionPolicy({ logic_type: 0, model_building: true, max_duration: 10, layered: false,
      anaphora_selection: 'top_k', anaphora_top_k: 2.7 })).toEqual({ mode: 'top_k', k: 2 });
  });

  it('lists the branches a run sent to Vampire, verdict or not, and marks the ones it did not send', () => {
    expect(discourseBranchesForDisplay(documentWith(ranked())).counted).toBeUndefined();

    // A top-1 run sent the event reading of sem-1 and both unscored sem-2 branches; b2-dog has
    // no verdict yet and is still sent.
    const document = reasoningOver(ranked(), [['b-event', 'entailment'], ['b2-cat', 'entailment']]);
    document.reasoningUpdates![0].assignments.push({
      id: 'pending', premiseSemanticIds: [], hypothesisSemanticIds: [], ruleBranchIndex: 1, checks: {} as any,
      contextTptp: '', discourseUpdateId: 'du-sentence-1', discourseId: 'b2-dog',
    });
    document.reasoningUpdates![0].anaphoraSelection = { mode: 'top_k', k: 1, applied: true };

    const { solutions, labels, counted } = discourseBranchesForDisplay(document);
    expect(counted).toEqual(['b-event', 'b2-cat', 'b2-dog']);
    expect(labels[solutions.findIndex(solution => solution.id === 'b-cat')]).toContain('not sent to Vampire (top 1)');
    expect(labels[solutions.findIndex(solution => solution.id === 'b2-dog')]).toContain('Vampire: not run ×1');
  });

  it('narrows sem-vis items to an id filter like a discriminant selection, and back', () => {
    const semVis = new SemVisComponent({ bypassSecurityTrustHtml: (value: string) => value } as any, { detectChanges: () => {} } as any);
    semVis.svgSolutions = true;
    semVis.setItems(['a', 'b', 'c'].map(id => ({ id, solution: `<svg>${id}</svg>` }) as any));

    semVis.setItemFilter(['c', 'a']);
    expect(semVis.items.map(item => item.id)).toEqual(['a', 'c']);
    expect(semVis.allItems.length).toBe(3);

    semVis.setItemFilter(null);
    expect(semVis.items.map(item => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('carries the selection through the settings form', () => {
    const settings = new InferenceSettingsComponent(new FormBuilder());
    settings.vampirePreferencesForm.patchValue({ anaphora_selection: 'top_k', anaphora_top_k: '3' });
    expect(settings.vampirePreferences.anaphora_selection).toBe('top_k');
    expect(settings.vampirePreferences.anaphora_top_k).toBe(3);

    settings.updateFormFromPreferences({ logic_type: 0, model_building: true, max_duration: 10, layered: false });
    expect(settings.vampirePreferencesForm.value.anaphora_selection).toBe('all');
    expect(settings.vampirePreferencesForm.value.anaphora_top_k).toBe(1);
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
