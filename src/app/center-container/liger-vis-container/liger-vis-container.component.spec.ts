import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LigerVisContainerComponent } from './liger-vis-container.component';

describe('LigerVisContainerComponent', () => {
  let component: LigerVisContainerComponent;
  let fixture: ComponentFixture<LigerVisContainerComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [LigerVisContainerComponent],
      // Shallow: the child components are not under test here.
      schemas: [NO_ERRORS_SCHEMA],
    });
    fixture = TestBed.createComponent(LigerVisContainerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
