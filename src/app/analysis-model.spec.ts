import {
  compositeAnalysisId,
  discourseStructureId,
  findElementById,
  inferenceResultsFromDocument,
  majorityVerdict,
  majorityVote,
  nliLabelFromVerdicts,
  parseReasoningAssignmentId,
  reasoningAssignmentId,
  reasoningUpdateId,
  resolveElement,
  selectedSentenceSemantics,
  selectedSentenceSyntax,
  validateAnalysisDocument,
  validateSentenceAnalysis,
  validateSequenceAnalysis,
} from './analysis-model';
import {
  ReasoningCheckSet,
  ReasoningVerdict,
  RegressionTestingSession,
  SentenceAnalysis,
  SequenceAnalysis,
  XlePlusGlueDocument,
  createRegressionTestingSession,
  regressionDocumentToSession,
  regressionSessionToDocument,
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

    it('rejects a sequence referencing the same sentence id twice', () => {
      // Regression for the captured reset-corruption bug (see
      // docs/plans/DOCUMENT_BUILDER_UNIFICATION_PLAN.md,
      // misc/analysis-document-1787160588928.json): a sequence with
      // sentenceIds ['sentence-1', 'sentence-2', 'sentence-2'] previously passed
      // validation even though a discourse never merges an existing sentence with
      // itself.
      const doc = document();
      doc.sentences.push({ ...sentence(), id: 'sentence-2', synSemMapping: {}, semantics: [], syntax: [] });
      const invalid = sequence();
      invalid.sentenceIds = ['sentence-1', 'sentence-2', 'sentence-2'];
      expect(() => validateSequenceAnalysis(doc, invalid)).toThrowError(/more than once/);
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

  describe('regression v3 session shape', () => {
    const checks = (): ReasoningCheckSet => ({
      info_pos_check: { tptp: 'fof(a).' },
      info_neg_check: { tptp: 'fof(b).' },
      cons_pos_check: { tptp: 'fof(c).' },
      cons_neg_check: { tptp: 'fof(d).' },
    });

    /** One NLI item's reasoning update, keyed by the item id the way regression mints it. */
    const regressionDocument = (label: boolean): XlePlusGlueDocument => {
      const doc = document();
      const updateId = reasoningUpdateId(['S1'], ['S2'], 'n3');
      const assignment = (suffix: string, verdictValue: ReasoningVerdict) => ({
        id: reasoningAssignmentId({
          updateId,
          premiseSemanticIds: ['sem-1'],
          hypothesisSemanticIds: ['sem-2'],
          ruleBranchIndex: 1,
          anaphoraBranchId: suffix,
        }),
        premiseSemanticIds: ['sem-1'],
        hypothesisSemanticIds: ['sem-2'],
        ruleBranchIndex: 1,
        contextTptp: 'fof(context).',
        checks: checks(),
        verdict: verdictValue,
      });
      doc.reasoningUpdates = [{
        id: updateId,
        premiseElementIds: ['S1'],
        hypothesisElementIds: ['S2'],
        itemId: 'n3',
        logicType: 'fof',
        assignments: [
          assignment('m1', { consistent: true, informative: label, relevant: true, glyph: 'g1' }),
          assignment('m2', { consistent: true, informative: label, relevant: true, glyph: 'g2' }),
        ],
      }];
      return doc;
    };

    it('mints a regression update id from the item id, not the element pair', () => {
      expect(reasoningUpdateId(['S1'], ['S2'], 'n3')).toBe('ru-n3');
    });

    it('derives inference results from the document reasoning updates', () => {
      const results = inferenceResultsFromDocument(
        regressionDocument(false),
        [{ id: 'n3', gold_label: '1' }],
        { S1: 'A man walks.', S2: 'Someone walks.' });

      // consistent and NOT informative -> the conclusion follows: entailment.
      expect(results['n3'].predictedLabel).toBe('1');
      expect(results['n3'].mismatch).toBeFalse();
      expect(results['n3'].premises).toEqual(['A man walks.']);
      expect(results['n3'].conclusion).toBe('Someone walks.');
      expect(results['n3'].glyphs).toEqual(['g1', 'g2']);
    });

    it('yields nothing for an item with no reasoning update', () => {
      const results = inferenceResultsFromDocument(
        regressionDocument(false), [{ id: 'n9', gold_label: '1' }], {});

      expect(results['n9']).toBeUndefined();
    });

    it('round-trips one document per NLI item through the v4 session shape', () => {
      const session: RegressionTestingSession = {
        ...createRegressionTestingSession(),
        analysisDocuments: { n3: regressionDocument(true) },
      };

      const stored = regressionSessionToDocument(session);
      expect(stored.schemaVersion).toBe(4);
      expect(stored.analysis.documents['n3'].reasoningUpdates!.length).toBe(1);

      const restored = regressionDocumentToSession(stored);
      expect(restored.analysisDocuments['n3'].reasoningUpdates![0].id).toBe('ru-n3');
      expect(restored.analysisDocuments['n3'].reasoningUpdates![0].assignments.length).toBe(2);
    });

    it('keeps each item\'s document separate, so one item cannot see another\'s readings', () => {
      const session: RegressionTestingSession = {
        ...createRegressionTestingSession(),
        analysisDocuments: { n3: regressionDocument(true), n4: regressionDocument(true) },
      };

      const stored = regressionSessionToDocument(session);
      const restored = regressionDocumentToSession(stored);

      expect(Object.keys(restored.analysisDocuments).sort()).toEqual(['n3', 'n4']);
      expect(restored.analysisDocuments['n3']).not.toBe(restored.analysisDocuments['n4']);
      expect(restored.analysisDocuments['n3'].sentences)
        .not.toBe(restored.analysisDocuments['n4'].sentences);
    });

    it('does not persist check graphs, which is what makes autosave unmanageable', () => {
      const session: RegressionTestingSession = {
        ...createRegressionTestingSession(),
        analysisDocuments: { n3: regressionDocument(true) },
      };
      const heavy = session.analysisDocuments['n3'].reasoningUpdates![0].assignments[0].checks;
      (heavy.info_pos_check as any).graph = structure;
      (heavy.info_pos_check as any).semanticSvg = '<svg/>';

      const stored = regressionSessionToDocument(session);
      const persisted = stored.analysis.documents['n3'].reasoningUpdates![0].assignments[0].checks;
      expect(persisted.info_pos_check.tptp).toBe(heavy.info_pos_check.tptp);
      expect(persisted.info_pos_check.graph).toBeUndefined();
      expect(persisted.info_pos_check.semanticSvg).toBeUndefined();
    });

    it('reads a v2 session, which has no documents, as an empty map', () => {
      const v2 = {
        schemaVersion: 2,
        metadata: { id: 'session-1', redisSessionKey: 'session-1' },
        inputs: {},
        analysis: { system: {}, human: {}, save_state: {} },
      };

      const restored = regressionDocumentToSession(v2);
      expect(restored.analysisDocuments).toEqual({});
    });

    it('ignores a legacy v3 single document instead of guessing at a partition', () => {
      // v2/v3 sessions are refused by the store, so this shape never reaches the client.
      // If one somehow did, inventing a partition here would guess at item membership.
      const v3 = {
        schemaVersion: 3,
        metadata: { id: 'session-1', redisSessionKey: 'session-1' },
        inputs: {},
        analysis: { system: {}, human: {}, save_state: {}, document: regressionDocument(true) },
      };

      const restored = regressionDocumentToSession(v3);
      expect(restored.analysisDocuments).toEqual({});
    });
  });

  describe('selectedSentenceSyntax', () => {
    const sentence = (selected?: string[]): any => ({
      id: 'sentence-1', text: 'ambiguous',
      syntax: [{ synId: 'S0' }, { synId: 'S1' }, { synId: 'S2' }],
      semantics: [
        { semId: 'a', syntacticOrigin: 'S0' }, { semId: 'b', syntacticOrigin: 'S0' },
        { semId: 'c', syntacticOrigin: 'S1' },
        { semId: 'd', syntacticOrigin: 'S2' },
      ],
      synSemMapping: { S0: ['a', 'b'], S1: ['c'], S2: ['d'] },
      ...(selected ? { selectedSemanticIds: selected } : {}),
    });

    /** The point of SYNSEM_MAPPING being a disjoint partition: disambiguating semantically
     *  tells you exactly which syntactic analyses no longer have a reading. */
    it('drops syntax whose readings were all deselected', () => {
      const surviving = selectedSentenceSyntax(sentence(['c']));
      expect(surviving.map(s => s.synId)).toEqual(['S1']);
    });

    it('keeps a syntax that retains at least one selected reading', () => {
      const surviving = selectedSentenceSyntax(sentence(['b', 'd']));
      expect(surviving.map(s => s.synId)).toEqual(['S0', 'S2']);
    });

    it('narrows an explicit selection only -- never invents one', () => {
      expect(selectedSentenceSyntax(sentence()).map(s => s.synId)).toEqual(['S0', 'S1', 'S2']);
    });

    it('leaves a sentence whose readings are not derived yet untouched', () => {
      // Normal for an appended sentence: its syntax is registered, its readings live in
      // the sequence.
      const notYetDerived: any = {
        id: 'sentence-2', text: 'the woman smiled',
        syntax: [{ synId: 'S0' }], semantics: [], synSemMapping: {},
        selectedSemanticIds: [],
      };
      expect(selectedSentenceSyntax(notYetDerived).map((s: any) => s.synId)).toEqual(['S0']);
    });

    it('does not strip everything when a selection matches nothing', () => {
      // Better to over-supply than to hand LiGER an empty parsedSentences entry.
      expect(selectedSentenceSyntax(sentence(['nonexistent'])).map(s => s.synId))
        .toEqual(['S0', 'S1', 'S2']);
    });
  });
});
