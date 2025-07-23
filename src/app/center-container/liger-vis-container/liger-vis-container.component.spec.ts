import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LigerVisContainerComponent } from './liger-vis-container.component';

describe('LigerVisContainerComponent', () => {
  let component: LigerVisContainerComponent;
  let fixture: ComponentFixture<LigerVisContainerComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [LigerVisContainerComponent]
    });
    fixture = TestBed.createComponent(LigerVisContainerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
