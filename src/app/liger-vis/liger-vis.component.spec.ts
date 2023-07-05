import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LigerVisComponent } from './liger-vis.component';

describe('LigerVisComponent', () => {
  let component: LigerVisComponent;
  let fixture: ComponentFixture<LigerVisComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [LigerVisComponent]
    });
    fixture = TestBed.createComponent(LigerVisComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
