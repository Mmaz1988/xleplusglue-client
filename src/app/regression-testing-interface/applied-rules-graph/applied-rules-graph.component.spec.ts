import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AppliedRulesGraphComponent } from './applied-rules-graph.component';

describe('AppliedRulesGraphComponent', () => {
  let component: AppliedRulesGraphComponent;
  let fixture: ComponentFixture<AppliedRulesGraphComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [AppliedRulesGraphComponent],
      // Shallow: the child components are not under test here.
      schemas: [NO_ERRORS_SCHEMA],
    });
    fixture = TestBed.createComponent(AppliedRulesGraphComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
