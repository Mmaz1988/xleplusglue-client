import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { AnaphoraRankerSelection } from '../../models/models';
import { AnaphoraRankerSettingsComponent } from './anaphora-ranker-settings.component';

describe('AnaphoraRankerSettingsComponent', () => {
  let fixture: ComponentFixture<AnaphoraRankerSettingsComponent>;
  let component: AnaphoraRankerSettingsComponent;
  let emitted: AnaphoraRankerSelection[];

  const element = (): HTMLElement => fixture.nativeElement;
  const shownOrder = () => Array.from(element().querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
    .map(box => `${box.dataset['ranker']}${box.checked ? '*' : ''}`);
  const checkbox = (ranker: string) =>
    element().querySelector<HTMLInputElement>(`input[data-ranker="${ranker}"]`)!;
  const averagerSelect = () => element().querySelector<HTMLSelectElement>('select')!;

  /** The host's part: store what comes out, pass it back in. */
  const setInputs = (rankers: string[] | undefined, averager: string | undefined) => {
    fixture.componentRef.setInput('rankers', rankers);
    fixture.componentRef.setInput('averager', averager);
    fixture.detectChanges();
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [DragDropModule],
      declarations: [AnaphoraRankerSettingsComponent],
    });
    fixture = TestBed.createComponent(AnaphoraRankerSettingsComponent);
    component = fixture.componentInstance;
    emitted = [];
    component.selectionChange.subscribe(selection => {
      emitted.push(selection);
      setInputs(selection.rankers, selection.averager);
    });
    setInputs(['mlm-substitution'], 'borda');
  });

  it('lists the selected rankers first, in priority order, then the rest', () => {
    setInputs(['recency', 'mlm-substitution'], 'rrf');
    expect(shownOrder()).toEqual(['recency*', 'mlm-substitution*', 'mlm-slot', 'cosine-lexical', 'cosine-description']);
    expect(averagerSelect().value).toBe('rrf');
  });

  it('defaults sessions saved without rankers to the default selection', () => {
    setInputs(undefined, undefined);
    expect(shownOrder()[0]).toBe('mlm-substitution*');
    expect(averagerSelect().value).toBe('borda');
  });

  it('disables the averager while only one ranker is selected, and keeps that one selected', () => {
    expect(averagerSelect().disabled).toBeTrue();
    expect(element().textContent).toContain('select two or more rankers');
    expect(checkbox('mlm-substitution').disabled).toBeTrue();

    checkbox('recency').click();
    fixture.detectChanges();
    expect(emitted.at(-1)).toEqual({ rankers: ['mlm-substitution', 'recency'], averager: 'borda' });
    expect(averagerSelect().disabled).toBeFalse();
    expect(checkbox('mlm-substitution').disabled).toBeFalse();
  });

  it('toggling a ranker off drops it from the priority order', () => {
    setInputs(['mlm-substitution', 'recency', 'cosine-lexical'], 'borda');
    checkbox('recency').click();
    fixture.detectChanges();
    expect(emitted.at(-1)!.rankers).toEqual(['mlm-substitution', 'cosine-lexical']);
    expect(shownOrder()).toEqual(['mlm-substitution*', 'cosine-lexical*', 'mlm-slot', 'cosine-description', 'recency']);
  });

  it('reorders by drag and drop, emitting the new priority order', () => {
    setInputs(['mlm-substitution', 'recency'], 'borda');
    component.drop({ previousIndex: 1, currentIndex: 0 } as any);
    fixture.detectChanges();
    expect(emitted.at(-1)).toEqual({ rankers: ['recency', 'mlm-substitution'], averager: 'borda' });
    expect(shownOrder().slice(0, 2)).toEqual(['recency*', 'mlm-substitution*']);
  });

  it('dragging an unselected ranker above a selected one does not select it', () => {
    setInputs(['mlm-substitution', 'recency'], 'borda');
    component.drop({ previousIndex: 3, currentIndex: 0 } as any);
    fixture.detectChanges();
    expect(emitted.at(-1)!.rankers).toEqual(['mlm-substitution', 'recency']);
  });

  it('changes the averager and says what the order does for it', () => {
    setInputs(['mlm-substitution', 'recency'], 'borda');
    expect(element().textContent).toContain('Order breaks ties');
    averagerSelect().value = 'weighted';
    averagerSelect().dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(emitted.at(-1)).toEqual({ rankers: ['mlm-substitution', 'recency'], averager: 'weighted' });
    expect(element().textContent).toContain('Order sets the weights');
  });
});
