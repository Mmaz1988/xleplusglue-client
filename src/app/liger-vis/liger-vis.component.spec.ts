import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';

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
});
