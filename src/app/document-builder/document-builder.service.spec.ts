import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { DocumentBuilderService } from './document-builder.service';
import { DataService } from '../data.service';
import { validateSequenceAnalysis } from '../analysis-model';
import { GswbSolution, SentenceAnalysis, SequenceAnalysis, XlePlusGlueDocument } from '../models/models';

describe('DocumentBuilderService', () => {
  let service: DocumentBuilderService;
  let dataServiceMock: { gswbMergeSequenceSemantics: jasmine.Spy; ligerSequence: jasmine.Spy; gswbDeduce: jasmine.Spy };

  const structure = { constraints: [], annotations: [], choiceSpace: {} };

  const sentence = (id: string, text: string, synId = `syn-${id}`): SentenceAnalysis => ({
    id,
    text,
    syntax: [{ synId, structure, graph: { graphElements: [] } }],
    semantics: [{ syntacticOrigin: synId, semId: `sem-${id}`, semString: 'P', semType: 'lfgxdrt' }],
    synSemMapping: { [synId]: [`sem-${id}`] },
  });

  const sequence = (id: string, sentenceIds: string[]): SequenceAnalysis => ({
    id,
    text: 'merged text',
    sentenceIds,
    syntax: [{ synId: `syn-${id}`, structure, graph: { graphElements: [] } }],
    semantics: [{ syntacticOrigin: `syn-${id}`, semId: `sem-${id}`, semString: 'P & Q', semType: 'lfgxdrt' }],
    synSemMapping: { [`syn-${id}`]: [`sem-${id}`] },
  });

  /** A LiGER sequence response for two sentences, tagged so its merged syntax id is
   *  distinguishable across calls. */
  const ligerSequenceResponse = (mergedSynId: string, sentences: SentenceAnalysis[]) => ({
    solutions: [{
      sequenceAnalysis: {
        id: mergedSynId,
        text: sentences.map(s => s.text).join('\n'),
        sentences: sentences.map(s => ({ id: s.id, text: s.text })),
        syntax: [{ synId: mergedSynId, structure, graph: { graphElements: [] } }],
        semantics: [],
        synSemMapping: {},
      },
    }],
  });

  beforeEach(() => {
    dataServiceMock = {
      gswbMergeSequenceSemantics: jasmine.createSpy('gswbMergeSequenceSemantics'),
      ligerSequence: jasmine.createSpy('ligerSequence'),
      gswbDeduce: jasmine.createSpy('gswbDeduce'),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: DataService, useValue: dataServiceMock }],
    });
    service = TestBed.inject(DocumentBuilderService);
  });

  describe('newDocument', () => {
    it('builds an empty document keyed on the given session id and semantic type', () => {
      const doc = service.newDocument('session-1', 'lfgxdrt');

      expect(doc).toEqual({
        id: 'session-1',
        semanticType: 'lfgxdrt',
        sentences: [],
        sequences: [],
        elements: [],
      });
    });

    it('returns a fresh object on every call, not a shared mutable default', () => {
      const first = service.newDocument('a', 'lfgxdrt');
      first.sentences.push(sentence('s1', 'First.'));

      const second = service.newDocument('b', 'lfgxdrt');

      expect(second.sentences).toEqual([]);
    });
  });

  describe('upsertSentenceAnalyses', () => {
    let document: XlePlusGlueDocument;

    beforeEach(() => {
      document = service.newDocument('session-1', 'lfgxdrt');
    });

    it('registers a new sentence and its element ref', () => {
      service.upsertSentenceAnalyses(document, [sentence('s1', 'First sentence.')]);

      expect(document.sentences.length).toBe(1);
      expect(document.sentences[0].id).toBe('s1');
      expect(document.elements).toEqual([{ kind: 'sentence', id: 's1' }]);
      expect(document.activeElementId).toBe('s1');
    });

    it('unions syntax/semantics into an existing sentence with matching text, never discarding an alternative', () => {
      service.upsertSentenceAnalyses(document, [sentence('s1', 'First sentence.')]);

      const secondReading = sentence('s1', 'First sentence.');
      secondReading.syntax = [{ synId: 'syn-s1-b', structure, graph: { graphElements: [] } }];
      secondReading.semantics = [{ syntacticOrigin: 'syn-s1-b', semId: 'sem-s1-b', semString: 'Q', semType: 'lfgxdrt' }];
      secondReading.synSemMapping = { 'syn-s1-b': ['sem-s1-b'] };
      service.upsertSentenceAnalyses(document, [secondReading]);

      expect(document.sentences.length).toBe(1);
      expect(document.elements.length).toBe(1);
      expect(document.sentences[0].syntax.map(s => s.synId).sort()).toEqual(['syn-s1', 'syn-s1-b']);
      expect(document.sentences[0].semantics.map(s => s.semId).sort()).toEqual(['sem-s1', 'sem-s1-b']);
    });

    it('throws rather than silently keeping stale text when an id is reused for a different sentence', () => {
      // The captured reset-corruption bug: a new discourse's sentence-1 must never
      // silently merge into an old discourse's sentence-1 under one id.
      service.upsertSentenceAnalyses(document, [sentence('sentence-1', 'a man saw a woman')]);

      expect(() => service.upsertSentenceAnalyses(document, [sentence('sentence-1', 'a different sentence')]))
        .toThrowError(/different text/);
      // The original entry must survive the rejected merge untouched.
      expect(document.sentences[0].text).toBe('a man saw a woman');
    });
  });

  describe('upsertSequenceAnalyses', () => {
    let document: XlePlusGlueDocument;

    beforeEach(() => {
      document = service.newDocument('session-1', 'lfgxdrt');
      service.upsertSentenceAnalyses(document, [sentence('s1', 'First.'), sentence('s2', 'Second.')]);
    });

    it('registers a new sequence and its element ref', () => {
      service.upsertSequenceAnalyses(document, [sequence('seq-1', ['s1', 's2'])]);

      expect(document.sequences.length).toBe(1);
      expect(document.sequences[0].id).toBe('seq-1');
      expect(document.elements).toEqual([
        { kind: 'sentence', id: 's1' },
        { kind: 'sentence', id: 's2' },
        { kind: 'sequence', id: 'seq-1' },
      ]);
    });

    it('preserves position on update instead of moving the entry to the end', () => {
      service.upsertSequenceAnalyses(document, [sequence('seq-1', ['s1', 's2'])]);
      service.upsertSequenceAnalyses(document, [sequence('seq-0', ['s1'])]);

      const updated = sequence('seq-1', ['s1', 's2']);
      updated.text = 'updated text';
      service.upsertSequenceAnalyses(document, [updated]);

      expect(document.sequences.map(s => s.id)).toEqual(['seq-1', 'seq-0']);
      expect(document.sequences[0].text).toBe('updated text');
      // No duplicate element ref was appended for the update.
      expect(document.elements.filter(ref => ref.id === 'seq-1').length).toBe(1);
    });
  });

  describe('mergeSequence', () => {
    const previousSentence = sentence('sentence-1', 'A man appeared.');
    const previousContext = { semantic: previousSentence.semantics[0], element: previousSentence };

    const mergedSolution = (id: string): GswbSolution => ({
      id, solution: 'merged', solutionKey: id, graph: structure, semantic: 'merged semantic',
    });

    it('merges one current reading against one previous context and registers one sequence', () => {
      dataServiceMock.gswbMergeSequenceSemantics.and.returnValue(of(mergedSolution('merged-1')));
      dataServiceMock.ligerSequence.and.returnValue(
        of(ligerSequenceResponse('syn-seq-a', [previousSentence, sentence('sentence-2', 'A woman appeared.')])));

      const currentSentence = sentence('sentence-2', 'A woman appeared.');
      let result: any;
      service.mergeSequence({
        current: [{ solution: mergedSolution('cur-1'), semantic: currentSentence.semantics[0], sentenceAnalysis: currentSentence }],
        previousContexts: [previousContext],
        knownSentences: [previousSentence, currentSentence],
        resolveDrs: true,
      }).subscribe(r => result = r);

      expect(dataServiceMock.gswbMergeSequenceSemantics).toHaveBeenCalledTimes(1);
      expect(dataServiceMock.ligerSequence).toHaveBeenCalledTimes(1);
      expect(result.pairs.length).toBe(1);
      expect(result.sequenceAnalyses.length).toBe(1);
      expect(result.sequenceAnalyses[0].id).toBe('sentence-1+sentence-2');
      expect(result.sequenceAnalyses[0].sentenceIds).toEqual(['sentence-1', 'sentence-2']);
    });

    it('groups two syntax variants of the same sentence pair into ONE SequenceAnalysis with two syntax entries, not two separate sequences', () => {
      // Regression for the "multiple sequences per sentence pair" defect, confirmed
      // live via misc/current/analysis-document-syntactic-ambiguity.json: 3 syntactic
      // analyses x 1 previously produced 3 separate SequenceAnalysis entries instead of
      // one with .syntax.length === 3. This is the 2-variant version of that.
      //
      // Each merge's own semanticAnalysis.syntacticOrigin is deliberately set to an
      // UNRELATED id (mimicking GSWB's real /merge_sequence_semantics response, whose
      // syntacticOrigin comes from its own solutionKey/parentId scheme -- a different
      // namespace from LiGER's merged syntax ids). This is the exact shape of a real
      // regression: the first cut of this method trusted that unrelated id as the
      // synSemMapping key instead of overwriting it with the syntax merge's own id,
      // producing a document where a semantic's syntacticOrigin didn't match any of its
      // sequence's syntax entries -- confirmed live via
      // misc/current/analysis-document-3x3syntaxambiguity.json (valid: false,
      // "has unknown sequence syntax origin"). Only asserting `.syntax` ids (as the
      // original version of this test did) does NOT catch that -- this test now also
      // asserts syntacticOrigin/synSemMapping consistency and runs the real validator.
      dataServiceMock.gswbMergeSequenceSemantics.and.callFake((request: any) =>
        of({
          ...mergedSolution(request.parentSolutionId),
          semanticAnalysis: {
            syntacticOrigin: 'unrelated-gswb-key', semId: request.parentSolutionId,
            semString: 'merged semantic', semType: 'lfgxdrt',
          },
        }));
      let ligerCallCount = 0;
      dataServiceMock.ligerSequence.and.callFake(() => {
        // Two distinct current-sentence structures parsed differently -> LiGER assigns
        // each pairing its own merged syntax id, exactly as it would for a genuinely
        // syntactically ambiguous sentence. Discriminated by call order since both
        // variants share the same sentence id (they're readings of the same sentence).
        ligerCallCount += 1;
        const mergedSynId = ligerCallCount === 1 ? 'syn-seq-a' : 'syn-seq-b';
        return of(ligerSequenceResponse(mergedSynId, [previousSentence, sentence('sentence-2', 'A woman appeared.')]));
      });

      const currentVariantA = sentence('cur-a', 'A woman appeared.', 'syn-cur-a');
      const currentVariantB = sentence('cur-a', 'A woman appeared.', 'syn-cur-b');

      let result: any;
      service.mergeSequence({
        current: [
          { solution: mergedSolution('cur-1'), semantic: currentVariantA.semantics[0], sentenceAnalysis: currentVariantA },
          { solution: mergedSolution('cur-2'), semantic: currentVariantB.semantics[0], sentenceAnalysis: currentVariantB },
        ],
        previousContexts: [previousContext],
        knownSentences: [previousSentence, currentVariantA, currentVariantB],
        resolveDrs: true,
      }).subscribe(r => result = r);

      expect(dataServiceMock.ligerSequence).toHaveBeenCalledTimes(2);
      expect(result.pairs.length).toBe(2);
      expect(result.sequenceAnalyses.length).toBe(1);
      const merged: SequenceAnalysis = result.sequenceAnalyses[0];
      expect(merged.syntax.map((s: any) => s.synId).sort()).toEqual(['syn-seq-a', 'syn-seq-b']);
      // Every semantic's syntacticOrigin must be ONE OF this sequence's own syntax ids
      // -- not the unrelated GSWB key the merge response carried.
      const syntaxIdSet = new Set(merged.syntax.map((s: any) => s.synId));
      merged.semantics.forEach(semantic => expect(syntaxIdSet.has(semantic.syntacticOrigin)).toBeTrue());
      expect(Object.keys(merged.synSemMapping).sort()).toEqual(['syn-seq-a', 'syn-seq-b']);

      const knownSentencesDoc: any = {
        id: 'doc', semanticType: 'lfgxdrt',
        sentences: [previousSentence, { ...currentVariantA, id: 'sentence-2' }],
        sequences: [merged], elements: [],
      };
      expect(() => validateSequenceAnalysis(knownSentencesDoc, merged)).not.toThrow();
    });

    it('keeps a pair whose syntax merge cannot be resolved, but does not register it as a sequence', () => {
      const previousSequence = sequence('seq-1', ['sentence-1', 'sentence-2']);
      dataServiceMock.gswbMergeSequenceSemantics.and.returnValue(of(mergedSolution('merged-1')));

      const currentSentence = sentence('sentence-3', 'He smiled.');
      let result: any;
      const errorSpy = spyOn(console, 'error');
      service.mergeSequence({
        current: [{ solution: mergedSolution('cur-1'), semantic: currentSentence.semantics[0], sentenceAnalysis: currentSentence }],
        previousContexts: [{ semantic: previousSequence.semantics[0], element: previousSequence }],
        knownSentences: [], // sentence-1/sentence-2 deliberately unresolved
        resolveDrs: true,
      }).subscribe(r => result = r);

      expect(dataServiceMock.ligerSequence).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
      expect(result.pairs.length).toBe(1);
      expect(result.pairs[0].merged.sequenceAnalysis).toBeUndefined();
      expect(result.sequenceAnalyses.length).toBe(0);
    });

    it('serializes merge calls instead of firing them concurrently (forkJoin hang regression)', () => {
      // ReasoningPipelineService's own comment documents 2+ concurrent Angular
      // HttpClient calls silently dropping a response; the fix there was concatMap
      // instead of forkJoin, and this must hold here too.
      const mergeSubjects: Subject<GswbSolution>[] = [];
      dataServiceMock.gswbMergeSequenceSemantics.and.callFake(() => {
        const subject = new Subject<GswbSolution>();
        mergeSubjects.push(subject);
        return subject.asObservable();
      });
      dataServiceMock.ligerSequence.and.returnValue(of({ solutions: [] }));

      const currentA = sentence('cur-a', 'A woman appeared.');
      const currentB = sentence('cur-b', 'A cat appeared.');
      service.mergeSequence({
        current: [
          { solution: mergedSolution('cur-1'), semantic: currentA.semantics[0], sentenceAnalysis: currentA },
          { solution: mergedSolution('cur-2'), semantic: currentB.semantics[0], sentenceAnalysis: currentB },
        ],
        previousContexts: [previousContext],
        knownSentences: [previousSentence, currentA, currentB],
        resolveDrs: true,
      }).subscribe();

      // Only the first pair's HTTP call has been made -- the second must not fire until
      // the first resolves.
      expect(dataServiceMock.gswbMergeSequenceSemantics).toHaveBeenCalledTimes(1);
      mergeSubjects[0].next(mergedSolution('merged-1'));
      mergeSubjects[0].complete();
      expect(dataServiceMock.gswbMergeSequenceSemantics).toHaveBeenCalledTimes(2);
    });

    it('one sentence with two readings sharing a single syntax variant merges syntax once and produces exactly one pair per reading (chat\'s duplication regression)', () => {
      // The bug this covers (misc/current/chat-document-plan-b-test.json: turn 2 had 8
      // solutions instead of 4): a sentence like "Every Swede is a Scandinavian" has one
      // syntax variant but two semantic readings. Both readings share `current`'s syntax
      // id, so the syntax-merge group collapses to one `ligerSequence` call, while each
      // reading still gets its own `gswbMergeSequenceSemantics` call -- 1 previous x 2
      // readings = 2 pairs, not 4 and not 8. This is the non-rebase path, whose already-
      // computed `current` readings are merge input as-is; see the `rebase` tests below
      // for the analogous check on chat's own path.
      const currentSentence = sentence('sentence-2', 'Every Swede is a Scandinavian.', 'syn-shared');
      currentSentence.semantics = [
        { syntacticOrigin: 'syn-shared', semId: 'sem-reading-1', semString: 'P', semType: 'lfgxdrt' },
        { syntacticOrigin: 'syn-shared', semId: 'sem-reading-2', semString: 'Q', semType: 'lfgxdrt' },
      ];
      dataServiceMock.ligerSequence.and.returnValue(
        of(ligerSequenceResponse('syn-seq', [previousSentence, currentSentence])));
      dataServiceMock.gswbMergeSequenceSemantics.and.callFake((request: any) =>
        of(mergedSolution(request.parentSolutionId)));

      let result: any;
      service.mergeSequence({
        current: currentSentence.semantics.map(semantic => ({
          solution: { id: semantic.semId, solution: semantic.semString, semantic: semantic.semString } as GswbSolution,
          semantic,
          sentenceAnalysis: { ...currentSentence, semantics: [semantic] },
        })),
        previousContexts: [previousContext],
        knownSentences: [previousSentence, currentSentence],
        resolveDrs: true,
      }).subscribe(r => result = r);

      expect(dataServiceMock.ligerSequence).toHaveBeenCalledTimes(1);
      expect(dataServiceMock.gswbMergeSequenceSemantics).toHaveBeenCalledTimes(2);
      expect(result.pairs.length).toBe(2);
      expect(result.pairs.map((pair: any) => pair.currentSemantic.semId).sort())
        .toEqual(['sem-reading-1', 'sem-reading-2']);
    });

    describe('rebase (chat\'s path: derive the new sentence\'s own reading, mirroring LigerVisComponent.addSentence())', () => {
      /** Models GSWB's real behaviour on an aggregate /deduce: every returned solution is
       *  stamped with the ORIGINATING PROOF's solutionKey (GswbController's
       *  runProofsOverLexicalEntries copies origin.solutionKey onto each SolutionObject),
       *  not with an id of its own. That stamp is how a reading is mapped back to the
       *  syntactic variant it was derived from. */
      const derivedSolution = (
        id: string, semantic: string, variantKey = 'sequence-1-S0'
      ): GswbSolution => ({
        id, solution: semantic, semantic, graph: structure, solutionKey: variantKey,
      });

      /** A LiGER sequence response carrying the rebased current-part meaning
       *  constructors the derive step needs -- mirrors addSentence()'s sequenceParts[]
       *  handling, distinct from `ligerSequenceResponse` (which has no sequenceParts).
       *  `sequenceAnalysis.sentences[last]` is the new sentence's own per-sentence
       *  syntax fragment, the same field `proofInputsForSequencePart` reads as
       *  `sentenceAnalysis` -- required for `currentSyntax`/registering the derived
       *  reading under the new sentence's own document entry. */
      const rebaseLigerResponse = () => ({
        solutions: [{
          solutionKey: 'sequence-1-S0',
          structureJson: structure,
          sequenceParts: [
            { sourceIndex: 0, solutionKey: 'part-0', meaningConstructors: 'mc-previous' },
            { sourceIndex: 1, solutionKey: 'part-1', meaningConstructors: 'mc-current' },
          ],
          sequenceAnalysis: {
            sentences: [
              { id: 'sentence-1', syntax: [{ synId: 'S0', structure, graph: { graphElements: [] } }] },
              { id: 'sentence-3', syntax: [{ synId: 'S1', structure, graph: { graphElements: [] } }] },
            ],
          },
        }],
      });

      const currentSentence = { id: 'sentence-3', text: 'A woman appeared.' };

      it('supplies only the previous sentence\'s structure -- never the new sentence\'s -- so LiGER parses and rule-applies it fresh', () => {
        dataServiceMock.ligerSequence.and.returnValue(of(rebaseLigerResponse()));
        dataServiceMock.gswbDeduce.and.returnValue(of({
          solutions: [derivedSolution('derived-1', 'P(x)')],
        }));
        dataServiceMock.gswbMergeSequenceSemantics.and.callFake((request: any) =>
          of(mergedSolution(request.parentSolutionId)));

        service.mergeSequence({
          current: [],
          previousContexts: [previousContext],
          knownSentences: [previousSentence],
          resolveDrs: true,
          rebase: {
            newSentence: currentSentence,
            ruleString: 'rules',
            logicType: 'fof',
            gswbPreferences: {} as any,
          },
        }).subscribe();

        expect(dataServiceMock.ligerSequence).toHaveBeenCalledTimes(1);
        const [request] = dataServiceMock.ligerSequence.calls.mostRecent().args;
        expect(request.sentences).toEqual([previousSentence.text, currentSentence.text]);
        // Only the previous sentence's structure is supplied -- one entry, not two.
        expect(request.parsedSentences.length).toBe(1);
        expect(dataServiceMock.gswbDeduce).toHaveBeenCalledTimes(1);
        expect(dataServiceMock.gswbDeduce.calls.mostRecent().args[0].premises).toBe('mc-current');
      });

      it('never uses request.current as merge input -- whatever /deduce derives simply is the reading set', () => {
        dataServiceMock.ligerSequence.and.returnValue(of(rebaseLigerResponse()));
        dataServiceMock.gswbDeduce.and.returnValue(of({
          solutions: [derivedSolution('derived-1', 'P(x)'), derivedSolution('derived-2', 'Q(x)')],
        }));
        dataServiceMock.gswbMergeSequenceSemantics.and.callFake((request: any) =>
          of(mergedSolution(request.parentSolutionId)));

        let result: any;
        service.mergeSequence({
          // A non-empty `current` that must be entirely ignored -- if it were used as
          // merge input, this would produce a very different pair count/content.
          current: [{
            solution: derivedSolution('cur-1', 'unused-pre-merge-reading'),
            semantic: { syntacticOrigin: 'unused', semId: 'unused-sem', semString: 'unused', semType: 'lfgxdrt' },
          }],
          previousContexts: [previousContext],
          knownSentences: [previousSentence],
          resolveDrs: true,
          rebase: {
            newSentence: currentSentence,
            ruleString: 'rules',
            logicType: 'fof',
            gswbPreferences: {} as any,
          },
        }).subscribe(r => result = r);

        expect(dataServiceMock.ligerSequence).toHaveBeenCalledTimes(1);
        expect(dataServiceMock.gswbDeduce).toHaveBeenCalledTimes(1);
        expect(dataServiceMock.gswbMergeSequenceSemantics).toHaveBeenCalledTimes(2);
        expect(result.pairs.length).toBe(2);
        expect(result.pairs.map((pair: any) => pair.currentSemantic.semId).sort())
          .toEqual(['derived-1', 'derived-2']);
        expect(result.failures).toEqual([]);
        expect(result.sequenceAnalyses).toEqual([]);
      });

      it('attaches the new sentence\'s own syntax fragment and makes the derived reading\'s syntacticOrigin match it, not /deduce\'s own solutionKey', () => {
        // Without this, validateSentenceAnalysis/validateReasoningUpdate reject the
        // reading once the caller registers it under the new sentence's document entry
        // (its syntacticOrigin would point at a synId nothing registers) -- confirmed
        // live via misc/current/chat-document-pronoun-bug.json and -bug2.json:
        // reasoningUpdates came back completely empty, every turn.
        dataServiceMock.ligerSequence.and.returnValue(of(rebaseLigerResponse()));
        dataServiceMock.gswbDeduce.and.returnValue(of({
          // The stamped solutionKey is the SEQUENCE variant key, deliberately different
          // from the sentence's own synId ('S1') that syntacticOrigin must end up as.
          solutions: [derivedSolution('derived-1', 'P(x)')],
        }));
        dataServiceMock.gswbMergeSequenceSemantics.and.callFake((request: any) =>
          of(mergedSolution(request.parentSolutionId)));

        let result: any;
        service.mergeSequence({
          current: [],
          previousContexts: [previousContext],
          knownSentences: [previousSentence],
          resolveDrs: true,
          rebase: {
            newSentence: currentSentence,
            ruleString: 'rules',
            logicType: 'fof',
            gswbPreferences: {} as any,
          },
        }).subscribe(r => result = r);

        expect(result.pairs.length).toBe(1);
        const [pair] = result.pairs;
        expect(pair.currentSyntax?.synId).toBe('S1');
        expect(pair.currentSemantic.syntacticOrigin).toBe('S1');
      });

      it('groups by distinct previous context -- one ligerSequence/deduce call per context, not per (context x reading) pairing', () => {
        const otherPreviousSentence = { ...sentence('sentence-1', 'A man appeared.'), id: 'sentence-1' };
        const otherPreviousContext = {
          semantic: { ...previousSentence.semantics[0], semId: 'sem-sentence-1-b' },
          element: otherPreviousSentence,
        };

        dataServiceMock.ligerSequence.and.returnValue(of(rebaseLigerResponse()));
        dataServiceMock.gswbDeduce.and.returnValue(of({
          solutions: [derivedSolution('derived-1', 'P(x)')],
        }));
        dataServiceMock.gswbMergeSequenceSemantics.and.callFake((request: any) =>
          of(mergedSolution(request.parentSolutionId)));

        let result: any;
        service.mergeSequence({
          current: [],
          previousContexts: [previousContext, otherPreviousContext],
          knownSentences: [previousSentence],
          resolveDrs: true,
          rebase: {
            newSentence: currentSentence,
            ruleString: 'rules',
            logicType: 'fof',
            gswbPreferences: {} as any,
          },
        }).subscribe(r => result = r);

        // Two distinct previous contexts -> two ligerSequence/deduce calls (grouping
        // is by previous context, not by any pre-computed reading of the new sentence).
        expect(dataServiceMock.ligerSequence).toHaveBeenCalledTimes(2);
        expect(dataServiceMock.gswbDeduce).toHaveBeenCalledTimes(2);
        expect(dataServiceMock.gswbMergeSequenceSemantics).toHaveBeenCalledTimes(2);
        expect(result.pairs.length).toBe(2);
      });

      /** The regression this suite previously could not see: every mock returned ONE
       *  ligerSequence solution, so `solutions[0]` and `solutions[*]` were the same
       *  thing. `ligerSequence`'s solutions[] IS the syntactic-variant dimension.
       *  See docs/bug_reports/chat_single_syntax_variant_collapse.md. */
      describe('syntactic ambiguity (several ligerSequence solutions)', () => {
        /** Three syntactic variants of the same appended sentence, as
         *  LigerController.collectSequenceVariants would return them. */
        const threeVariantResponse = () => ({
          solutions: ['S1', 'S2', 'S3'].map((synId, index) => ({
            solutionKey: `sequence-${index + 1}-S0+${synId}`,
            structureJson: { ...structure, id: `merged-${synId}` } as any,
            sequenceParts: [
              { sourceIndex: 0, solutionKey: 'part-0', meaningConstructors: 'mc-previous' },
              { sourceIndex: 1, solutionKey: synId, meaningConstructors: `mc-current-${synId}` },
            ],
            sequenceAnalysis: {
              sentences: [
                { id: 'sentence-1', syntax: [{ synId: 'S0', structure, graph: { graphElements: [] } }] },
                { id: 'sentence-3', syntax: [{ synId, structure, graph: { graphElements: [] } }] },
              ],
            },
          })),
        });

        const runRebase = () => {
          let result: any;
          service.mergeSequence({
            current: [],
            previousContexts: [previousContext],
            knownSentences: [previousSentence],
            resolveDrs: true,
            rebase: {
              newSentence: currentSentence,
              ruleString: 'rules',
              logicType: 'fof',
              gswbPreferences: {} as any,
            },
          }).subscribe(r => result = r);
          return result;
        };

        it('sends ONE aggregate /deduce carrying one proof per syntactic variant', () => {
          dataServiceMock.ligerSequence.and.returnValue(of(threeVariantResponse()));
          dataServiceMock.gswbDeduce.and.returnValue(of({
            solutions: [derivedSolution('derived-1', 'P(x)', 'sequence-1-S0+S1')],
          }));
          dataServiceMock.gswbMergeSequenceSemantics.and.callFake((request: any) =>
            of(mergedSolution(request.parentSolutionId)));

          runRebase();

          // One call, not three: /deduce is an aggregate endpoint over syntactic origins
          // (GswbProofInput = "One syntactic origin and its MC input within an aggregate
          // deduction"), which is what LigerVisComponent.proofInputsForSequencePart does.
          expect(dataServiceMock.gswbDeduce).toHaveBeenCalledTimes(1);
          const [request] = dataServiceMock.gswbDeduce.calls.mostRecent().args;
          expect(request.proofs.length).toBe(3);
          expect(request.proofs.map((proof: any) => proof.solutionKey))
            .toEqual(['sequence-1-S0+S1', 'sequence-2-S0+S2', 'sequence-3-S0+S3']);
          // Each proof carries ITS OWN variant's merged structure and rebased MCs.
          expect(request.proofs.map((proof: any) => proof.meaningConstructors))
            .toEqual(['mc-current-S1', 'mc-current-S2', 'mc-current-S3']);
          expect(request.proofs.map((proof: any) => proof.structure.id))
            .toEqual(['merged-S1', 'merged-S2', 'merged-S3']);
        });

        it('keeps every variant\'s readings, each tagged with its own syntax and merged structure', () => {
          dataServiceMock.ligerSequence.and.returnValue(of(threeVariantResponse()));
          dataServiceMock.gswbDeduce.and.returnValue(of({
            solutions: [
              derivedSolution('derived-S1-a', 'P(x)', 'sequence-1-S0+S1'),
              derivedSolution('derived-S1-b', 'P2(x)', 'sequence-1-S0+S1'),
              derivedSolution('derived-S2-a', 'Q(x)', 'sequence-2-S0+S2'),
              derivedSolution('derived-S3-a', 'R(x)', 'sequence-3-S0+S3'),
            ],
          }));
          dataServiceMock.gswbMergeSequenceSemantics.and.callFake((request: any) =>
            of(mergedSolution(request.parentSolutionId)));

          const result = runRebase();

          expect(result.pairs.length).toBe(4);
          // Readings are partitioned by their own variant, not bucketed under the first.
          expect(result.pairs.map((pair: any) => pair.currentSyntax.synId))
            .toEqual(['S1', 'S1', 'S2', 'S3']);
          expect(result.pairs.map((pair: any) => pair.currentSemantic.syntacticOrigin))
            .toEqual(['S1', 'S1', 'S2', 'S3']);
          // And each carries ITS OWN variant's merged structure: pairing a reading with
          // another variant's structure mis-joins SRC against SYN-ID silently.
          expect(result.pairs.map((pair: any) => pair.sequenceStructure.id))
            .toEqual(['merged-S1', 'merged-S1', 'merged-S2', 'merged-S3']);
          expect(result.failures).toEqual([]);
        });

        it('refuses to guess when GSWB stamps a reading with an unknown origin', () => {
          dataServiceMock.ligerSequence.and.returnValue(of(threeVariantResponse()));
          dataServiceMock.gswbDeduce.and.returnValue(of({
            solutions: [derivedSolution('derived-1', 'P(x)', 'some-unrelated-key')],
          }));
          dataServiceMock.gswbMergeSequenceSemantics.and.callFake((request: any) =>
            of(mergedSolution(request.parentSolutionId)));

          const result = runRebase();

          // Reported, not silently attributed to variant 0.
          expect(result.pairs).toEqual([]);
          expect(result.failures.length).toBe(1);
          expect(result.failures[0]).toContain('some-unrelated-key');
        });
      });

      describe('failure reporting instead of silent empty results', () => {
        it('reports the cause when the ligerSequence call fails, rather than just producing no pairs', () => {
          dataServiceMock.ligerSequence.and.returnValue(
            throwError(() => ({ status: 500, url: 'http://localhost:8080/apply_rules_xle_sequence' })));

          let result: any;
          service.mergeSequence({
            current: [],
            previousContexts: [previousContext],
            knownSentences: [previousSentence],
            resolveDrs: true,
            rebase: {
              newSentence: currentSentence,
              ruleString: 'rules',
              logicType: 'fof',
              gswbPreferences: {} as any,
            },
          }).subscribe(r => result = r);

          expect(result.pairs).toEqual([]);
          expect(result.failures.length).toBe(1);
          expect(result.failures[0]).toContain('HTTP 500');
          expect(result.failures[0]).toContain(currentSentence.id);
        });

        it('never sends a null structure: a previous sentence with no parsed structure fails loudly', () => {
          // A syntax entry registered from /apply_rules_to_batch carries no structure.
          // Serialized inside parsedSentences it becomes `null`, and LiGER's
          // LinguisticStructure.parseFromJson(null) 500s the whole call -- see
          // docs/bug_reports/regression_second_fold_null_structure_500.md.
          const structurelessSentence: SentenceAnalysis = {
            ...previousSentence,
            syntax: [{ synId: 'batch-syn', structure: undefined as any, graph: { graphElements: [] } }],
          };

          let result: any;
          service.mergeSequence({
            current: [],
            previousContexts: [{ ...previousContext, element: structurelessSentence }],
            knownSentences: [structurelessSentence],
            resolveDrs: true,
            rebase: {
              newSentence: currentSentence,
              ruleString: 'rules',
              logicType: 'fof',
              gswbPreferences: {} as any,
            },
          }).subscribe(r => result = r);

          expect(dataServiceMock.ligerSequence).not.toHaveBeenCalled();
          expect(result.pairs).toEqual([]);
          expect(result.failures.length).toBe(1);
          expect(result.failures[0]).toContain(structurelessSentence.id);
        });
      });

      describe('deriveSentenceInSequence (the first-sentence case, shared with chat turn 1)', () => {
        it('sends no parsedSentences and still fans out over every syntactic variant', () => {
          dataServiceMock.ligerSequence.and.returnValue(of({
            solutions: ['S0', 'S1'].map((synId, index) => ({
              solutionKey: `sequence-${index + 1}-${synId}`,
              structureJson: { ...structure, id: `seq-${synId}` } as any,
              sequenceParts: [
                { sourceIndex: 0, solutionKey: synId, meaningConstructors: `mc-${synId}` },
              ],
              sequenceAnalysis: {
                sentences: [{ id: 'sentence-1', syntax: [{ synId, structure, graph: { graphElements: [] } }] }],
              },
            })),
          }));
          dataServiceMock.gswbDeduce.and.returnValue(of({
            solutions: [
              derivedSolution('r-1', 'P(x)', 'sequence-1-S0'),
              derivedSolution('r-2', 'Q(x)', 'sequence-2-S1'),
            ],
          }));

          let readings: any;
          service.deriveSentenceInSequence([], {
            newSentence: { id: 'sentence-1', text: 'A man saw a monkey with a telescope.' },
            ruleString: 'rules',
            logicType: 'fof',
            gswbPreferences: {} as any,
          }).subscribe(r => readings = r);

          const [sequenceRequest] = dataServiceMock.ligerSequence.calls.mostRecent().args;
          expect(sequenceRequest.sentences.length).toBe(1);
          expect(sequenceRequest.parsedSentences).toBeUndefined();

          expect(dataServiceMock.gswbDeduce).toHaveBeenCalledTimes(1);
          expect(dataServiceMock.gswbDeduce.calls.mostRecent().args[0].proofs.length).toBe(2);
          expect(readings.length).toBe(2);
          expect(readings.map((reading: any) => reading.currentSyntax.synId)).toEqual(['S0', 'S1']);
          expect(readings.map((reading: any) => reading.semantic.syntacticOrigin)).toEqual(['S0', 'S1']);
          expect(readings.map((reading: any) => reading.sequenceStructure.id)).toEqual(['seq-S0', 'seq-S1']);
        });
      });
    });
  });
});
