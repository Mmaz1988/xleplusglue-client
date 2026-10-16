import { ComponentFixture, TestBed } from '@angular/core/testing';

import { GrammarLoaderComponent } from './grammar-loader.component';

describe('GrammarLoaderComponent', () => {
  let component: GrammarLoaderComponent;
  let fixture: ComponentFixture<GrammarLoaderComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [GrammarLoaderComponent]
    });
    fixture = TestBed.createComponent(GrammarLoaderComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
