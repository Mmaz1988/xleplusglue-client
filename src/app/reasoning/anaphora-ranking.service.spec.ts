import { TestBed } from '@angular/core/testing';
import { Subject, throwError } from 'rxjs';
import { DataService } from '../data.service';
import { FormBuilder } from '@angular/forms';
import { SemVisComponent } from '../sem-vis/sem-vis.component';
import { InferenceSettingsComponent } from '../inference-interface/inference-settings/inference-settings.component';
import { ALL_READINGS, ReadingSelection } from '../reading-order';
import {
  anaphoraRankerSelection,
  anaphoraRankingCaption,
  anaphoraRankingTable,
  inferenceResultsFromDocument,
  readingSelectionOf,
  readingsForReasoning,
  selectReasoningAssignments,
  discourseBranchesForDisplay,
  anaphoraRankingRequest,
  attachAnaphoraRanking,
  carryAnaphoraRanking,
  needsAnaphoraRanking,
  orderByAnaphoraRanking,
  validateDiscourseUpdate,
} from '../analysis-model';
import { AnaphoraRankerSelection, AnaphoraRanking, DiscourseAnalysis, DiscourseUpdate, XlePlusGlueDocument } from '../models/models';
import { AnaphoraRankingOutcome, AnaphoraRankingResult, AnaphoraRankingService } from './anaphora-ranking.service';

/** What the `ranking()` fixture was computed with: an old ranking, named by `method` alone. */
const COSINE: AnaphoraRankerSelection = { rankers: ['cosine-description'], averager: 'borda' };

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
      { semanticOrigin: 'sem-1', pronoun: 'x4', antecedent: 'x1', pronounText: 'it', antecedentText: 'the big cat', score: 0.908, cosine: 0.816, recencyRank: 2 },
      { semanticOrigin: 'sem-1', pronoun: 'x4', antecedent: 'x2', pronounText: 'it', antecedentText: 'the black dog', score: 0.894, cosine: 0.788, recencyRank: 1 },
    ],
    branches: ranks.map(([discourseId, rank, score]) => ({ discourseId, rank, score })),
    warnings: [],
  };
}

