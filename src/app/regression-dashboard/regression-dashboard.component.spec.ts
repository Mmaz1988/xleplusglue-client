import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { Router } from '@angular/router';
import { of, Subject } from 'rxjs';

import { RegressionDashboardComponent } from './regression-dashboard.component';
import { RegressionDashboardCacheService } from './regression-dashboard-cache.service';
import { DataService } from '../data.service';

describe('RegressionDashboardComponent deletion', () => {
  let fixture: ComponentFixture<RegressionDashboardComponent>;
  let component: RegressionDashboardComponent;
  let dataService: jasmine.SpyObj<DataService>;
  let cache: jasmine.SpyObj<RegressionDashboardCacheService>;

  const summary = (sessionKey: string) => ({ sessionKey, displayLabel: sessionKey, updatedAt: '2026-10-06T00:00:00Z' } as any);
  const card = (sessionKey: string) => ({ ...summary(sessionKey), sentenceCount: 1 } as any);

  beforeEach(() => {
    dataService = jasmine.createSpyObj('DataService',
      ['listRegressionSessions', 'loadRegressionSession', 'deleteRegressionSessions']);
    cache = jasmine.createSpyObj('RegressionDashboardCacheService',
      ['getAll', 'get', 'replaceAll', 'upsert', 'remove', 'clear']);
    // Every listed bank is cached, so a refresh needs no per-bank load.
    cache.getAll.and.returnValue([card('a'), card('b')]);
    cache.get.and.callFake((key: string) => card(key));
    spyOn(window, 'confirm').and.returnValue(true);

    TestBed.configureTestingModule({
      declarations: [RegressionDashboardComponent],
      providers: [
        { provide: DataService, useValue: dataService },
        { provide: RegressionDashboardCacheService, useValue: cache },
        { provide: Router, useValue: jasmine.createSpyObj('Router', ['navigate']) },
      ],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    });
    fixture = TestBed.createComponent(RegressionDashboardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  function refreshButton(): HTMLButtonElement {
    return [...fixture.nativeElement.querySelectorAll('button')]
      .find((button: HTMLButtonElement) => button.textContent?.includes('Refresh sessions'));
  }

  it('sends the whole selection in one request', () => {
    const response = new Subject<any>();
    dataService.deleteRegressionSessions.and.returnValue(response);
    component.toggleSelectionMode();
    component.toggleSessionSelection('a');
    component.toggleSessionSelection('b');

    component.deleteSelectedSessions();

    expect(dataService.deleteRegressionSessions).toHaveBeenCalledOnceWith(['a', 'b']);
  });

  it('keeps refresh disabled until the list has been re-read after the delete', () => {
    const response = new Subject<any>();
    const listed = new Subject<any>();
    dataService.deleteRegressionSessions.and.returnValue(response);
    dataService.listRegressionSessions.and.returnValue(listed);
    component.toggleSelectionMode();
    component.toggleSessionSelection('a');

    component.deleteSelectedSessions();
    fixture.detectChanges();
    expect(component.deleting).toBeTrue();
    expect(refreshButton().disabled).toBeTrue();

    response.next({ status: 'ok', deleted: ['a'] });
    response.complete();
    fixture.detectChanges();
    // Deleted, but the store has not been re-read yet.
    expect(dataService.listRegressionSessions).toHaveBeenCalled();
    expect(refreshButton().disabled).toBeTrue();

    listed.next([summary('b')]);
    listed.complete();
    fixture.detectChanges();
    expect(component.deleting).toBeFalse();
    expect(refreshButton().disabled).toBeFalse();
    expect(component.sessions.map(session => session.sessionKey)).toEqual(['b']);
    expect(component.statusMessage).toBe('Deleted 1 inference bank.');
  });

  it('lifts the lock after a failed delete, once the list is re-read', () => {
    const failing = new Subject<any>();
    dataService.deleteRegressionSessions.and.returnValue(failing);
    dataService.listRegressionSessions.and.returnValue(of([summary('a')]));
    component.toggleSelectionMode();
    component.toggleSessionSelection('a');

    component.deleteSelectedSessions();
    failing.error(new Error('down'));

    expect(component.deleting).toBeFalse();
    expect(component.statusMessage).toBe('The selected banks could not be deleted.');
  });

  it('ignores selection, opening and a second delete while deleting', () => {
    dataService.deleteRegressionSessions.and.returnValue(new Subject<any>());
    component.toggleSelectionMode();
    component.toggleSessionSelection('a');
    component.deleteSelectedSessions();

    component.toggleSessionSelection('b');
    component.openSession(summary('a'));
    component.deleteSelectedSessions();

    expect(component.isSelected('b')).toBeFalse();
    expect(TestBed.inject(Router).navigate).not.toHaveBeenCalled();
    expect(dataService.deleteRegressionSessions).toHaveBeenCalledTimes(1);
  });
});
