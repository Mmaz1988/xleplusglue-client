import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SemComponent } from './sem.component';

describe('SemComponent', () => {
  let component: SemComponent;
  let fixture: ComponentFixture<SemComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [SemComponent]
    });
    fixture = TestBed.createComponent(SemComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
