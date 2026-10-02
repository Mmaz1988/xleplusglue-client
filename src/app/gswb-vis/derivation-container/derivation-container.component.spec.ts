import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DerivationContainerComponent } from './derivation-container.component';

describe('DerivationContainerComponent', () => {
  let component: DerivationContainerComponent;
  let fixture: ComponentFixture<DerivationContainerComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [DerivationContainerComponent],
      // Shallow: the child components are not under test here.
      schemas: [NO_ERRORS_SCHEMA],
    });
    fixture = TestBed.createComponent(DerivationContainerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
