import { ComponentFixture, TestBed } from '@angular/core/testing';

import { InferenceResultComponent } from './inference-result.component';

describe('InferenceResultComponent', () => {
  let component: InferenceResultComponent;
  let fixture: ComponentFixture<InferenceResultComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [InferenceResultComponent]
    });
    fixture = TestBed.createComponent(InferenceResultComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
