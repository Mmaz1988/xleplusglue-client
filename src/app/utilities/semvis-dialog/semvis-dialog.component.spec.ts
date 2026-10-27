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

  it('passes a discourse selection change on, keyed by the dialog\'s item', () => {
    const changes: any[] = [];
    component.readingSelectionChange.subscribe(change => changes.push(change));
    (component as any).activeSentenceId = 'n1';
    const selection = { criteria: ['surface'], filters: [], k: 1 } as any;
    component.onReadingSelectionChange(selection);
    component.onReadingSelectionChange(null);
    expect(changes).toEqual([{ sentenceId: 'n1', selection }, { sentenceId: 'n1', selection: null }]);
  });
});
