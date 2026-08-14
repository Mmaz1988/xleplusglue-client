import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { of } from 'rxjs';

import { GswbVisComponent } from './gswb-vis.component';
import { DataService } from '../data.service';
import { GswbSolution, SemanticAnalysis, SentenceAnalysis, SequenceAnalysis } from '../models/models';

describe('GswbVisComponent', () => {
  let component: GswbVisComponent;
  let fixture: ComponentFixture<GswbVisComponent>;
  let dataServiceMock: { gswbMergeSequenceSemantics: jasmine.Spy; ligerSequence: jasmine.Spy };

  const structure = { constraints: [], annotations: [], choiceSpace: {} };

  const sentence = (id: string, text: string): SentenceAnalysis => ({
    id,
    text,
    syntax: [{ synId: `syn-${id}`, structure, graph: { graphElements: [] } }],
    semantics: [{ syntacticOrigin: `syn-${id}`, semId: `sem-${id}`, semString: 'P', semType: 'lfgxdrt' }],
    synSemMapping: { [`syn-${id}`]: [`sem-${id}`] },
  });

  beforeEach(() => {
    dataServiceMock = {
      gswbMergeSequenceSemantics: jasmine.createSpy('gswbMergeSequenceSemantics')
        .and.returnValue(of({ id: 'merged-1', solution: 'merged', solutionKey: 'sk-1', graph: structure, semantic: 'merged semantic' } as GswbSolution)),
      ligerSequence: jasmine.createSpy('ligerSequence').and.returnValue(of({ solutions: [] })),
    };

    TestBed.configureTestingModule({
      declarations: [GswbVisComponent],
      providers: [
        { provide: DataService, useValue: dataServiceMock },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });
    fixture = TestBed.createComponent(GswbVisComponent);
    component = fixture.componentInstance;
    // Deliberately not calling fixture.detectChanges(): the real template's child
    // components (app-gswb-settings, app-sem-vis, ...) aren't declared here, so with
    // NO_ERRORS_SCHEMA their #-referenced ViewChild queries resolve to plain elements,
    // not component instances -- ngAfterViewInit would crash on the first real method
    // call, and any manual override set beforehand gets clobbered by the next query
    // refresh anyway. None of the tests below need the real lifecycle hooks; they drive
    // the private merge/lookup methods directly against stubbed ViewChild-backed fields.
    component.semvis = { setItems: jasmine.createSpy('setItems'), setDiscriminants: jasmine.createSpy('setDiscriminants') } as any;
    component.gswbPreferences = { gswbPreferences: { resolveDrs: true } } as any;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('sentenceAnalysisFor (chicken-and-egg regression)', () => {
    it('falls back to the embedded sequence sentence copy before knownSentences is populated', () => {
      component.proofInputs = [{
        solutionKey: 'sk1',
        sequenceAnalysis: {
          id: 'seq-x',
          text: 'First sentence.',
          sentences: [sentence('s1', 'First sentence.')],
          syntax: [],
          semantics: [],
          synSemMapping: {},
        },
      } as any];
      component.knownSentences = [];

      const result = (component as any).sentenceAnalysisFor({ solutionKey: 'sk1', id: 'sol-1' } as GswbSolution);

      expect(result).toBeTruthy();
      expect(result.id).toBe('s1');
    });
  });

  describe('mergeSyntaxForResults (silent-drop regression)', () => {
    it('fails loudly and falls back to the unmerged solution instead of sending a truncated sentence list', () => {
      const previousSemantic: SemanticAnalysis = {
        syntacticOrigin: 'syn-seq', semId: 'sem-seq', semString: 'P & Q', semType: 'lfgxdrt', graph: structure,
      };
      const previousSequence: SequenceAnalysis = {
        id: 'seq-1',
        text: 'Prev sequence.',
        sentenceIds: ['s1', 's2'],
        syntax: [{ synId: 'syn-seq', structure, graph: { graphElements: [] } }],
        semantics: [previousSemantic],
        synSemMapping: { 'syn-seq': ['sem-seq'] },
      };
      component.previousSequenceAnalyses = [previousSequence];
      component.previousSentenceAnalyses = [];
      // 's2' is deliberately missing from the known-sentences registry.
      component.knownSentences = [sentence('s1', 'First sentence.')];

      const solution: GswbSolution = {
        id: 'cur-1',
        solution: 'current',
        solutionKey: 'cur-key',
        graph: structure,
        semanticAnalysis: { syntacticOrigin: 'syn-cur', semId: 'sem-cur', semString: 'Q', semType: 'lfgxdrt', graph: structure },
        sentenceAnalysis: sentence('s3', 'Current sentence.'),
      };

      const errorSpy = spyOn(console, 'error');

      (component as any).mergeCurrentSolutions([solution]);

      expect(dataServiceMock.gswbMergeSequenceSemantics).toHaveBeenCalledTimes(1);
      expect(dataServiceMock.ligerSequence).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
      const [, details] = errorSpy.calls.mostRecent().args;
      expect(details.missingSentenceIds).toEqual(['s2']);

      // The group still surfaces its semantic-only merged solution -- it must not be
      // dropped just because the syntax merge couldn't resolve every sentence.
      expect((component.semvis.setItems as jasmine.Spy)).toHaveBeenCalled();
      const items = (component.semvis.setItems as jasmine.Spy).calls.mostRecent().args[0];
      expect(items.length).toBe(1);
      expect(items[0].sequenceAnalysis).toBeUndefined();
    });
  });

  describe('mergeCurrentSolutions (index-misalignment regression)', () => {
    it('pairs the current solution with the previous element whose semantic has a graph, not by unfiltered array index', () => {
      // Two previous SENTENCES (not two semantics on one element) so that an index
      // shift is actually observable: sentenceA's semantic is filtered out (no graph),
      // so the surviving previous context must still point at sentenceB, not shift back
      // to sentenceA because it happened to occupy the filtered-out array slot.
      const sentenceA: SentenceAnalysis = {
        ...sentence('sA', 'Filtered-out previous sentence.'),
        semantics: [{ syntacticOrigin: 'syn-sA', semId: 'sem-A', semString: 'P', semType: 'lfgxdrt' }],
      };
      const sentenceB: SentenceAnalysis = {
        ...sentence('sB', 'Surviving previous sentence.'),
        semantics: [{ syntacticOrigin: 'syn-sB', semId: 'sem-B', semString: 'Q', semType: 'lfgxdrt', graph: structure }],
      };
      component.previousSequenceAnalyses = [];
      component.previousSentenceAnalyses = [sentenceA, sentenceB];
      component.knownSentences = [sentenceA, sentenceB];

      const solution: GswbSolution = {
        id: 'cur-1',
        solution: 'current',
        solutionKey: 'cur-key',
        graph: structure,
        semanticAnalysis: { syntacticOrigin: 'syn-cur', semId: 'sem-cur', semString: 'R', semType: 'lfgxdrt', graph: structure },
        sentenceAnalysis: sentence('sC', 'Current sentence.'),
      };

      (component as any).mergeCurrentSolutions([solution]);

      expect(dataServiceMock.gswbMergeSequenceSemantics).toHaveBeenCalledTimes(1);
      const request = dataServiceMock.gswbMergeSequenceSemantics.calls.mostRecent().args[0];
      expect(request.parts[0].id).toBe('sem-B');
      expect(request.parts[0].sentenceId).toBe('sB');
    });
  });

  describe('onMeaningConstructorsEdited (editor-drops-edit regression)', () => {
    it('syncs a live edit into the selected proof input, not just meaningConstructors', () => {
      component.proofInputs = [
        { proofId: 'p0', meaningConstructors: 'original 0' } as any,
        { proofId: 'p1', meaningConstructors: 'original 1' } as any,
      ];
      component.selectedProofInputIndex = 0;

      component.onMeaningConstructorsEdited('edited 0');

      expect(component.meaningConstructors).toBe('edited 0');
      expect(component.proofInputs[0].meaningConstructors).toBe('edited 0');
      expect(component.proofInputs[1].meaningConstructors).toBe('original 1');
    });

    it('survives paging away and back via previous/nextProofInput', () => {
      component.proofInputs = [
        { proofId: 'p0', meaningConstructors: 'original 0' } as any,
        { proofId: 'p1', meaningConstructors: 'original 1' } as any,
      ];
      component.selectedProofInputIndex = 0;
      component.editor1 = { getContent: jasmine.createSpy('getContent'), updateContent: jasmine.createSpy('updateContent') } as any;

      component.onMeaningConstructorsEdited('edited 0');
      component.nextProofInput();
      component.previousProofInput();

      expect(component.proofInputs[0].meaningConstructors).toBe('edited 0');
    });

    it('is a no-op when no proof input is selected', () => {
      component.proofInputs = [];
      component.selectedProofInputIndex = 0;

      expect(() => component.onMeaningConstructorsEdited('edited')).not.toThrow();
      expect(component.meaningConstructors).toBe('edited');
    });
  });
});
