import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RuleListElementComponent } from './rule-list-element.component';

describe('RuleListElementComponent', () => {
  let component: RuleListElementComponent;
  let fixture: ComponentFixture<RuleListElementComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [RuleListElementComponent]
    });
    fixture = TestBed.createComponent(RuleListElementComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
