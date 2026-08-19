import { TestBed } from '@angular/core/testing';
import { DocumentBuilderService } from './document-builder.service';
import { SentenceAnalysis, SequenceAnalysis, XlePlusGlueDocument } from '../models/models';

describe('DocumentBuilderService', () => {
  let service: DocumentBuilderService;

  const structure = { constraints: [], annotations: [], choiceSpace: {} };

  const sentence = (id: string, text: string): SentenceAnalysis => ({
    id,
    text,
    syntax: [{ synId: `syn-${id}`, structure, graph: { graphElements: [] } }],
    semantics: [{ syntacticOrigin: `syn-${id}`, semId: `sem-${id}`, semString: 'P', semType: 'lfgxdrt' }],
    synSemMapping: { [`syn-${id}`]: [`sem-${id}`] },
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
    TestBed.configureTestingModule({});
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
});
