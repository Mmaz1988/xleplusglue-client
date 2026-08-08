import {
  compositeAnalysisId,
  findElementById,
  resolveElement,
  selectedSentenceSemantics,
  validateAnalysisDocument,
  validateSentenceAnalysis,
  validateSequenceAnalysis,
} from './analysis-model';
import { SentenceAnalysis, SequenceAnalysis, XlePlusGlueDocument } from './models/models';

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
      graph: { graphElements: [] },
    }],
    semantics: [
      { syntacticOrigin: 'syn-1', semId: 'sem-1', semString: 'P', semType: 'lfgxdrt' },
      { syntacticOrigin: 'syn-1', semId: 'sem-2', semString: 'Q', semType: 'lfgxdrt' },
    ],
    synSemMapping: { 'syn-1': ['sem-1', 'sem-2'] },
  });

  const sequence = (): SequenceAnalysis => ({
    id: 'seq-1',
    text: 'A sentence. Another sentence.',
    sentenceIds: ['sentence-1'],
    syntax: [{
      synId: 'syn-1+syn-2',
      structure,
      graph: { graphElements: [] },
    }],
    semantics: [
      { syntacticOrigin: 'syn-1+syn-2', semId: 'sem-1+sem-3', semString: 'P & Q', semType: 'lfgxdrt' },
    ],
    synSemMapping: { 'syn-1+syn-2': ['sem-1+sem-3'] },
  });

  const document = (): XlePlusGlueDocument => ({
    id: 'doc-1',
    semanticType: 'lfgxdrt',
    sentences: [sentence()],
    sequences: [sequence()],
    elements: [
      { kind: 'sentence', id: 'sentence-1' },
      { kind: 'sequence', id: 'seq-1' },
    ],
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

  describe('validateSequenceAnalysis', () => {
    it('accepts a sequence whose syntax origins and sentenceIds all resolve', () => {
      expect(() => validateSequenceAnalysis(document(), sequence())).not.toThrow();
    });

    it('rejects a sequence with an unknown syntactic origin', () => {
      const invalid = sequence();
      invalid.semantics[0].syntacticOrigin = 'missing-syntax';
      expect(() => validateSequenceAnalysis(document(), invalid)).toThrow();
    });

    it('rejects a sequence referencing a sentence id absent from SENTENCES', () => {
      const invalid = sequence();
      invalid.sentenceIds = ['sentence-1', 'ghost-sentence'];
      expect(() => validateSequenceAnalysis(document(), invalid)).toThrow();
    });
  });

  describe('resolveElement / findElementById', () => {
    it('resolves a sentence ref against SENTENCES', () => {
      const doc = document();
      expect(resolveElement(doc, { kind: 'sentence', id: 'sentence-1' })).toBe(doc.sentences[0]);
    });

    it('resolves a sequence ref against SEQUENCES', () => {
      const doc = document();
      expect(resolveElement(doc, { kind: 'sequence', id: 'seq-1' })).toBe(doc.sequences[0]);
    });

    it('returns undefined for a ref that resolves against neither registry', () => {
      const doc = document();
      expect(resolveElement(doc, { kind: 'sentence', id: 'ghost' })).toBeUndefined();
      expect(findElementById(doc, 'ghost')).toBeUndefined();
    });

    it('finds either kind by id alone', () => {
      const doc = document();
      expect(findElementById(doc, 'sentence-1')).toBe(doc.sentences[0]);
      expect(findElementById(doc, 'seq-1')).toBe(doc.sequences[0]);
    });
  });

  describe('validateAnalysisDocument', () => {
    it('accepts a well-formed document', () => {
      expect(() => validateAnalysisDocument(document())).not.toThrow();
    });

    it('throws when an elements ref does not resolve against sentences/sequences', () => {
      const doc = document();
      doc.elements.push({ kind: 'sentence', id: 'ghost' });
      expect(() => validateAnalysisDocument(doc)).toThrow();
    });
  });
});
