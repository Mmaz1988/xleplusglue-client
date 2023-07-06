import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SubGraphDialogComponent } from './sub-graph-dialog.component';

describe('SubGraphDialogComponent', () => {
  let component: SubGraphDialogComponent;
  let fixture: ComponentFixture<SubGraphDialogComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [SubGraphDialogComponent]
    });
    fixture = TestBed.createComponent(SubGraphDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
