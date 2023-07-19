import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RegressionTestingInterfaceComponent } from './regression-testing-interface.component';

describe('RegressionTestingInterfaceComponent', () => {
  let component: RegressionTestingInterfaceComponent;
  let fixture: ComponentFixture<RegressionTestingInterfaceComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [RegressionTestingInterfaceComponent]
    });
    fixture = TestBed.createComponent(RegressionTestingInterfaceComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
