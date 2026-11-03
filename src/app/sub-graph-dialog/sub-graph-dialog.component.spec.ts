import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SubGraphDialogComponent } from './sub-graph-dialog.component';

describe('SubGraphDialogComponent', () => {
  let component: SubGraphDialogComponent;
  let fixture: ComponentFixture<SubGraphDialogComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [SubGraphDialogComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA]
    });
    fixture = TestBed.createComponent(SubGraphDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
