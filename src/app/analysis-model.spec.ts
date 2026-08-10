import {
  compositeAnalysisId,
  discourseStructureId,
  findElementById,
  majorityVerdict,
  majorityVote,
  nliLabelFromVerdicts,
  parseReasoningAssignmentId,
  reasoningAssignmentId,
  reasoningUpdateId,
  resolveElement,
  selectedSentenceSemantics,
  validateAnalysisDocument,
  validateSentenceAnalysis,
  validateSequenceAnalysis,
} from './analysis-model';
import {
  ReasoningCheckSet,
  ReasoningVerdict,
  SentenceAnalysis,
  SequenceAnalysis,
  XlePlusGlueDocument,
} from './models/models';

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

  describe('discourseStructureId', () => {
    it('keys tier A by the semantic id alone and tier B by semantic id + rule branch', () => {
      expect(discourseStructureId('sem-1+sem-3')).toBe('sem-1+sem-3');
      expect(discourseStructureId('sem-1+sem-3', 1)).toBe('sem-1+sem-3-rule-1');
    });

    it('separates rule branches so mappings sharing a branch collapse onto one key', () => {
      // Two PCDRS mappings off rule branch 2 must produce the same structure key -- that is
      // the deduplication DiscourseUpdate.structures exists for.
      expect(discourseStructureId('sem-1', 2)).toBe(discourseStructureId('sem-1', 2));
      expect(discourseStructureId('sem-1', 2)).not.toBe(discourseStructureId('sem-1', 3));
    });
  });

  describe('reasoning layer', () => {
    const checks = (): ReasoningCheckSet => ({
      info_pos_check: { tptp: 'fof(a).' },
      info_neg_check: { tptp: 'fof(b).' },
      cons_pos_check: { tptp: 'fof(c).' },
      cons_neg_check: { tptp: 'fof(d).' },
    });

    const verdict = (consistent: boolean, informative: boolean): ReasoningVerdict =>
      ({ consistent, informative, relevant: true });

    /** sentence-1 is the premise, seq-1 the hypothesis -- an N+M pair rather than the
     *  1+1 chat case, so the positional side alignment is actually exercised. */
    const reasoningDocument = (): XlePlusGlueDocument => {
      const doc = document();
      doc.discourseUpdates = [{
        id: 'du-seq-1',
        sourceElementId: 'seq-1',
        sourceElementKind: 'sequence',
        structures: { 'sem-1+sem-3-rule-1': structure },
        discourse: [{
          id: 'mapping-7',
          semanticOrigin: 'sem-1+sem-3',
          drsString: 'P & Q',
          structureId: 'sem-1+sem-3-rule-1',
          anaphoraMapping: { relations: [] },
          collapsed: true,
        }],
        semDiscourseMapping: { 'sem-1+sem-3': ['mapping-7'] },
      }];
      const updateId = reasoningUpdateId(['sentence-1'], ['seq-1']);
      doc.reasoningUpdates = [{
        id: updateId,
        premiseElementIds: ['sentence-1'],
        hypothesisElementIds: ['seq-1'],
        logicType: 'fof',
        assignments: [{
          id: reasoningAssignmentId({
            updateId,
            premiseSemanticIds: ['sem-1'],
            hypothesisSemanticIds: ['sem-1+sem-3'],
            ruleBranchIndex: 1,
            anaphoraBranchId: 'mapping-7',
          }),
          premiseSemanticIds: ['sem-1'],
          hypothesisSemanticIds: ['sem-1+sem-3'],
          ruleBranchIndex: 1,
          discourseUpdateId: 'du-seq-1',
          discourseId: 'mapping-7',
          contextTptp: 'fof(context).',
          checks: checks(),
        }],
      }];
      return doc;
    };

    it('round-trips an assignment id through every component', () => {
      const id = reasoningAssignmentId({
        updateId: 'ru-n0',
        premiseSemanticIds: ['sem-1', 'sem-2'],
        hypothesisSemanticIds: ['sem-4'],
        ruleBranchIndex: 2,
        anaphoraBranchId: 'sem-1+sem-4-pcdrs-3',
      });

      expect(id).toBe('ru-n0/P[sem-1,sem-2]/H[sem-4]/r2/msem-1+sem-4-pcdrs-3');
      expect(parseReasoningAssignmentId(id)).toEqual({
        updateId: 'ru-n0',
        premiseSemanticIds: ['sem-1', 'sem-2'],
        hypothesisSemanticIds: ['sem-4'],
        ruleBranchIndex: 2,
        anaphoraBranchId: 'sem-1+sem-4-pcdrs-3',
      });
    });

    it('keeps ids parseable when a mapping id contains the separators', () => {
      const id = reasoningAssignmentId({
        updateId: 'ru-n0',
        premiseSemanticIds: ['sem-1'],
        hypothesisSemanticIds: ['sem-2'],
        ruleBranchIndex: 0,
        anaphoraBranchId: 'branch/with/slashes+and+pluses',
      });

      expect(parseReasoningAssignmentId(id).anaphoraBranchId).toBe('branch/with/slashes+and+pluses');
      expect(parseReasoningAssignmentId(id).updateId).toBe('ru-n0');
    });

    it('prefers an explicit item id for the update id and falls back to element scope', () => {
      expect(reasoningUpdateId(['sentence-1'], ['sentence-2'], 'n0')).toBe('ru-n0');
      expect(reasoningUpdateId(['sentence-1', 'sentence-2'], ['sentence-3']))
        .toBe('ru-sentence-1+sentence-2=>sentence-3');
    });

    it('rejects a malformed assignment id', () => {
      expect(() => parseReasoningAssignmentId('ru-n0/nonsense')).toThrow();
    });

    it('accepts a well-formed reasoning update', () => {
      expect(() => validateAnalysisDocument(reasoningDocument())).not.toThrow();
    });

    it('throws when the four check names are not exactly present', () => {
      const doc = reasoningDocument();
      delete (doc.reasoningUpdates![0].assignments[0].checks as any).cons_neg_check;
      expect(() => validateAnalysisDocument(doc)).toThrowError(/must carry exactly the checks/);
    });

    it('allows a failed assignment to omit its checks', () => {
      const doc = reasoningDocument();
      doc.reasoningUpdates![0].assignments[0].checks = {} as ReasoningCheckSet;
      doc.reasoningUpdates![0].assignments[0].failure = 'collapse failed';
      expect(() => validateAnalysisDocument(doc)).not.toThrow();
    });

    it('throws when the discourse pointer does not resolve', () => {
      const doc = reasoningDocument();
      doc.reasoningUpdates![0].assignments[0].discourseId = 'ghost-mapping';
      expect(() => validateAnalysisDocument(doc)).toThrowError(/unknown discourse analysis/);
    });

    it('throws when only one half of the discourse pointer is set', () => {
      const doc = reasoningDocument();
      delete doc.reasoningUpdates![0].assignments[0].discourseUpdateId;
      expect(() => validateAnalysisDocument(doc)).toThrowError(/both discourseUpdateId and discourseId/);
    });

    it('throws when a premise element id does not resolve', () => {
      const doc = reasoningDocument();
      doc.reasoningUpdates![0].premiseElementIds = ['ghost'];
      expect(() => validateAnalysisDocument(doc)).toThrowError(/unknown premise element/);
    });

    it('throws when semantic ids are not positionally aligned with their elements', () => {
      const doc = reasoningDocument();
      doc.reasoningUpdates![0].assignments[0].premiseSemanticIds = ['sem-1', 'sem-2'];
      expect(() => validateAnalysisDocument(doc)).toThrowError(/semantic ids for/);
    });

    it('throws when a semantic id is not a reading of the element at its position', () => {
      const doc = reasoningDocument();
      doc.reasoningUpdates![0].assignments[0].premiseSemanticIds = ['sem-1+sem-3'];
      expect(() => validateAnalysisDocument(doc)).toThrowError(/not a reading of sentence-1/);
    });

    it('throws when an assignment id does not belong to its update', () => {
      const doc = reasoningDocument();
      doc.reasoningUpdates![0].assignments[0].id =
        doc.reasoningUpdates![0].assignments[0].id.replace('ru-', 'ru-other-');
      expect(() => validateAnalysisDocument(doc)).toThrowError(/does not belong to reasoning update/);
    });

    it('throws on duplicate assignment ids', () => {
      const doc = reasoningDocument();
      const update = doc.reasoningUpdates![0];
      update.assignments.push({ ...update.assignments[0] });
      expect(() => validateAnalysisDocument(doc)).toThrowError(/duplicate assignment id/);
    });

    it('votes by strict majority, resolving ties to false', () => {
      expect(majorityVote([true, true, false])).toBe(true);
      expect(majorityVote([true, false])).toBe(false);
      expect(majorityVote([true])).toBe(true);
      expect(majorityVote([])).toBe(false);
    });

    it('derives the NLI label -- consistent but uninformative means entailment', () => {
      expect(nliLabelFromVerdicts(true, false)).toBe('1');
      expect(nliLabelFromVerdicts(true, true)).toBe('0');
      expect(nliLabelFromVerdicts(false, true)).toBe('-1');
      expect(nliLabelFromVerdicts(false, false)).toBe('-1');
    });

    it('aggregates assignment verdicts and ignores unscored assignments', () => {
      const base = reasoningDocument().reasoningUpdates![0].assignments[0];
      const aggregated = majorityVerdict([
        { ...base, id: 'a', verdict: verdict(true, false) },
        { ...base, id: 'b', verdict: verdict(true, false) },
        { ...base, id: 'c', verdict: verdict(false, true) },
        { ...base, id: 'd' },
      ]);

      expect(aggregated?.label).toBe('1');
      expect(aggregated?.consistent).toBe(true);
      expect(aggregated?.informative).toBe(false);
      expect(aggregated?.assignmentIds).toEqual(['a', 'b', 'c']);
    });

    it('returns no aggregate verdict when nothing has been scored', () => {
      expect(majorityVerdict([])).toBeUndefined();
    });
  });
});
