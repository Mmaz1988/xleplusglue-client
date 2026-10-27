import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SemvisDialogComponent } from './semvis-dialog.component';

describe('SemvisDialogComponent', () => {
  let component: SemvisDialogComponent;
  let fixture: ComponentFixture<SemvisDialogComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [SemvisDialogComponent],
      // Shallow: the child components are not under test here.
      schemas: [NO_ERRORS_SCHEMA],
    });
    fixture = TestBed.createComponent(SemvisDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('always narrows to the discriminant selection, and the checkbox filters within it', () => {
    const setItemFilter = jasmine.createSpy('setItemFilter');
    component.semVis = { setItemFilter } as any;
    component.filterIds = ['a', 'b'];
    component.narrowIds = ['b', 'c'];

    component.toggleFilter(true);
    expect(setItemFilter).toHaveBeenCalledWith(['b']);
    component.toggleFilter(false);
    expect(setItemFilter).toHaveBeenCalledWith(['b', 'c']);
    component.narrowIds = null;
    component.toggleFilter(false);
    expect(setItemFilter).toHaveBeenCalledWith(null);
  });
});
