import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AppliedRulesGraphComponent } from './applied-rules-graph.component';

describe('AppliedRulesGraphComponent', () => {
  let component: AppliedRulesGraphComponent;
  let fixture: ComponentFixture<AppliedRulesGraphComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [AppliedRulesGraphComponent]
    });
    fixture = TestBed.createComponent(AppliedRulesGraphComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