describe('anaphora ranking document helpers', () => {
  const twoBranches = () => update([branch('b-dog', [['x4', 'x2']]), branch('b-cat', [['x4', 'x1']])]);

  it('builds the lm request from the stored syntax and semantic graph, with referent labels', () => {
    const prepared = anaphoraRankingRequest(documentWith(), twoBranches(),
      { rankers: ['mlm-substitution', 'recency'], averager: 'rrf' });
    expect('request' in prepared).toBeTrue();
    if (!('request' in prepared)) return;
    expect(prepared.request.syntax).toEqual({ 'syn-1': structure });
    expect(prepared.request.semantics).toEqual([{ semanticOrigin: 'sem-1', syntacticOrigin: 'syn-1', drs }]);
    expect(prepared.request.branches).toEqual([
      { discourseId: 'b-dog', semanticOrigin: 'sem-1', relations: [{ pronoun: 'x4', antecedent: 'x2' }] },
      { discourseId: 'b-cat', semanticOrigin: 'sem-1', relations: [{ pronoun: 'x4', antecedent: 'x1' }] },
    ]);
    expect(prepared.request.methods).toEqual(['mlm-substitution', 'recency']);
    expect(prepared.request.averager).toBe('rrf');
  });

  it('does not ask lm when nothing is bound or the graph is not stored', () => {
    expect('reason' in anaphoraRankingRequest(documentWith(), update([branch('b', [])]), COSINE)).toBeTrue();
    expect('reason' in anaphoraRankingRequest(documentWith(undefined, null), twoBranches(), COSINE)).toBeTrue();
    expect(needsAnaphoraRanking(update([branch('b', [])]), COSINE)).toBeFalse();
    expect(needsAnaphoraRanking(twoBranches(), COSINE)).toBeTrue();
  });

  it('rejects a ranking of a branch the update does not have', () => {
    const ranked = { ...twoBranches(), anaphoraRanking: ranking([['b-dog', 1, 0.8], ['b-gone', 2, 0.1]]) };
    expect(() => validateDiscourseUpdate(documentWith(ranked), ranked)).toThrowError(/b-gone/);
    const valid = { ...twoBranches(), anaphoraRanking: ranking([['b-dog', 2, 0.788], ['b-cat', 1, 0.816]]) };
    expect(() => validateDiscourseUpdate(documentWith(valid), valid)).not.toThrow();
  });

  it('keeps a ranking across re-upserts with the same bindings, drops it when the bindings change', () => {
    const ranked = { ...twoBranches(), anaphoraRanking: ranking([['b-dog', 2, 0.788], ['b-cat', 1, 0.816]]) };
    expect(carryAnaphoraRanking(ranked, twoBranches(), COSINE).anaphoraRanking).toBe(ranked.anaphoraRanking);
    expect(needsAnaphoraRanking(ranked, COSINE)).toBeFalse();
    const regenerated = update([branch('b-dog', [['x4', 'x3']]), branch('b-cat', [['x4', 'x1']])]);
    expect(carryAnaphoraRanking(ranked, regenerated, COSINE).anaphoraRanking).toBeUndefined();
  });

  it('drops a ranking computed with other rankers, so a changed selection re-ranks', () => {
    const fused: AnaphoraRanking = { ...ranking([['b-dog', 2, 0.5], ['b-cat', 1, 0.5]]),
      method: 'borda(mlm-substitution>recency)', methods: ['mlm-substitution', 'recency'], averager: 'borda' };
    const ranked = { ...twoBranches(), anaphoraRanking: fused };
    const same: AnaphoraRankerSelection = { rankers: ['mlm-substitution', 'recency'], averager: 'borda' };
    expect(carryAnaphoraRanking(ranked, twoBranches(), same).anaphoraRanking).toBe(fused);
    expect(needsAnaphoraRanking(ranked, same)).toBeFalse();

    for (const changed of [
      { rankers: ['recency', 'mlm-substitution'], averager: 'borda' },
      { rankers: ['mlm-substitution', 'recency'], averager: 'weighted' },
      { rankers: ['mlm-substitution'], averager: 'borda' },
    ] as AnaphoraRankerSelection[]) {
      expect(carryAnaphoraRanking(ranked, twoBranches(), changed).anaphoraRanking).toBeUndefined();
      expect(needsAnaphoraRanking(ranked, changed)).toBeTrue();
    }

    // One ranker: the averager changes nothing, so the old ranking stays.
    const old = { ...twoBranches(), anaphoraRanking: ranking([['b-dog', 2, 0.788], ['b-cat', 1, 0.816]]) };
    expect(needsAnaphoraRanking(old, { rankers: ['cosine-description'], averager: 'rrf' })).toBeFalse();
  });

  it('reads the ranker selection from preferences, with defaults for sessions saved before', () => {
    expect(anaphoraRankerSelection(undefined)).toEqual({ rankers: ['mlm-pronoun-product'], averager: 'borda' });
    expect(anaphoraRankerSelection({ anaphora_rankers: ['recency', 'vibes', 'recency', 'cosine-lexical'], anaphora_averager: 'rrf' }))
      .toEqual({ rankers: ['recency', 'cosine-lexical'], averager: 'rrf' });
    expect(anaphoraRankerSelection({ anaphora_rankers: [], anaphora_averager: 'median' }))
      .toEqual({ rankers: ['mlm-pronoun-product'], averager: 'borda' });
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
    const ranked = { ...update([branch('a', [['x4', 'x1']]), branch('b', [['x4', 'x2']]), branch('c', [['x4', 'x1']])]),
      anaphoraRanking: ranking([['a', 2, 0.5], ['b', 1, 0.9], ['c', 2, 0.5]]) };
    expect(orderByAnaphoraRanking(branches, [ranked]).map(entry => entry.id)).toEqual(['b', 'a', 'c', 'd']);
    expect(orderByAnaphoraRanking(branches, [undefined]).map(entry => entry.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('never interleaves readings: each reading in turn, by its own ranks', () => {
    // Ranks are per reading: both readings have a rank 1. A scope reading renumbers referents,
    // so its ranks say nothing about the other reading's.
    const ranked = {
      ...update([branch('r1-a', [['x4', 'x1']]), branch('r1-b', [['x4', 'x2']]),
        branch('r2-a', [['x5', 'x2']], 'sem-2'), branch('r2-b', [['x5', 'x1']], 'sem-2')]),
      anaphoraRanking: ranking([['r1-a', 2, 0.5], ['r1-b', 1, 0.9], ['r2-a', 2, 0.4], ['r2-b', 1, 0.8]]),
    };
    const branches = ['r1-a', 'r2-a', 'r1-b', 'r2-b'].map(id => ({ id }));
    expect(orderByAnaphoraRanking(branches, [ranked]).map(entry => entry.id)).toEqual(['r1-b', 'r1-a', 'r2-b', 'r2-a']);
  });

  it('captions a branch with its rank and score, and tables each binding', () => {
    const ranked = { ...twoBranches(), anaphoraRanking: ranking([['b-dog', 2, 0.894], ['b-cat', 1, 0.908]]) };
    expect(anaphoraRankingCaption(ranked, 'b-cat')).toBe('rank 1 · mean score 0.908');
    expect(anaphoraRankingTable(ranked, 'b-cat')).toEqual({
      summary: 'rank 1 · mean score 0.908',
      columns: ['Anaphor', 'Antecedent', 'Score', 'Raw', 'Substitution', 'Recency'],
      rows: [['it', 'the big cat', '0.908', 'cos 0.82', '', '2']],
    });
    expect(anaphoraRankingCaption(twoBranches(), 'b-cat')).toBe('');
    expect(anaphoraRankingTable(twoBranches(), 'b-cat')).toBeNull();
  });

  it('captions a substitution ranking with its score and the words substituted', () => {
    const substitution: AnaphoraRanking = {
      ...ranking([['b-dog', 2, 0.003], ['b-cat', 1, 0.25]]),
      method: 'mlm-substitution',
      relations: [{ semanticOrigin: 'sem-1', pronoun: 'x4', antecedent: 'x1', pronounText: 'it', antecedentText: 'big cat',
        score: 0.25, cosine: null, logProb: -1.386, substitution: 'The big cat', recencyRank: 2 }],
    };
    expect(anaphoraRankingTable({ ...twoBranches(), anaphoraRanking: substitution }, 'b-cat')!.rows)
      .toEqual([['it', 'big cat', '0.250', 'logp -1.39', 'The big cat', '2']]);
  });

  it('captions a fused ranking with the combined score, every ranker\'s rank and per-ranker scores', () => {
    const fused: AnaphoraRanking = {
      ...ranking([]),
      method: 'borda(mlm-substitution>recency)',
      methods: ['mlm-substitution', 'recency'],
      averager: 'borda',
      relations: [{ semanticOrigin: 'sem-1', pronoun: 'x4', antecedent: 'x1', pronounText: 'he', antecedentText: 'man',
        score: 0.25, scores: { 'mlm-substitution': 0.25, recency: 0.5 }, raw: { 'mlm-substitution': -1.386, recency: 2 },
        cosine: null, logProb: -1.386, substitution: 'The man', recencyRank: 2 }],
      branches: [
        { discourseId: 'b-cat', rank: 1, score: 0.5, scores: { 'mlm-substitution': 0.25, recency: 0.5 },
          ranks: { 'mlm-substitution': 1, recency: 2 } },
        { discourseId: 'b-dog', rank: 2, score: 0.5, scores: { 'mlm-substitution': 0.012, recency: 1 },
          ranks: { 'mlm-substitution': 2, recency: 1 } },
      ],
    };
    expect(anaphoraRankingTable({ ...twoBranches(), anaphoraRanking: fused }, 'b-cat')).toEqual({
      summary: 'rank 1 · borda 0.500 (mlm 1st, recency 2nd)',
      columns: ['Anaphor', 'Antecedent', 'mlm', 'recency', 'Substitution'],
      rows: [['he', 'man', '0.250', '0.500', 'The man']],
    });
    expect(anaphoraRankingTable({ ...twoBranches(), anaphoraRanking: fused }, 'b-dog')).toEqual({
      summary: 'rank 2 · borda 0.500 (mlm 2nd, recency 1st)',
      columns: ['Anaphor', 'Antecedent', 'mlm', 'recency', 'Substitution'],
      rows: [['x4', 'x2', 'n/a', 'n/a', '']],
    });
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
    const document = documentWith({ ...discourse, anaphoraRanking: ranking([['b-dog', 3, 0.894], ['b-cat', 1, 0.908], ['b2-cat', 1, 0.908]]) });
    document.reasoningUpdates = [{
      id: 'ru-n0', premiseElementIds: ['sentence-1'], hypothesisElementIds: ['sentence-1'], logicType: 'fof',
      assignments: [
        assignment('b-cat', { consistent: true, informative: true }),
        assignment('b-cat', { consistent: true, informative: false }),
        assignment('b-cat', { consistent: true, informative: true }),
        assignment('b-dog', undefined, 'collapse failed'),
      ] as any,
    }];

    const { solutions, labels, rankings, render } = discourseBranchesForDisplay(document);

    // The stored PCDRS, A: and P: inline.
    expect(render.map(item => [item.id, item.semantic])).toEqual([['b-cat', 'drs-cat'], ['b-dog', 'drs-dog'], ['b2-cat', 'drs-2']]);
    expect(solutions.map(solution => [solution.id, solution.solution]))
      .toEqual([['b-cat', 'drs-cat'], ['b-dog', 'drs-dog'], ['b2-cat', 'drs-2']]);
    expect(labels[0]).toBe('reading 1/2 · rank 1 · mean score 0.908 · Vampire: neutral ×2, entailment ×1');
    expect(rankings[0]!.rows).toEqual([['it', 'the big cat', '0.908', 'cos 0.82', '', '2']]);
    expect(labels[1]).toContain('reading 1/2 · rank 3');
    expect(labels[1]).toContain('Vampire: failed ×1');
    expect(labels[2]).toContain('reading 2/2');
    expect(labels[2]).not.toContain('Vampire');
    expect(labels[2]).not.toContain('reasoning');
  });

  it('shows the bindings in generation order when there is no ranking', () => {
    const document = documentWith(update([branch('b-dog', [['x4', 'x2']]), branch('b-none', [])]));
    const { solutions, labels } = discourseBranchesForDisplay(document);
    expect(solutions.map(solution => solution.id)).toEqual(['b-dog', 'b-none']);
    expect(labels).toEqual([
      'reading 1/1 · x4 → x2',
      'reading 1/1 · no binding',
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

  const lmTop = (k: number): ReadingSelection => ({ criteria: ['lm'], filters: [], k });

  const idsOf = (result: { readings: DiscourseAnalysis[] }) => result.readings.map(reading => reading.id);

  it('selects before Vampire: the top k places of the global order, everything when unranked', () => {
    const discourse = ranked();
    // Global: the event is first over both readings; the unscored readings come last.
    const top1 = readingsForReasoning(documentWith(discourse), discourse, lmTop(1), 'borda');
    expect(idsOf(top1)).toEqual(['b-event']);
    expect(top1.applied).toBeTrue();
    expect(idsOf(readingsForReasoning(documentWith(discourse), discourse, lmTop(2), 'borda')))
      .toEqual(['b-event', 'b-cat']);

    const plain = update([branch('b-dog', [['x4', 'x2']]), branch('b-cat', [['x4', 'x1']])]);
    const unranked = readingsForReasoning(documentWith(plain), plain, lmTop(1), 'borda');
    expect(idsOf(unranked)).toEqual(['b-dog', 'b-cat']);
    expect(unranked.applied).toBeFalse();
    expect(readingsForReasoning(documentWith(discourse), discourse, ALL_READINGS, 'borda').readings.length).toBe(5);
  });

  it('keeps tied readings together: k counts places', () => {
    const tied = { ...update([branch('a', [['x4', 'x1']]), branch('b', [['x4', 'x1']]), branch('c', [['x4', 'x2']])]),
      anaphoraRanking: ranking([['a', 1, 0.9], ['b', 1, 0.9], ['c', 3, 0.1]]) };
    expect(idsOf(readingsForReasoning(documentWith(tied), tied, lmTop(1), 'borda'))).toEqual(['a', 'b']);
    expect(readingsForReasoning(documentWith(tied), tied, lmTop(2), 'borda').readings.length).toBe(3);
  });

  it('takes the discourse\'s own selection over the session default, and records it', () => {
    const discourse = { ...ranked(), readingSelection: lmTop(2) };
    const result = readingsForReasoning(documentWith(discourse), discourse, ALL_READINGS, 'borda');
    expect(idsOf(result)).toEqual(['b-event', 'b-cat']);
    expect(result.selection).toEqual(lmTop(2));
  });

  it('takes the surface-aligned scoping at top 1, from the discriminants the document stores', () => {
    // "Every Swede is a Scandinavian" after "A Swede won a Nobel prize": two scopings of S1,
    // one PCDRS reading each, nothing else to tell them apart.
    const discourse = update([
      branch('r-surface', [], 'S0-s0+S1-s0'), branch('r-inverse', [], 'S0-s0+S1-s1'),
    ]);
    const document = documentWith(discourse);
    const surfaceTop1: ReadingSelection = { criteria: ['surface', 'binding'], filters: [], k: 1 };
    // Without the discriminants surface is neutral: both share place 1.
    expect(idsOf(readingsForReasoning(document, discourse, surfaceTop1, 'borda')).length).toBe(2);
    document.sentences[0].discriminants = [
      { id: 'sc0', type: 'scope', surfaceAligned: true, associatedSolutions: ['S1-s0'] },
      { id: 'sc1', type: 'scope', surfaceAligned: false, associatedSolutions: ['S1-s1'] },
    ] as any;
    expect(idsOf(readingsForReasoning(document, discourse, surfaceTop1, 'borda'))).toEqual(['r-surface']);
  });

  it('narrows by the discriminants first: the top k is taken over what they leave', () => {
    const multi = (id: string, origin: string, antecedent: string) => branch(id, [['x4', antecedent]], origin);
    const discourse = {
      ...update([multi('r1', 'S0-s0+S1-s0', 'x1'), multi('r2', 'S0-s1+S1-s0', 'x2'), multi('r3', 'S0-s1+S1-s0', 'x3')]),
      anaphoraRanking: ranking([['r1', 1, 0.9], ['r2', 2, 0.5], ['r3', 3, 0.1]]),
    };
    const allowed = new Set(['S0-s1', 'S1-s0']);
    expect(idsOf(readingsForReasoning(documentWith(discourse), discourse, lmTop(1), 'borda', allowed)))
      .toEqual(['r2']);
    expect(idsOf(readingsForReasoning(documentWith(discourse), discourse, ALL_READINGS, 'borda', allowed)))
      .toEqual(['r2', 'r3']);
  });

  it('compares stored results restricted to a selection', () => {
    // All five readings: 2 entailment vs 3 neutral -> neutral. LM top-1 over all readings: the
    // event alone (entailment).
    const document = reasoningOver(ranked(), [
      ['b-dog', 'neutral'], ['b-cat', 'neutral'], ['b-event', 'entailment'], ['b2-cat', 'entailment'], ['b2-dog', 'neutral'],
    ]);

    const all = inferenceResultsFromDocument(document, [item], {})['n0'];
    const top1 = inferenceResultsFromDocument(document, [item], {}, { selection: lmTop(1), averager: 'borda' })['n0'];

    expect(all.predictedLabel).toBe('0');
    expect(all.readingSelection).toEqual({ ...ALL_READINGS, applied: true, used: 5, total: 5 });
    expect(top1.predictedLabel).toBe('1');
    expect(top1.mismatch).toBeFalse();
    expect(top1.readingSelection).toEqual({ ...lmTop(1), applied: true, used: 1, total: 5 });

    // Without an override the report takes every stored assignment: a top-k run only stored
    // the selected ones, so a recorded selection is not applied a second time.
    document.reasoningUpdates![0].readingSelection = { ...lmTop(1), applied: true };
    expect(inferenceResultsFromDocument(document, [item], {})['n0'].predictedLabel).toBe('0');
    expect(inferenceResultsFromDocument(document, [item], {})['n0'].readingSelection)
      .toEqual({ ...lmTop(1), applied: true, used: 5, total: 5 });
  });

  it('counts unlinked assignments, and says when there was no ranking to apply', () => {
    const unranked = reasoningOver(update([branch('b-dog', [['x4', 'x2']]), branch('b-cat', [['x4', 'x1']])]),
      [['b-dog', 'neutral'], ['b-cat', 'neutral']], ['entailment']);
    const { assignments, applied } = selectReasoningAssignments(unranked, unranked.reasoningUpdates![0], lmTop(1), 'borda');
    expect(assignments.length).toBe(3);
    expect(applied).toBeFalse();
  });

  it('reads the selection from Vampire preferences, defaulting to every reading by surface', () => {
    expect(readingSelectionOf(undefined)).toEqual({ criteria: ['surface'], filters: [], k: null });
    expect(readingSelectionOf({ logic_type: 0, model_building: true, max_duration: 10, layered: false }))
      .toEqual({ criteria: ['surface'], filters: [], k: null });
    expect(readingSelectionOf({ logic_type: 0, model_building: true, max_duration: 10, layered: false,
      reading_selection: { criteria: ['lm'], filters: ['unbound'], k: 2.7 } })).toEqual({ criteria: ['lm'], filters: ['unbound'], k: 2 });
  });

  it('lists the readings a run sent to Vampire, verdict or not, and marks the ones it did not send', () => {
    expect(discourseBranchesForDisplay(documentWith(ranked())).counted).toBeUndefined();

    const document = reasoningOver(ranked(), [['b-event', 'entailment']]);
    document.reasoningUpdates![0].assignments.push({
      id: 'pending', premiseSemanticIds: [], hypothesisSemanticIds: [], ruleBranchIndex: 1, checks: {} as any,
      contextTptp: '', discourseUpdateId: 'du-sentence-1', discourseId: 'b-cat',
    });
    document.reasoningUpdates![0].readingSelection = { ...lmTop(2), applied: true };

    const { solutions, labels, counted } = discourseBranchesForDisplay(document);
    expect(counted).toEqual(['b-event', 'b-cat']);
    expect(labels[solutions.findIndex(solution => solution.id === 'b-dog')]).toContain('not sent to Vampire (top 2 by LM)');
    expect(labels[solutions.findIndex(solution => solution.id === 'b-cat')]).toContain('Vampire: not run ×1');
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

  it('carries the reading selection through the settings form', () => {
    const settings = new InferenceSettingsComponent(new FormBuilder());
    settings.toggleCriterion('lm');
    settings.toggleFilter('unbound');
    settings.setTopK('3');
    expect(settings.vampirePreferences.reading_selection).toEqual({ criteria: ['surface', 'lm'], filters: ['unbound'], k: 3 });
    settings.setTopK('all');
    expect(settings.vampirePreferences.reading_selection!.k).toBeNull();

    settings.updateFormFromPreferences({ logic_type: 0, model_building: true, max_duration: 10, layered: false });
    expect(settings.vampirePreferencesForm.value.reading_selection).toEqual({ criteria: ['surface'], filters: [], k: null });
  });

  it('carries the ranker selection through the settings form and restores old sessions with defaults', () => {
    const settings = new InferenceSettingsComponent(new FormBuilder());
    expect(settings.vampirePreferences.anaphora_rankers).toEqual(['mlm-pronoun-product']);

    settings.onRankerSelectionChange({ rankers: ['recency', 'mlm-substitution'], averager: 'weighted' });
    expect(settings.vampirePreferences.anaphora_rankers).toEqual(['recency', 'mlm-substitution']);
    expect(settings.vampirePreferences.anaphora_averager).toBe('weighted');

    settings.updateFormFromPreferences({ logic_type: 0, model_building: true, max_duration: 10, layered: false });
    expect(settings.vampirePreferencesForm.value.anaphora_rankers).toEqual(['mlm-pronoun-product']);
    expect(settings.vampirePreferencesForm.value.anaphora_averager).toBe('borda');
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

    service.rank(documentWith(), discourseUpdate, COSINE).subscribe(result => results.push(result));
    service.rank(documentWith(), discourseUpdate, COSINE).subscribe(result => results.push(result));
    expect(dataService.lmRankAnaphora).toHaveBeenCalledTimes(1);
    expect(dataService.lmRankAnaphora.calls.first().args[0].methods).toEqual(['cosine-description']);

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

    service.rankAndAttach(() => documentWith(discourseUpdate), discourseUpdate, COSINE)
      .subscribe({ next: value => outcome = value, error: () => errored = true });

    expect(errored).toBeFalse();
    expect(outcome?.result).toEqual({ status: 'unavailable', reason: 'lm service unreachable' });
    expect(outcome?.update).toBeNull();
  });

  it('does not call lm when there is nothing to rank', () => {
    let result: AnaphoraRankingResult | undefined;
    service.rank(documentWith(), update([branch('b', [])]), COSINE).subscribe(value => result = value);
    expect(result?.status).toBe('not-applicable');
    expect(dataService.lmRankAnaphora).not.toHaveBeenCalled();
  });

  it('drops a ranking whose update was replaced while lm was working', () => {
    const pending = new Subject<AnaphoraRanking>();
    dataService.lmRankAnaphora.and.returnValue(pending);
    const asked = update([branch('b-cat', [['x4', 'x1']])]);
    let current = documentWith(asked);
    let outcome: AnaphoraRankingOutcome | undefined;

    service.rankAndAttach(() => current, asked, COSINE).subscribe(value => outcome = value);
    current = documentWith(update([branch('b-new', [['x4', 'x2']])]));
    pending.next(ranking([['b-cat', 1, 0.8]]));
    pending.complete();

    expect(outcome?.result.status).toBe('ranked');
    expect(outcome?.update).toBeNull();
  });
});
