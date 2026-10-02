import { NO_ERRORS_SCHEMA } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RuleListElementComponent } from './rule-list-element.component';

describe('RuleListElementComponent', () => {
  let component: RuleListElementComponent;
  let fixture: ComponentFixture<RuleListElementComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [FormsModule],
      declarations: [RuleListElementComponent],
      // Shallow: the child components are not under test here.
      schemas: [NO_ERRORS_SCHEMA],
    });
    fixture = TestBed.createComponent(RuleListElementComponent);
    component = fixture.componentInstance;
    component.data = { rule: { rule: '#a SUBJ #b ==> #b ANIM +.', index: 0, lineNumber: 1 } };
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
