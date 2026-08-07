import {
  compositeAnalysisId,
  selectedSentenceSemantics,
  validateSentenceAnalysis,
} from './analysis-model';
import { SentenceAnalysis } from './models/models';

describe('analysis model helpers', () => {
  const structure = {
    constraints: [],
    annotations: [],
    choiceSpace: {},
  };

  const sentence = (): SentenceAnalysis => ({
    id: 'sentence-1',
    text: 'A sentence.',
    syntax: [{
      synId: 'syn-1',
      structure,
      graph: { graphElements: [], semantics: '' },
    }],
    semantics: [
      { syntacticOrigin: 'syn-1', semId: 'sem-1', semString: 'P', semType: 'lfgxdrt' },
      { syntacticOrigin: 'syn-1', semId: 'sem-2', semString: 'Q', semType: 'lfgxdrt' },
    ],
    synSemMapping: { 'syn-1': ['sem-1', 'sem-2'] },
  });

  it('creates ordered composite IDs', () => {
    expect(compositeAnalysisId(['syn-1', 'syn-4'])).toBe('syn-1+syn-4');
  });

  it('uses only selected sentence semantics without deleting alternatives', () => {
    const value = sentence();
    value.selectedSemanticIds = ['sem-2'];

    expect(selectedSentenceSemantics(value).map(semantic => semantic.semId)).toEqual(['sem-2']);
    expect(value.semantics.map(semantic => semantic.semId)).toEqual(['sem-1', 'sem-2']);
  });

  it('validates syntax origins and semantic mappings', () => {
    expect(() => validateSentenceAnalysis(sentence())).not.toThrow();
    const invalid = sentence();
    invalid.semantics[0].syntacticOrigin = 'missing-syntax';
    expect(() => validateSentenceAnalysis(invalid)).toThrow();
  });
});
