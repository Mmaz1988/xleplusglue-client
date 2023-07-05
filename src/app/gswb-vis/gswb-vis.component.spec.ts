import { ComponentFixture, TestBed } from '@angular/core/testing';

import { GswbVisComponent } from './gswb-vis.component';

describe('GswbVisComponent', () => {
  let component: GswbVisComponent;
  let fixture: ComponentFixture<GswbVisComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [GswbVisComponent]
    });
    fixture = TestBed.createComponent(GswbVisComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
