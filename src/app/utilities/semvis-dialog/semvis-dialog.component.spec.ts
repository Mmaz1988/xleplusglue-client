import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SemvisDialogComponent } from './semvis-dialog.component';

describe('SemvisDialogComponent', () => {
  let component: SemvisDialogComponent;
  let fixture: ComponentFixture<SemvisDialogComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [SemvisDialogComponent]
    });
    fixture = TestBed.createComponent(SemvisDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
