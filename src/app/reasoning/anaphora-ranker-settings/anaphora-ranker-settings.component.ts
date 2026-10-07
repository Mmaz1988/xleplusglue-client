import { Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { anaphoraRankerSelection } from '../../analysis-model';
import { ANAPHORA_AVERAGERS, ANAPHORA_RANKERS, AnaphoraAverager, AnaphoraRankerId, AnaphoraRankerSelection } from '../../models/models';

interface RankerRow {
  id: AnaphoraRankerId;
  selected: boolean;
}

export const ANAPHORA_RANKER_LABELS: Record<AnaphoraRankerId, string> = {
  'mlm-pronoun-product': 'MLM + pronoun product',
  'mlm-substitution': 'MLM substitution',
  'mlm-pronoun': 'MLM pronoun form',
  'mlm-slot': 'MLM masked slot',
  'cosine-lexical': 'Cosine (lexical)',
  'cosine-description': 'Cosine (description)',
  'recency': 'Recency',
};

export const ANAPHORA_AVERAGER_LABELS: Record<AnaphoraAverager, string> = {
  borda: 'Borda count',
  rrf: 'Reciprocal rank fusion',
  weighted: 'Weighted mean',
};

/** Which anaphora rankers run, in which priority (drag and drop), and the averager fusing them.
 *  Holds no preferences of its own: the host passes the current selection in and stores what
 *  comes out of `selectionChange`. Every row is a ranker; selected ones come first, in priority
 *  order. At least one ranker stays selected. */
@Component({
  selector: 'app-anaphora-ranker-settings',
  templateUrl: './anaphora-ranker-settings.component.html',
  styleUrls: ['./anaphora-ranker-settings.component.css'],
})
export class AnaphoraRankerSettingsComponent implements OnChanges {
  @Input() rankers: string[] | undefined;
  @Input() averager: string | undefined;
  @Output() selectionChange = new EventEmitter<AnaphoraRankerSelection>();

  readonly averagers = ANAPHORA_AVERAGERS;
  readonly rankerLabels = ANAPHORA_RANKER_LABELS;
  readonly averagerLabels = ANAPHORA_AVERAGER_LABELS;
  rows: RankerRow[] = [];
  selectedAverager: AnaphoraAverager = 'borda';

  constructor() {
    this.ngOnChanges();
  }

  ngOnChanges(): void {
    const selection = anaphoraRankerSelection({ anaphora_rankers: this.rankers, anaphora_averager: this.averager });
    this.rows = [
      ...selection.rankers.map(id => ({ id, selected: true })),
      ...ANAPHORA_RANKERS.filter(id => !selection.rankers.includes(id)).map(id => ({ id, selected: false })),
    ];
    this.selectedAverager = selection.averager;
  }

  get selectedCount(): number {
    return this.rows.filter(row => row.selected).length;
  }

  /** What the order does for the chosen averager. */
  get orderHint(): string {
    if (this.selectedCount < 2) return 'One ranker: its own scores and ranks.';
    return this.selectedAverager === 'weighted'
      ? 'Order sets the weights (first counts most) and breaks ties.'
      : 'Order breaks ties: the first ranker decides between equal combined scores.';
  }

  drop(event: CdkDragDrop<RankerRow[]>): void {
    if (event.previousIndex === event.currentIndex) return;
    moveItemInArray(this.rows, event.previousIndex, event.currentIndex);
    this.emit();
  }

  toggle(row: RankerRow): void {
    if (row.selected && this.selectedCount === 1) return;
    row.selected = !row.selected;
    this.emit();
  }

  setAverager(value: string): void {
    this.selectedAverager = value as AnaphoraAverager;
    this.emit();
  }

  private emit(): void {
    // Selected rankers keep the order they are shown in; unselected ones sink below them.
    this.rows = [...this.rows.filter(row => row.selected), ...this.rows.filter(row => !row.selected)];
    this.selectionChange.emit({
      rankers: this.rows.filter(row => row.selected).map(row => row.id),
      averager: this.selectedAverager,
    });
  }
}
