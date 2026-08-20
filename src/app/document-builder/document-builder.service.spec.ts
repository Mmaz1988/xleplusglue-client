import { TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { DocumentBuilderService } from './document-builder.service';
import { DataService } from '../data.service';
import { validateSequenceAnalysis } from '../analysis-model';
import { GswbSolution, SentenceAnalysis, SequenceAnalysis, XlePlusGlueDocument } from '../models/models';

describe('DocumentBuilderService', () => {
  let service: DocumentBuilderService;
  let dataServiceMock: { gswbMergeSequenceSemantics: jasmine.Spy; ligerSequence: jasmine.Spy };

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
      // readings = 2 pairs, not 4 and not 8. There is no re-derivation step to
      // over-multiply against, unlike the deleted rebase path.
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
  });
});
