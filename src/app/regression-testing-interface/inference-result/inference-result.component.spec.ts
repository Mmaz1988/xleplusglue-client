import { ComponentFixture, TestBed } from '@angular/core/testing';

import { InferenceResultComponent } from './inference-result.component';

describe('InferenceResultComponent', () => {
  let component: InferenceResultComponent;
  let fixture: ComponentFixture<InferenceResultComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [InferenceResultComponent]
    });
    fixture = TestBed.createComponent(InferenceResultComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('is tinted yellow while the next run would send more than one reading', () => {
    const block = () => fixture.nativeElement.querySelector('.inf-block') as HTMLElement;
    component.readingCount = { sent: 3, total: 40 };
    fixture.detectChanges();
    expect(block().classList).toContain('ambiguous-block');
    expect(block().title).toContain('3 of 40');

    component.readingCount = { sent: 1, total: 40 };
    fixture.detectChanges();
    expect(block().classList).not.toContain('ambiguous-block');

    component.readingCount = null;
    fixture.detectChanges();
    expect(block().classList).not.toContain('ambiguous-block');
    expect(block().hasAttribute('title')).toBeFalse();
  });
});
