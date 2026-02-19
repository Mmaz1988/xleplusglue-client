import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SemVisComponent } from './sem-vis.component';

describe('SemVisComponent', () => {
  let component: SemVisComponent;
  let fixture: ComponentFixture<SemVisComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [SemVisComponent]
    });
    fixture = TestBed.createComponent(SemVisComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
