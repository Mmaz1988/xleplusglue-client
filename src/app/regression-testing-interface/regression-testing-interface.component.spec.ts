import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subject, of } from 'rxjs';

import { RegressionTestingInterfaceComponent } from './regression-testing-interface.component';
import { DataService } from '../data.service';

describe('RegressionTestingInterfaceComponent', () => {
  let component: RegressionTestingInterfaceComponent;
  let fixture: ComponentFixture<RegressionTestingInterfaceComponent>;

  beforeEach(() => {
    const dataServiceSpy = jasmine.createSpyObj('DataService', [
      'listRegressionSessions',
      'loadRegressionSession',
      'saveRegressionSession',
      'deleteRegressionSession',
      'requestVampireCancel',
      'getVampireProgress',
      'getLastSession',
      'getLastSessionSummary',
      'getLastGswbSession',
      'getLastGswbSessionSummary'
    ]);
    dataServiceSpy.listRegressionSessions.and.returnValue(of([]));
    dataServiceSpy.loadRegressionSession.and.returnValue(of({} as any));
    dataServiceSpy.saveRegressionSession.and.returnValue(of({} as any));
    dataServiceSpy.deleteRegressionSession.and.returnValue(of({} as any));
    dataServiceSpy.getVampireProgress.and.returnValue(of({
      sessionKey: 'last_session',
      runId: null,
      state: 'idle',
      cancelRequested: false,
      activeItemId: null,
      completedItemIds: [],
      changedItemIds: [],
      itemResults: {},
      itemCount: 0,
      proofCount: 0,
      totalItemCount: 0,
      updatedAt: new Date().toISOString(),
    }));
    dataServiceSpy.getLastSession.and.returnValue(of({ results: {} }));
    dataServiceSpy.getLastSessionSummary.and.returnValue(of({ item_count: 0, proof_count: 0 }));
    dataServiceSpy.getLastGswbSession.and.returnValue(of({ outputs: {} } as any));
    dataServiceSpy.getLastGswbSessionSummary.and.returnValue(of({} as any));

    TestBed.configureTestingModule({
      imports: [FormsModule],
      declarations: [RegressionTestingInterfaceComponent],
      providers: [
        { provide: DataService, useValue: dataServiceSpy },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => null } } } },
      ],
      schemas: [CUSTOM_ELEMENTS_SCHEMA]
    });
    fixture = TestBed.createComponent(RegressionTestingInterfaceComponent);
    component = fixture.componentInstance;
    component['testfile'] = { getContent: () => '', updateContent: () => {} } as any;
    component['ligerRules'] = { getContent: () => '', updateContent: () => {} } as any;
    component['axiomEdit'] = { getContent: () => '', updateContent: () => {} } as any;
    component['gswbPreferences'] = {
      gswbPreferences: {},
      gswbPreferencesForm: { valueChanges: of([]) },
      updateFormFromPreferences: () => {},
    } as any;
    component['vampirePreferences'] = {
      vampirePreferences: {},
      vampirePreferencesForm: { valueChanges: of([]) },
      updateFormFromPreferences: () => {},
    } as any;
    component['errorhandle'] = { nativeElement: { textContent: '', style: {} } } as any;
    component['semvisDialog'] = { open: () => {} } as any;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('filters Vampire solutions to the disambiguated selection', () => {
    component.session.selectedSolutionIdsBySentence = { S1: ['sol-2'] };

    const result = (component as any).getSolutionsText(
      'S1',
      {
        S1: {
          solutions: [
            { id: 'sol-1', solution: 'first' },
            { id: 'sol-2', solution: 'second' },
          ],
          log: '',
          derivation: null,
          discriminants: [],
        }
      },
      true
    );

    expect(result).toEqual(['second']);
  });

  it('does not fall back to all solutions in disambiguated mode when no selection exists', () => {
    component.session.selectedSolutionIdsBySentence = {};

    const result = (component as any).getSolutionsText(
      'S1',
      {
        S1: {
          solutions: [
            { id: 'sol-1', solution: 'first' },
            { id: 'sol-2', solution: 'second' },
          ],
          log: '',
          derivation: null,
          discriminants: [],
        }
      },
      true
    );

    expect(result).toEqual([]);
  });

  it('detects append items that touch updated sentences', () => {
    const result = (component as any).itemTouchesUpdatedSentences(
      { premises: ['S1'], conclusion: ['S2'] },
      new Set(['S2'])
    );

    expect(result).toBeTrue();
  });

  it('describes mixed vampire reruns with progressive wording', () => {
    component['vampireReprocessingItemCount'] = 8;
    component['vampireNewItemCount'] = 8;

    expect(component.vampireProgressLabel).toBe('Re-processing 8 items and processing 8 new items...');
  });

  it('shows absolute progress against the full bank size', () => {
    component['vampireProgressItemCount'] = 8;
    component['vampireProgressTotalCount'] = 16;

    expect(component.vampireProgressPercent).toBe(50);
  });

  it('shows vampire pending only while a vampire run is active', () => {
    component.session.timing.parseMs = 1200;
    component['activeVampireRunStartedAt'] = 123;

    expect(component.processingTimingSummary).toContain('Vampire pending');

    component['activeVampireRunStartedAt'] = null;
    component.session.hasRunVampire = true;
    component.inferenceResults = [{ id: 'I1' } as any];
    component.regressionTestItems = [{ id: 'I1' } as any, { id: 'I2' } as any];

    expect(component.processingTimingSummary).toContain('Vampire call incomplete');
  });

  it('counts disambiguated sentences when selected solutions differ from all solutions', () => {
    component.session.lastGswbOutputs = {
      S1: { solutions: [{ id: 'a', solution: 'a' }, { id: 'b', solution: 'b' }], log: '', derivation: null, discriminants: [] },
      S2: { solutions: [{ id: 'c', solution: 'c' }], log: '', derivation: null, discriminants: [] },
    } as any;
    component.session.selectedSolutionIdsBySentence = {
      S1: ['a'],
      S2: ['c'],
    };

    expect(component.disambiguatedSentenceCount).toBe(1);
  });

  it('counts vampire proofs from the saved result set', () => {
    component.session.lastVampireResults = {
      I1: [{ proof_files: ['p1', 'p2'] } as any],
      I2: [{ proof_files: [] } as any, { proof_files: ['p3'] } as any],
    } as any;

    expect(component.vampireProofCount).toBe(3);
  });

  it('includes parse, vampire, and disambiguated counts in the timing details', () => {
    component.session.timing.startedAt = '2026-05-18T21:00:00.000Z';
    component.session.timing.parseMs = 1234;
    component.session.timing.vampireMs = 2345;
    component.session.timing.totalMs = 3579;
    component.sentenceMap = { S1: 'One', S2: 'Two' };
    component.regressionTestResults = [{ sentence_id: 'S1' } as any, { sentence_id: 'S2' } as any];
    component.regressionTestItems = [{ id: 'I1' } as any, { id: 'I2' } as any];
    component.session.lastVampireResults = {
      I1: [{ proof_files: ['p1'] } as any],
      I2: [{ proof_files: ['p2', 'p3'] } as any],
    } as any;
    component.session.lastGswbOutputs = {
      S1: { solutions: [{ id: 'a', solution: 'a' }, { id: 'b', solution: 'b' }], log: '', derivation: null, discriminants: [] },
      S2: { solutions: [{ id: 'c', solution: 'c' }], log: '', derivation: null, discriminants: [] },
    } as any;
    component.session.selectedSolutionIdsBySentence = {
      S1: ['a'],
      S2: ['c'],
    };

    const details = component.processingTimingDetails;

    expect(details).toContain('Parse phase: 1.23s · 2/2 parses');
    expect(details).toContain('Vampire phase: 2.35s · 0/2 items');
    expect(details).toContain('Disambiguated sentences: 1 total');
    expect(details).toContain('Proofs: 3 total');
    expect(details).toContain('Overall: 3.58s');
  });

  it('does not show a saving message for current session no-ops', () => {
    const displaySpy = spyOn(component, 'displayMessage');

    component['sessionPersistenceEnabled'] = true;
    component['isHydratingSession'] = false;
    component['lastSavedSessionFingerprint'] = (component as any).buildSessionFingerprint((component as any).buildSessionSnapshot());

    component.saveCurrentSession();

    expect(displaySpy).not.toHaveBeenCalledWith(jasmine.stringMatching(/^Saving current session/), jasmine.any(String));
  });

  it('stays silent for autosave no-ops', () => {
    const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
    const displaySpy = spyOn(component, 'displayMessage');

    component['sessionPersistenceEnabled'] = true;
    component['isHydratingSession'] = false;
    component['lastSavedSessionFingerprint'] = (component as any).buildSessionFingerprint((component as any).buildSessionSnapshot());

    (component as any).scheduleSessionSave(true);

    expect(dataServiceSpy.saveRegressionSession).not.toHaveBeenCalled();
    expect(displaySpy).not.toHaveBeenCalled();
  });

  it('reports all parsed sentences on final GSWB refresh', () => {
    const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
    spyOn(component, 'displayMessage');
    dataServiceSpy.getLastGswbSession.and.returnValue(of({ outputs: {} } as any));

    component.loading = true;
    component['sentenceMap'] = { S1: 'One', S2: 'Two' };
    component['gswbRunToken'] = 1;
    component['activeGswbRunStartedAt'] = 123;

    (component as any).loadAndRenderGswbState(true, 123, 1);

    expect(component.displayMessage).toHaveBeenCalledWith('Parsed 2 of 2 sentences!', 'green');
  });

  it('does not show a fake parse count before GSWB finishes', () => {
    const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
    const displaySpy = spyOn(component, 'displayMessage');
    dataServiceSpy.getLastGswbSession.and.returnValue(of({ outputs: {} } as any));

    component.loading = true;
    component['isHydratingSession'] = true;
    component['sentenceMap'] = { S1: 'One', S2: 'Two' };
    component['gswbRunToken'] = 1;
    component['activeGswbRunStartedAt'] = 123;

    (component as any).loadAndRenderGswbState(false, 123, 1);

    expect(displaySpy).not.toHaveBeenCalled();
  });

  it('describes the completion message using the processed count', () => {
    component['vampireReprocessingItemCount'] = 8;
    component['vampireNewItemCount'] = 5;

    const message = (component as any).buildVampireCompletionDescription({ item_count: 13 });

    expect(message).toBe('Processed 13 items');
  });

  it('blocks autosave while an abort is in flight', () => {
    const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;

    component['sessionPersistenceEnabled'] = true;
    component['isHydratingSession'] = false;
    component['abortRequestInFlight'] = true;

    (component as any).scheduleSessionSave(true);

    expect(dataServiceSpy.saveRegressionSession).not.toHaveBeenCalled();
    expect(component['pendingAutosave']).toBeFalse();
  });

  it('allows abort while an autosave is in progress but not during manual saves', () => {
    component.loading = true;
    component['saveOperationInProgress'] = true;
    component['activeSaveAction'] = null;

    expect(component.canAbortRun).toBeTrue();

    component['activeSaveAction'] = 'current';

    expect(component.canAbortRun).toBeFalse();
  });

  it('keeps resend locked and saves the reloaded vampire state after abort finalization', () => {
    const cancelSubject = new Subject<any>();
    const progressSubject = new Subject<any>();
    const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
    dataServiceSpy.requestVampireCancel.and.returnValue(cancelSubject.asObservable());
    dataServiceSpy.getVampireProgress.and.returnValue(progressSubject.asObservable());

    component.loading = true;
    component['activeVampireRunStartedAt'] = 123;
    component['vampireRunToken'] = 123;
    component['regressionTestItems'] = [{ id: 'item-1', premises: ['S1'], conclusion: ['S2'], gold_label: '0' }];
    component['sentenceMap'] = { S1: 'Premise', S2: 'Hypothesis' };
    component['regressionTestResults'] = [{ sentence_id: 'S1', sentence: 'Premise', noOfAppliedRules: 0, noOfMCsets: 0, noOfSolutions: 0, ligerGraph: null, ligerMCsets: '', allMCs: null, gswbSolutions: [], gswbDerivation: null, result_type: 'parseResult' } as any];
    component.session.lastGswbOutputs = { S1: { solutions: [], log: '', derivation: null, discriminants: [] } as any };
    component.session.lastAnnotations = { S1: { graph: null, appliedRules: [] } as any };
    component.session.lastVampireResults = { stale: [{ glyph: 'old', informative: false, consistent: false, relevant: false, proof_files: [] }] };
    component['sessionPersistenceEnabled'] = true;
    component['isHydratingSession'] = false;

    component.abortCurrentRun();

    expect(dataServiceSpy.requestVampireCancel).toHaveBeenCalledTimes(1);
    expect(component.loading).toBeTrue();
    expect(component['abortRequestInFlight']).toBeTrue();
    expect(component.canAbortRun).toBeFalse();
    expect(component.canResendVampire).toBeFalse();

    cancelSubject.next({});
    cancelSubject.complete();

    progressSubject.next({
      sessionKey: 'last_session',
      runId: null,
      state: 'cancel_requested',
      cancelRequested: true,
      activeItemId: null,
      completedItemIds: [],
      changedItemIds: [],
      itemResults: {},
      itemCount: 0,
      proofCount: 0,
      totalItemCount: 1,
      updatedAt: new Date().toISOString(),
    });

    expect(dataServiceSpy.saveRegressionSession).not.toHaveBeenCalled();
    expect(component['abortRequestInFlight']).toBeTrue();
    expect(component.canResendVampire).toBeFalse();

    progressSubject.next({
      sessionKey: 'last_session',
      runId: null,
      state: 'cancelled',
      cancelRequested: false,
      activeItemId: null,
      completedItemIds: ['item-1'],
      changedItemIds: [],
      itemResults: { 'item-1': [{ glyph: 'new', informative: true, consistent: true, relevant: true, proof_files: ['p1'] }] },
      itemCount: 1,
      proofCount: 1,
      totalItemCount: 1,
      updatedAt: new Date().toISOString(),
    });
    progressSubject.complete();

    expect(dataServiceSpy.saveRegressionSession).toHaveBeenCalledTimes(1);
    const [, snapshot] = dataServiceSpy.saveRegressionSession.calls.mostRecent().args;
    expect(snapshot.analysis.save_state.lastVampireResults['item-1'][0].glyph).toBe('new');
    expect(component['abortRequestInFlight']).toBeFalse();
    expect(component.loading).toBeFalse();
    expect(component.canResendVampire).toBeTrue();
  });
});
