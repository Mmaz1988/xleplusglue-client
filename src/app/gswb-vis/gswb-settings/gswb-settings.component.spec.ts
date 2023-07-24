import { ComponentFixture, TestBed } from '@angular/core/testing';

import { GswbSettingsComponent } from './gswb-settings.component';

describe('GswbSettingsComponent', () => {
  let component: GswbSettingsComponent;
  let fixture: ComponentFixture<GswbSettingsComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [GswbSettingsComponent]
    });
    fixture = TestBed.createComponent(GswbSettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
