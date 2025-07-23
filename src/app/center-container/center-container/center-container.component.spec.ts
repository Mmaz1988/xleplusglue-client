import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CenterContainerComponent } from './center-container.component';

describe('CenterContainerComponent', () => {
  let component: CenterContainerComponent;
  let fixture: ComponentFixture<CenterContainerComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [CenterContainerComponent]
    });
    fixture = TestBed.createComponent(CenterContainerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
