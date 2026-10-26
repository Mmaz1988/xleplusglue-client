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
        .and.returnValue(of({
          id: 'merged-1', solutionKey: 'sk-1',
          semanticAnalysis: { syntacticOrigin: 'sk-1', semId: 'merged-1', semString: 'merged semantic', graph: structure, semType: 'lfgxdrt', svg: 'merged' },
        } as GswbSolution)),
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

  describe('mergeCurrentSolutions (appending the sentence\'s own readings)', () => {
    /** "Kim saw a man with a telescope." (3 parses, one reading each) + "He smiled.". */
    const parse = (sentenceId: string, synId: string) =>
      ({ synId, structure: { id: `${sentenceId}/${synId}`, mcs: 13 } as any, graph: { graphElements: [] } });
    const reading = (sentenceId: string, synId: string): SemanticAnalysis => ({
      syntacticOrigin: synId, semId: `${sentenceId}-${synId}-s0`, semString: 'P', semType: 'lfgxdrt', graph: structure,
    });
    const kim: SentenceAnalysis = {
      id: 'sentence-1', text: 'Kim saw a man with a telescope.',
      syntax: ['S0', 'S1', 'S2'].map(synId => parse('sentence-1', synId)),
      semantics: ['S0', 'S1', 'S2'].map(synId => reading('sentence-1', synId)),
      synSemMapping: { S0: ['sentence-1-S0-s0'], S1: ['sentence-1-S1-s0'], S2: ['sentence-1-S2-s0'] },
    };
    const he: SentenceAnalysis = {
      id: 'sentence-2', text: 'He smiled.', syntax: [parse('sentence-2', 'S0')],
      semantics: [reading('sentence-2', 'S0')], synSemMapping: { S0: ['sentence-2-S0-s0'] },
    };
    /** LiGER over two supplied sentences: one variant per parse of the first, analyses S0.. per call. */
    const fakeLigerSequence = (request: any) => {
      let counter = 0;
      const ids: string[][] = request.parsedSentences.map((structures: any[]) => structures.map(() => `S${counter++}`));
      return of({ solutions: ids[0].map((first, v) => ({
        solutionKey: `sequence-${v + 1}-${first}+${ids[1][0]}`,
        structureJson: { variant: v },
        sequenceParts: [
          { sourceIndex: 0, syntaxVariantId: first, sourceIndexOffset: 0 },
          { sourceIndex: 1, syntaxVariantId: ids[1][0], sourceIndexOffset: 13 },
        ],
        sequenceAnalysis: { id: 'x', text: 'x', sentences: [], syntax: [{ synId: 'x', structure: {}, graph: { graphElements: [] } }] },
      })) });
    };

    beforeEach(() => {
      component.errorhandle = { nativeElement: { style: {} } } as any;
      dataServiceMock.ligerSequence.and.callFake(fakeLigerSequence);
      dataServiceMock.gswbMergeSequenceSemantics.and.callFake((request: any) => {
        const id = request.parts.map((part: any) => part.id).join('+');
        return of({ id, semanticAnalysis: { syntacticOrigin: request.solutionKey, semId: id, semString: 'P Q', semType: 'lfgxdrt', graph: structure } });
      });
    });

    it('shows one reading per parse of the previous sentence for a 3 x 1 discourse, each moved by its offset', () => {
      component.previousSentenceAnalyses = [kim];
      component.previousSequenceAnalyses = [];
      component.knownSentences = [kim, he];
      const solution = { id: 'sentence-2-S0-s0', solutionKey: 'S0', semanticAnalysis: he.semantics[0], sentenceAnalysis: he } as GswbSolution;
      const emitted: SequenceAnalysis[][] = [];
      component.sequenceAnalysisChange.subscribe(value => emitted.push(value));

      (component as any).mergeCurrentSolutions([solution]);

      expect(dataServiceMock.ligerSequence).toHaveBeenCalledTimes(1);
      const items = (component.semvis.setItems as jasmine.Spy).calls.mostRecent().args[0];
      expect(items.map((item: GswbSolution) => item.id)).toEqual([
        'sentence-1-S0-s0+sentence-2-S0-s0', 'sentence-1-S1-s0+sentence-2-S0-s0', 'sentence-1-S2-s0+sentence-2-S0-s0',
      ]);
      expect(dataServiceMock.gswbMergeSequenceSemantics.calls.allArgs().map(args => args[0].parts[1].sourceIndexOffset))
        .toEqual([13, 13, 13]);
      expect(emitted[0][0].syntax.map(syntax => syntax.synId)).toEqual(['S0+S0', 'S1+S0', 'S2+S0']);
    });

    it('says which previous readings could not be extended instead of merging them blind', () => {
      const previousSequence: SequenceAnalysis = {
        id: 'sentence-1+sentence-2', text: 'Prev.', sentenceIds: ['sentence-1', 'sentence-2'],
        syntax: [{ synId: 'S0+S0', structure, graph: { graphElements: [] } }],
        semantics: [{ syntacticOrigin: 'S0+S0', semId: 'seq-sem', semString: 'P Q', semType: 'lfgxdrt', graph: structure }],
        synSemMapping: { 'S0+S0': ['seq-sem'] },
      };
      component.previousSequenceAnalyses = [previousSequence];
      // sentence-2 is deliberately missing from the registry.
      component.knownSentences = [kim];
      const third: SentenceAnalysis = { ...he, id: 'sentence-3', text: 'A man smiled.' };
      const solution = { id: 's3', solutionKey: 'S0', semanticAnalysis: third.semantics[0], sentenceAnalysis: third } as GswbSolution;
      spyOn(console, 'warn');

      (component as any).mergeCurrentSolutions([solution]);

      expect(dataServiceMock.gswbMergeSequenceSemantics).not.toHaveBeenCalled();
      expect(component.errorhandle.nativeElement.innerHTML).toContain('sentence-2');
      expect((component.semvis.setItems as jasmine.Spy).calls.mostRecent().args[0]).toEqual([]);
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

      const current = sentence('sC', 'Current sentence.');
      current.semantics[0].graph = structure;
      const solution: GswbSolution = {
        id: 'cur-1',
        solutionKey: 'syn-sC',
        semanticAnalysis: current.semantics[0],
        sentenceAnalysis: current,
      };
      dataServiceMock.ligerSequence.and.returnValue(of({ solutions: [{
        solutionKey: 'sequence-1-S0+S1', structureJson: structure,
        sequenceParts: [
          { sourceIndex: 0, syntaxVariantId: 'S0', sourceIndexOffset: 0 },
          { sourceIndex: 1, syntaxVariantId: 'S1', sourceIndexOffset: 4 },
        ],
      }] }));

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

  describe('resetForNewDiscourse', () => {
    it('clears accumulated semantic state and the sem-vis display', () => {
      component.meaningConstructors = 'stale mcs';
      component.proofInputs = [{ proofId: 'p0' } as any];
      component.selectedProofInputIndex = 1;
      (component as any).allSemanticSolutions = [{ id: 's1' }];
      (component as any).semanticDiscriminants = [{ id: 'd1' } as any];
      (component as any).selectedSemanticIds = ['s1'];
      (component as any).selectedScopeIds = ['scope-1'];
      (component as any).selectedMcIds = ['mc-1'];
      (component as any).hasSemanticSolutions = true;
      component.semanticSolutionReady = true;
      component.editor1 = { updateContent: jasmine.createSpy('updateContent') } as any;
      component.sem = { updateContent: jasmine.createSpy('updateContent') } as any;
      component.log = { updateContent: jasmine.createSpy('updateContent') } as any;
      component.semvis = {
        setItems: jasmine.createSpy('setItems'),
        setDiscriminants: jasmine.createSpy('setDiscriminants'),
        clearMc: jasmine.createSpy('clearMc'),
        clearScope: jasmine.createSpy('clearScope'),
      } as any;

      component.resetForNewDiscourse();

      expect(component.meaningConstructors).toBe('');
      expect(component.proofInputs).toEqual([]);
      expect(component.selectedProofInputIndex).toBe(0);
      expect(component.semanticSolutionReady).toBeFalse();
      expect(component.editor1.updateContent).toHaveBeenCalledWith('');
      expect(component.sem.updateContent).toHaveBeenCalledWith('');
      expect(component.log.updateContent).toHaveBeenCalledWith('');
      expect(component.semvis.setItems).toHaveBeenCalledWith([]);
      expect(component.semvis.setDiscriminants).toHaveBeenCalledWith([]);
      expect(component.semvis.clearMc).toHaveBeenCalled();
      expect(component.semvis.clearScope).toHaveBeenCalled();
    });
  });
});
