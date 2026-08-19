import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { of } from 'rxjs';

import { LigerVisComponent } from './liger-vis.component';
import { DataService } from '../data.service';
import { AnalysisWorkspaceStateService } from '../analysis-workspace-state.service';

describe('LigerVisComponent', () => {
  let component: LigerVisComponent;
  let fixture: ComponentFixture<LigerVisComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [LigerVisComponent],
      providers: [
        { provide: DataService, useValue: {} },
        { provide: AnalysisWorkspaceStateService, useValue: { getState: () => ({ liger: null }) } },
      ],
      schemas: [NO_ERRORS_SCHEMA]
    });
    fixture = TestBed.createComponent(LigerVisComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('does not allow adding a sentence before GSWB returns a solution', () => {
    component.sequenceSentences = ['The first sentence.'];
    component.solutions = [{ meaningConstructors: 'a', appliedRules: [] } as any];
    component.semanticSolutionReady = false;

    expect(component.canAppendSentence()).toBeFalse();
  });

  it('allows adding a sentence after a GSWB solution is ready', () => {
    component.sequenceSentences = ['The first sentence.'];
    component.solutions = [{ meaningConstructors: 'a', appliedRules: [] } as any];
    component.semanticSolutionReady = true;

    expect(component.canAppendSentence()).toBeTrue();
  });

  it('uses all proof inputs by default', () => {
    const inputs: any[] = [];
    component.proofInputChange.subscribe(value => inputs.push(value));
    component.solutions = [
      { solutionKey: 'syntax-a', meaningConstructors: 'a', appliedRules: [], structureJson: { id: 'a' } },
      { solutionKey: 'syntax-b', meaningConstructors: 'b', appliedRules: [], structureJson: { id: 'b' } },
    ] as any;

    component.collectAllMeaningConstructors();

    expect(inputs[0].map(input => input.proofId)).toEqual(['syntax-a', 'syntax-b']);
  });

  it('filters proof inputs to the selected graph when requested', () => {
    const inputs: any[] = [];
    component.proofInputChange.subscribe(value => inputs.push(value));
    component.solutions = [
      { solutionKey: 'syntax-a', meaningConstructors: 'a', appliedRules: [], structureJson: { id: 'a' } },
      { solutionKey: 'syntax-b', meaningConstructors: 'b', appliedRules: [], structureJson: { id: 'b' } },
    ] as any;
    component.cy1 = { renderGraph: () => {} } as any;
    component.rulelist1 = { clearList: () => {}, addElement: () => {} } as any;

    component.selectSolution(1);
    component.toggleResultScope();

    expect(inputs[1]).toEqual([jasmine.objectContaining({
      proofId: 'syntax-b',
      solutionKey: 'syntax-b',
      meaningConstructors: 'b',
      structure: { id: 'b' },
    })]);
  });

  describe('analyzeSentence (discourseReset regression)', () => {
    it('emits discourseReset before proofInputChange, so a fresh parse cannot register against a stale document', () => {
      // Regression for the captured corruption
      // (misc/current/analysis-document-sequence-not-reset-properly.json): "Parse and
      // rewrite" starting a genuinely new discourse must reset the document BEFORE the
      // new sentence tries to register as sentence-1, not after -- otherwise it collides
      // with whatever discourse was there before.
      const solution = {
        solutionKey: 'S0', meaningConstructors: 'mc', appliedRules: [],
        structureJson: { id: 'x' }, graph: { graphElements: [] },
        sequenceAnalysis: { id: 'seq', text: 'he smiled', sentences: [], syntax: [], semantics: [], synSemMapping: {} },
      };
      (component as any).dataService = {
        ligerSequence: jasmine.createSpy('ligerSequence').and.returnValue(of({ solutions: [solution] })),
      };
      component.cy1 = { renderGraph: jasmine.createSpy('renderGraph') } as any;
      component.rulelist1 = { clearList: jasmine.createSpy('clearList'), addElement: jasmine.createSpy('addElement') } as any;

      const order: string[] = [];
      component.discourseReset.subscribe(() => order.push('discourseReset'));
      component.proofInputChange.subscribe(() => order.push('proofInputChange'));
      component.changeDetector.subscribe(() => order.push('changeDetector'));

      component.analyzeSentence('he smiled', '');

      expect(order[0]).toBe('discourseReset');
      expect(order).toContain('proofInputChange');
      expect(component.sequenceSentences).toEqual(['he smiled']);
      expect(component.sequenceSentenceIds).toEqual(['sentence-1']);
    });

    it('does not emit discourseReset when parsing fails', () => {
      (component as any).dataService = {
        ligerSequence: jasmine.createSpy('ligerSequence').and.returnValue(of({ solutions: [] })),
      };
      component.cy1 = { renderGraph: jasmine.createSpy('renderGraph') } as any;
      component.rulelist1 = { clearList: jasmine.createSpy('clearList'), addElement: jasmine.createSpy('addElement') } as any;

      const emissions: void[] = [];
      component.discourseReset.subscribe(() => emissions.push(undefined));

      component.analyzeSentence('gibberish', '');

      expect(emissions.length).toBe(0);
    });
  });

  describe('resetForNewDiscourse', () => {
    it('clears accumulated sequence/parse state and notifies downstream consumers', () => {
      component.sequenceSentences = ['First.', 'Second.'];
      component.sequenceSentenceIds = ['sentence-1', 'sentence-2'];
      component.parsedSentenceStructures = [[{ id: 'a' } as any]];
      component.structureJson = { id: 'x' } as any;
      component.graphElements = [{ data: { id: 'g1' } }];
      component.solutions = [{ solutionKey: 'syntax-a' } as any];
      component.selectedSolutionIndex = 1;
      component.meaningConstructors = 'stale mcs';
      component.textarea.nativeElement.value = 'stale sentence';
      component.errorhandle.nativeElement.innerHTML = 'stale error';

      const proofInputs: any[] = [];
      const changeDetectorEmissions: any[] = [];
      component.proofInputChange.subscribe(value => proofInputs.push(value));
      component.changeDetector.subscribe(value => changeDetectorEmissions.push(value));

      component.resetForNewDiscourse();

      expect(component.sequenceSentences).toEqual([]);
      expect(component.sequenceSentenceIds).toEqual([]);
      expect(component.parsedSentenceStructures).toEqual([]);
      expect(component.structureJson).toBeNull();
      expect(component.graphElements).toEqual([]);
      expect(component.solutions).toEqual([]);
      expect(component.selectedSolutionIndex).toBe(0);
      expect(component.meaningConstructors).toBe('');
      expect(component.textarea.nativeElement.value).toBe(component.defaultValue);
      expect(component.errorhandle.nativeElement.innerHTML).toBe('');
      expect(proofInputs).toEqual([[]]);
      expect(changeDetectorEmissions).toEqual(['']);
    });
  });
});
