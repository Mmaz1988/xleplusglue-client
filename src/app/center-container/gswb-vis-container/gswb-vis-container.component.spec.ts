import { ComponentFixture, TestBed } from '@angular/core/testing';

import { GswbVisContainerComponent } from './gswb-vis-container.component';

describe('GswbVisContainerComponent', () => {
  let component: GswbVisContainerComponent;
  let fixture: ComponentFixture<GswbVisContainerComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [GswbVisContainerComponent]
    });
    fixture = TestBed.createComponent(GswbVisContainerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
