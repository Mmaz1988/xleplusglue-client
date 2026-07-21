import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';

import { GswbSettingsComponent } from './gswb-settings.component';

describe('GswbSettingsComponent', () => {
  let component: GswbSettingsComponent;
  let fixture: ComponentFixture<GswbSettingsComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [GswbSettingsComponent],
      imports: [ReactiveFormsModule]
    });
    fixture = TestBed.createComponent(GswbSettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('enables beta reduction when DRS resolution is selected', () => {
    component.gswbPreferencesForm.patchValue({ betaReduce: false, resolveDrs: true });

    expect(component.gswbPreferencesForm.value.betaReduce).toBeTrue();
    expect(component.gswbPreferencesForm.value.resolveDrs).toBeTrue();
  });

  it('clears DRS resolution when beta reduction is disabled', () => {
    component.gswbPreferencesForm.patchValue({ betaReduce: true, resolveDrs: true });
    component.gswbPreferencesForm.get('betaReduce')?.setValue(false);

    expect(component.gswbPreferencesForm.value.betaReduce).toBeFalse();
    expect(component.gswbPreferencesForm.value.resolveDrs).toBeFalse();
  });
});
