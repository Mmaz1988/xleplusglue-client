import { ComponentFixture, TestBed } from '@angular/core/testing';

import { GswbGraphVisComponent } from './gswb-graph-vis.component';

describe('GswbGraphVisComponent', () => {
  let component: GswbGraphVisComponent;
  let fixture: ComponentFixture<GswbGraphVisComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [GswbGraphVisComponent]
    });
    fixture = TestBed.createComponent(GswbGraphVisComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
