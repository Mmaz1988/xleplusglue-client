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
      'getLastSession',
      'getLastSessionSummary'
    ]);
    dataServiceSpy.listRegressionSessions.and.returnValue(of([]));
    dataServiceSpy.loadRegressionSession.and.returnValue(of({} as any));
    dataServiceSpy.saveRegressionSession.and.returnValue(of({} as any));
    dataServiceSpy.deleteRegressionSession.and.returnValue(of({} as any));

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

  it('skips vampire progress requests while one is already in flight', () => {
    const sessionSubject = new Subject<any>();
    const summarySubject = new Subject<any>();
    const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
    dataServiceSpy.getLastSession.and.returnValue(sessionSubject.asObservable());
    dataServiceSpy.getLastSessionSummary.and.returnValue(summarySubject.asObservable());

    component.loading = true;
    component['regressionTestItems'] = [];
    component['sentenceMap'] = {};
    component['activeVampireRunStartedAt'] = 123;

    (component as any).loadAndRenderVampireState(false, 123);
    (component as any).loadAndRenderVampireState(false, 123);

    expect(dataServiceSpy.getLastSession).toHaveBeenCalledTimes(1);
    expect(dataServiceSpy.getLastSessionSummary).toHaveBeenCalledTimes(1);

    sessionSubject.next({ results: {} });
    sessionSubject.complete();
    summarySubject.next({ item_count: 0, proof_count: 0 });
    summarySubject.complete();

    expect(dataServiceSpy.getLastSession).toHaveBeenCalledTimes(1);
    expect(dataServiceSpy.getLastSessionSummary).toHaveBeenCalledTimes(1);
  });

  it('queues the final vampire refresh until the in-flight request finishes', () => {
    const firstSessionSubject = new Subject<any>();
    const firstSummarySubject = new Subject<any>();
    const secondSessionSubject = new Subject<any>();
    const secondSummarySubject = new Subject<any>();
    const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
    dataServiceSpy.getLastSession.and.returnValues(
      firstSessionSubject.asObservable(),
      secondSessionSubject.asObservable()
    );
    dataServiceSpy.getLastSessionSummary.and.returnValues(
      firstSummarySubject.asObservable(),
      secondSummarySubject.asObservable()
    );

    component.loading = true;
    component['regressionTestItems'] = [];
    component['sentenceMap'] = {};
    component['activeVampireRunStartedAt'] = 123;

    (component as any).loadAndRenderVampireState(false, 123);
    (component as any).loadAndRenderVampireState(true, 123);

    expect(dataServiceSpy.getLastSession).toHaveBeenCalledTimes(1);
    expect(dataServiceSpy.getLastSessionSummary).toHaveBeenCalledTimes(1);

    firstSessionSubject.next({ results: {} });
    firstSessionSubject.complete();
    firstSummarySubject.next({ item_count: 0, proof_count: 0 });
    firstSummarySubject.complete();

    expect(dataServiceSpy.getLastSession).toHaveBeenCalledTimes(2);
    expect(dataServiceSpy.getLastSessionSummary).toHaveBeenCalledTimes(2);

    secondSessionSubject.next({ results: {} });
    secondSessionSubject.complete();
    secondSummarySubject.next({ item_count: 0, proof_count: 0 });
    secondSummarySubject.complete();
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

  it('waits for the backend cancel response before clearing the abort state', () => {
    const cancelSubject = new Subject<any>();
    const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
    dataServiceSpy.requestVampireCancel.and.returnValue(cancelSubject.asObservable());

    component.loading = true;
    component['saveOperationInProgress'] = true;
    component['activeSaveAction'] = null;

    component.abortCurrentRun();

    expect(dataServiceSpy.requestVampireCancel).toHaveBeenCalledTimes(1);
    expect(component.loading).toBeTrue();
    expect(component['abortRequestInFlight']).toBeTrue();
    expect(component.canAbortRun).toBeFalse();

    cancelSubject.next({});
    cancelSubject.complete();

    expect(component['abortRequestInFlight']).toBeFalse();
    expect(component.loading).toBeFalse();
  });
});
