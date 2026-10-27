import { TestBed } from '@angular/core/testing';
import { Subject, map, of, throwError } from 'rxjs';
import { DocumentBuilderService } from './document-builder.service';
import { DataService } from '../data.service';
import { readingOf, validateSequenceAnalysis } from '../analysis-model';
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

  /** Stands in for LiGER's `/apply_rules_xle_sequence` over supplied structures: every
   *  combination of the supplied analyses, the analyses numbered S0.. across the call in
   *  sentence order, each part offset by the earlier parts' meaning-constructor count
   *  (`mcs` on the fake structure, LiGER's maxSyntheticMcIndex). */
  const fakeLigerSequence = (request: any) => {
    let counter = 0;
    const ids: string[][] = request.parsedSentences.map((structures: any[]) => structures.map(() => `S${counter++}`));
    let combos: number[][] = [[]];
    ids.forEach(sentenceIds => {
      combos = combos.flatMap(combo => sentenceIds.map((_, index) => [...combo, index]));
    });
    return of({
      solutions: combos.map((combo, variant) => {
        const key = `sequence-${variant + 1}-${combo.map((j, i) => ids[i][j]).join('+')}`;
        let offset = 0;
        const sequenceParts = combo.map((j, i) => {
          const part = {
            sourceIndex: i, sentenceId: request.sentenceIds[i], syntaxVariantId: ids[i][j], solutionKey: ids[i][j],
            meaningConstructors: '', sourceIndexOffset: offset,
          };
          offset += request.parsedSentences[i][j].mcs;
          return part;
        });
        return {
          solutionKey: key,
          structureJson: { variant: key },
          sequenceParts,
          sequenceAnalysis: {
            id: key,
            text: request.sentences.join('\n'),
            sentences: request.sentenceIds.map((id: string) => ({ id })),
            syntax: [{ synId: key, structure: { variant: key }, graph: { graphElements: [] } }],
            semantics: [],
            synSemMapping: {},
          },
        };
      }),
    });
  };

  /** Stands in for `/merge_sequence_semantics`: the composite of the parts' ids, the
   *  request's solutionKey as the reading's syntax. */
  const fakeMerge = (request: any) => {
    const id = request.parts.map((part: any) => part.id).join('+');
    return of({
      id,
      solutionKey: request.solutionKey,
      semanticAnalysis: {
        semId: id, syntacticOrigin: request.solutionKey, semString: `merged ${id}`,
        graph: { nodes: [], edges: [] }, semType: 'lfgxdrt',
      },
    } as unknown as GswbSolution);
  };

  /** A sentence derived on its own: one syntax entry per parse (its structure carries the
   *  parse's MC count), `readings` readings per parse, each pointing at its parse. */
  const ownSentence = (id: string, parses: Array<{ synId: string; mcs: number; readings: number }>): SentenceAnalysis => {
    const semantics = parses.flatMap(parse => Array.from({ length: parse.readings }, (_, r) => ({
      syntacticOrigin: parse.synId, semId: `${id}-${parse.synId}-s${r}`, semString: `${id} reading`,
      graph: { nodes: [], edges: [] } as any, semType: 'lfgxdrt',
    })));
    const synSemMapping: Record<string, string[]> = {};
    semantics.forEach(semantic => (synSemMapping[semantic.syntacticOrigin] ??= []).push(semantic.semId));
    return {
      id,
      text: `${id} text.`,
      syntax: parses.map(parse => ({
        synId: parse.synId, structure: { id: `${id}/${parse.synId}`, mcs: parse.mcs } as any, graph: { graphElements: [] },
      })),
      semantics,
      synSemMapping,
    };
  };

  const contextsOf = (element: SentenceAnalysis | SequenceAnalysis) =>
    element.semantics.map(semantic => ({ semantic, element }));

  const append = (previous: SentenceAnalysis | SequenceAnalysis, sentence: SentenceAnalysis, known: SentenceAnalysis[]) => {
    let result: any;
    service.appendSentence({
      previousContexts: contextsOf(previous),
      sentence,
      readings: sentence.semantics,
      knownSentences: known,
      resolveDrs: true,
    }).subscribe(value => result = value);
    return result as import('./document-builder.service').SequenceMergeResult;
  };

  const mergeRequests = () => dataServiceMock.gswbMergeSequenceSemantics.calls.allArgs().map(args => args[0]);

  describe('appendSentence', () => {
    beforeEach(() => {
      dataServiceMock.ligerSequence.and.callFake(fakeLigerSequence);
      dataServiceMock.gswbMergeSequenceSemantics.and.callFake(fakeMerge);
    });

    describe('"Kim saw a man with a telescope. He smiled. A man smiled." (3 x 1 x 1)', () => {
      const kim = ownSentence('sentence-1', [
        { synId: 'S0', mcs: 13, readings: 1 }, { synId: 'S1', mcs: 13, readings: 1 }, { synId: 'S2', mcs: 13, readings: 1 },
      ]);
      const he = ownSentence('sentence-2', [{ synId: 'S0', mcs: 6, readings: 1 }]);
      const man = ownSentence('sentence-3', [{ synId: 'S0', mcs: 8, readings: 1 }]);
      const known = [kim, he, man];

      it('gives 3 readings after each append, one per parse of the first sentence -- not 3 x 3 x 3', () => {
        const second = append(kim, he, known);
        expect(second.pairs.length).toBe(3);
        expect(second.failures).toEqual([]);
        expect(second.sequenceAnalyses.length).toBe(1);

        const third = append(second.sequenceAnalyses[0], man, known);
        expect(third.pairs.length).toBe(3);
        expect(third.failures).toEqual([]);
        expect(third.sequenceAnalyses[0].semantics.length).toBe(3);
      });

      it('derives nothing: no /deduce, one LiGER sequence call per append', () => {
        const second = append(kim, he, known);
        append(second.sequenceAnalyses[0], man, known);
        expect(dataServiceMock.gswbDeduce).not.toHaveBeenCalled();
        expect(dataServiceMock.ligerSequence).toHaveBeenCalledTimes(2);
      });

      it('pairs each context with the variant of its own parse, named by its parents', () => {
        const second = append(kim, he, known);
        expect(second.pairs.map(pair => [pair.previousSemantic.syntacticOrigin, readingOrigin(pair)]))
          .toEqual([['S0', 'S0+S0'], ['S1', 'S1+S0'], ['S2', 'S2+S0']]);
        expect(second.pairs.map(pair => (pair.sequenceStructure as any).variant))
          .toEqual(['sequence-1-S0+S3', 'sequence-2-S1+S3', 'sequence-3-S2+S3']);
        expect(second.sequenceAnalyses[0].syntax.map(syntax => syntax.synId)).toEqual(['S0+S0', 'S1+S0', 'S2+S0']);
        const document = service.newDocument('d', 'lfgxdrt');
        service.upsertSentenceAnalyses(document, known);
        expect(() => validateSequenceAnalysis(document, second.sequenceAnalyses[0])).not.toThrow();
      });

      it('moves the new reading by its part offset; the context is sent as it is', () => {
        const second = append(kim, he, known);
        append(second.sequenceAnalyses[0], man, known);
        const requests = mergeRequests();
        expect(requests.map(request => request.parts[0].sourceIndexOffset)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
        expect(requests.map(request => request.parts[1].sourceIndexOffset)).toEqual([13, 13, 13, 19, 19, 19]);
      });

      it('supplies the parses a previous Sequence\'s readings came from, resolved from its composite syntax', () => {
        const second = append(kim, he, known);
        append(second.sequenceAnalyses[0], man, known);
        const request = dataServiceMock.ligerSequence.calls.mostRecent().args[0];
        expect(request.sentenceIds).toEqual(['sentence-1', 'sentence-2', 'sentence-3']);
        expect(request.parsedSentences.map((structures: any[]) => structures.map(structure => structure.id))).toEqual([
          ['sentence-1/S0', 'sentence-1/S1', 'sentence-1/S2'], ['sentence-2/S0'], ['sentence-3/S0'],
        ]);
      });
    });

    it('skips an empty move\'s sentence where it merges again, and keeps it in the ids (N4 6d)', () => {
      const kim = ownSentence('sentence-1', [{ synId: 'S0', mcs: 13, readings: 1 }]);
      const entailed = ownSentence('sentence-2', [{ synId: 'S0', mcs: 6, readings: 1 }]);
      const he = ownSentence('sentence-3', [{ synId: 'S0', mcs: 8, readings: 1 }]);
      const known = [kim, entailed, he];
      // sentence-2 was entailed: the step's reading is sentence-1's, with an empty part.
      const prior = kim.semantics[0];
      const step: SequenceAnalysis = {
        id: 'sentence-1+sentence-2', text: 'x', sentenceIds: ['sentence-1', 'sentence-2'],
        syntax: [{ synId: 'S0+sentence-2~empty', structure: {} as any, graph: { graphElements: [] } as any }],
        semantics: [{ ...prior, semId: `${prior.semId}+sentence-2~empty`, syntacticOrigin: 'S0+sentence-2~empty' }],
        synSemMapping: { 'S0+sentence-2~empty': [`${prior.semId}+sentence-2~empty`] },
      };

      const third = append(step, he, known);

      expect(third.failures).toEqual([]);
      const request = dataServiceMock.ligerSequence.calls.mostRecent().args[0];
      expect(request.sentenceIds).toEqual(['sentence-1', 'sentence-3']);
      expect(request.parsedSentences.map((structures: any[]) => structures.map(structure => structure.id)))
        .toEqual([['sentence-1/S0'], ['sentence-3/S0']]);
      // Offset by sentence-1's constructors alone: sentence-2 contributed none.
      expect(mergeRequests()[0].parts[1].sourceIndexOffset).toBe(13);
      expect(third.pairs.map(pair => readingOf(pair.merged).semId))
        .toEqual(['sentence-1-S0-s0+sentence-2~empty+sentence-3-S0-s0']);
      expect(third.sequenceAnalyses.map(sequence => sequence.id)).toEqual(['sentence-1+sentence-2+sentence-3']);
      expect(third.sequenceAnalyses[0].syntax.map(syntax => syntax.synId)).toEqual(['S0+sentence-2~empty+S0']);
    });

    it('gives each pair its own variant\'s offset when the previous parses differ in size', () => {
      const first = ownSentence('sentence-1', [{ synId: 'S0', mcs: 5, readings: 1 }, { synId: 'S1', mcs: 7, readings: 2 }]);
      const second = ownSentence('sentence-2', [{ synId: 'S0', mcs: 4, readings: 1 }]);
      const result = append(first, second, [first, second]);

      expect(result.pairs.map(pair => [pair.previousSemantic.semId, pair.sourceIndexOffset])).toEqual([
        ['sentence-1-S0-s0', 5], ['sentence-1-S1-s0', 7], ['sentence-1-S1-s1', 7],
      ]);
      expect(mergeRequests().map(request => request.parts[1].sourceIndexOffset)).toEqual([5, 7, 7]);
    });

    describe('a two-parse middle sentence with a dead parse ("It barked.")', () => {
      const first = ownSentence('sentence-1', [{ synId: 'S0', mcs: 9, readings: 2 }]);
      const middle = ownSentence('sentence-2', [{ synId: 'S0', mcs: 6, readings: 1 }, { synId: 'S1', mcs: 6, readings: 0 }]);
      const last = ownSentence('sentence-3', [{ synId: 'S0', mcs: 5, readings: 1 }]);
      const known = [first, middle, last];

      it('supplies only the parse with a reading, and every context still gets its reading', () => {
        const second = append(first, middle, known);
        expect(dataServiceMock.ligerSequence.calls.mostRecent().args[0].parsedSentences[1].length).toBe(1);
        expect(second.pairs.length).toBe(2);
        expect(second.failures).toEqual([]);

        const third = append(second.sequenceAnalyses[0], last, known);
        expect(dataServiceMock.ligerSequence.calls.mostRecent().args[0].parsedSentences.map((s: any[]) => s.length))
          .toEqual([1, 1, 1]);
        expect(third.pairs.length).toBe(2);
      });
    });

    it('supplies only the previous parses the contexts use (a disambiguated previous sentence)', () => {
      const kim = ownSentence('sentence-1', [
        { synId: 'S0', mcs: 13, readings: 1 }, { synId: 'S1', mcs: 13, readings: 1 }, { synId: 'S2', mcs: 13, readings: 1 },
      ]);
      const he = ownSentence('sentence-2', [{ synId: 'S0', mcs: 6, readings: 1 }]);
      let result: any;
      service.appendSentence({
        previousContexts: [{ semantic: kim.semantics[1], element: kim }],
        sentence: he, readings: he.semantics, knownSentences: [kim, he], resolveDrs: true,
      }).subscribe(value => result = value);

      expect(dataServiceMock.ligerSequence.calls.mostRecent().args[0].parsedSentences[0].map((s: any) => s.id))
        .toEqual(['sentence-1/S1']);
      expect(result.pairs.length).toBe(1);
      expect(readingOrigin(result.pairs[0])).toBe('S1+S0');
    });

    it('appends only the given readings of the new sentence', () => {
      const first = ownSentence('sentence-1', [{ synId: 'S0', mcs: 3, readings: 1 }]);
      const second = ownSentence('sentence-2', [{ synId: 'S0', mcs: 3, readings: 2 }, { synId: 'S1', mcs: 3, readings: 1 }]);
      let result: any;
      service.appendSentence({
        previousContexts: contextsOf(first), sentence: second, readings: [second.semantics[2]],
        knownSentences: [first, second], resolveDrs: true,
      }).subscribe(value => result = value);

      expect(dataServiceMock.ligerSequence.calls.mostRecent().args[0].parsedSentences[1].map((s: any) => s.id))
        .toEqual(['sentence-2/S1']);
      expect(result.pairs.map((pair: any) => pair.currentSemantic.semId)).toEqual(['sentence-2-S1-s0']);
    });

    it('serializes merge calls instead of firing them concurrently (forkJoin hang regression)', () => {
      const subjects: Subject<GswbSolution>[] = [];
      dataServiceMock.gswbMergeSequenceSemantics.and.callFake(() => {
        const subject = new Subject<GswbSolution>();
        subjects.push(subject);
        return subject.asObservable();
      });
      const first = ownSentence('sentence-1', [{ synId: 'S0', mcs: 3, readings: 2 }]);
      const second = ownSentence('sentence-2', [{ synId: 'S0', mcs: 3, readings: 1 }]);
      service.appendSentence({
        previousContexts: contextsOf(first), sentence: second, readings: second.semantics,
        knownSentences: [first, second], resolveDrs: true,
      }).subscribe();

      expect(dataServiceMock.gswbMergeSequenceSemantics).toHaveBeenCalledTimes(1);
      fakeMerge(dataServiceMock.gswbMergeSequenceSemantics.calls.first().args[0])
        .subscribe(value => { subjects[0].next(value); subjects[0].complete(); });
      expect(dataServiceMock.gswbMergeSequenceSemantics).toHaveBeenCalledTimes(2);
    });

    describe('says why instead of guessing or going quiet', () => {
      const first = ownSentence('sentence-1', [{ synId: 'S0', mcs: 3, readings: 1 }, { synId: 'S1', mcs: 3, readings: 1 }]);
      const second = ownSentence('sentence-2', [{ synId: 'S0', mcs: 3, readings: 1 }]);

      it('refuses a new reading that names none of its sentence\'s parses', () => {
        const stray = { ...second.semantics[0], syntacticOrigin: 'S9' };
        let error: any;
        service.appendSentence({
          previousContexts: contextsOf(first), sentence: second, readings: [stray],
          knownSentences: [first, second], resolveDrs: true,
        }).subscribe({ error: e => error = e });
        expect(error?.message).toMatch(/name none of its parses/);
        expect(dataServiceMock.ligerSequence).not.toHaveBeenCalled();
      });

      it('reports a context whose syntax names no parse of its sentence, and appends to the rest', () => {
        const stray = { semantic: { ...first.semantics[0], syntacticOrigin: 'S7' }, element: first };
        let result: any;
        service.appendSentence({
          previousContexts: [stray, ...contextsOf(first)], sentence: second, readings: second.semantics,
          knownSentences: [first, second], resolveDrs: true,
        }).subscribe(value => result = value);
        expect(result.pairs.length).toBe(2);
        expect(result.failures.length).toBe(1);
        expect(result.failures[0]).toMatch(/S7/);
      });

      it('reports a LiGER failure once per context it cost, rather than just producing no pairs', () => {
        dataServiceMock.ligerSequence.and.returnValue(throwError(() => ({ status: 500, url: '/apply_rules_xle_sequence', error: 'boom' })));
        const result = append(first, second, [first, second]);
        expect(result.pairs).toEqual([]);
        expect(result.failures.length).toBe(2);
        expect(result.failures[0]).toMatch(/HTTP 500/);
      });

      it('refuses to guess the parse of a part LiGER reports under an id it was not supplied as', () => {
        dataServiceMock.ligerSequence.and.callFake((request: any) => fakeLigerSequence(request).pipe(
          map((response: any) => {
            response.solutions[0].sequenceParts[1].syntaxVariantId = 'S0';
            return response;
          })));
        const result = append(first, second, [first, second]);
        expect(result.pairs).toEqual([]);
        expect(result.failures.join(' ')).toMatch(/Refusing to guess/);
      });

      it('refuses a previous sentence parse with no structure to supply', () => {
        const structureless = { ...first, syntax: first.syntax.map(syntax => ({ ...syntax, structure: undefined as any })) };
        const result = append(structureless, second, [structureless, second]);
        expect(result.pairs).toEqual([]);
        expect(result.failures.join(' ')).toMatch(/no structure to supply/);
        expect(dataServiceMock.ligerSequence).not.toHaveBeenCalled();
      });
    });
  });

  describe('deriveSentence', () => {
    const parse = (key: string) => ({
      solutionKey: key, meaningConstructors: `[1] mc of ${key}`, structureJson: { id: key }, graph: { graphElements: [] },
    } as any);
    const solution = (id: string, key: string) => ({
      id, solutionKey: key, proofId: key,
      semanticAnalysis: { semId: id, syntacticOrigin: key, semString: 'P', graph: { nodes: [] }, semType: 'lfgxdrt' },
    } as any);

    it('proves every parse in one /deduce and points each reading at its parse', () => {
      dataServiceMock.gswbDeduce.and.returnValue(of({ solutions: [solution('sentence-2-S0-s0', 'S0'), solution('sentence-2-S1-s0', 'S1')] }));
      let derived: any;
      service.deriveSentence({ id: 'sentence-2', text: 'It barked.' }, [parse('S0'), parse('S1')], {} as any)
        .subscribe(value => derived = value);

      expect(dataServiceMock.gswbDeduce).toHaveBeenCalledTimes(1);
      const request = dataServiceMock.gswbDeduce.calls.mostRecent().args[0];
      expect(request.proofs.map((proof: any) => [proof.proofId, proof.sentenceId])).toEqual([['S0', 'sentence-2'], ['S1', 'sentence-2']]);
      expect(derived.analysis.syntax.map((syntax: any) => [syntax.synId, syntax.structure.id])).toEqual([['S0', 'S0'], ['S1', 'S1']]);
      expect(derived.analysis.semantics.map((semantic: any) => semantic.syntacticOrigin)).toEqual(['S0', 'S1']);
      expect(derived.analysis.synSemMapping).toEqual({ S0: ['sentence-2-S0-s0'], S1: ['sentence-2-S1-s0'] });
    });

    it('refuses a reading stamped with none of the sentence\'s parses', () => {
      dataServiceMock.gswbDeduce.and.returnValue(of({ solutions: [solution('x', 'sequence-1-S0')] }));
      let error: any;
      service.deriveSentence({ id: 'sentence-2', text: 'It barked.' }, [parse('S0')], {} as any)
        .subscribe({ error: e => error = e });
      expect(error?.message).toMatch(/none of its parses/);
    });

    it('fails when no reading is derived', () => {
      dataServiceMock.gswbDeduce.and.returnValue(of({ solutions: [] }));
      let error: any;
      service.deriveSentence({ id: 'sentence-2', text: 'It barked.' }, [parse('S0')], {} as any)
        .subscribe({ error: e => error = e });
      expect(error?.message).toMatch(/No semantics derived/);
    });
  });
});

const readingOrigin = (pair: any) => pair.merged.semanticAnalysis.syntacticOrigin;
