import { ComponentFixture, TestBed } from '@angular/core/testing';

import { InferenceVisComponent } from './inference-vis.component';

describe('InferenceVisComponent', () => {
  let component: InferenceVisComponent;
  let fixture: ComponentFixture<InferenceVisComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [InferenceVisComponent]
    });
    fixture = TestBed.createComponent(InferenceVisComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
