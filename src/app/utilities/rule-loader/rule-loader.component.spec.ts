import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RuleLoaderComponent } from './rule-loader.component';

describe('RuleLoaderComponent', () => {
  let component: RuleLoaderComponent;
  let fixture: ComponentFixture<RuleLoaderComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [RuleLoaderComponent]
    });
    fixture = TestBed.createComponent(RuleLoaderComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
