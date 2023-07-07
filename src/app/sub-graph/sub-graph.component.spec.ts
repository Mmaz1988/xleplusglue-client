import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SubGraphComponent } from './sub-graph.component';

describe('SubGraphComponent', () => {
  let component: SubGraphComponent;
  let fixture: ComponentFixture<SubGraphComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [SubGraphComponent]
    });
    fixture = TestBed.createComponent(SubGraphComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
