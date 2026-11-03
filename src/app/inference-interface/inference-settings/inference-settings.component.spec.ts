import { ComponentFixture, TestBed } from '@angular/core/testing';

import { InferenceSettingsComponent } from './inference-settings.component';

describe('InferenceSettingsComponent', () => {
  let component: InferenceSettingsComponent;
  let fixture: ComponentFixture<InferenceSettingsComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [InferenceSettingsComponent]
    });
    fixture = TestBed.createComponent(InferenceSettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
