import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ToggleDisplayComponent } from './toggle-display.component';

describe('ToggleDisplayComponent', () => {
  let component: ToggleDisplayComponent;
  let fixture: ComponentFixture<ToggleDisplayComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [ToggleDisplayComponent]
    });
    fixture = TestBed.createComponent(ToggleDisplayComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
