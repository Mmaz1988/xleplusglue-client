import { ComponentFixture, TestBed } from '@angular/core/testing';

import { InferenceInterfaceComponent } from './inference-interface.component';

describe('InferenceInterfaceComponent', () => {
  let component: InferenceInterfaceComponent;
  let fixture: ComponentFixture<InferenceInterfaceComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [InferenceInterfaceComponent]
    });
    fixture = TestBed.createComponent(InferenceInterfaceComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
