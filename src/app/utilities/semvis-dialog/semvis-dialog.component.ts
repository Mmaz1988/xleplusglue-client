import {Component, ElementRef, EventEmitter, Output, ViewChild} from '@angular/core';
import {SemVisComponent} from "../../sem-vis/sem-vis.component";
import { AnaphoraRankingTable } from "../../analysis-model";
import { ReadingOrderContext, ReadingSelection } from "../../reading-order";

@Component({
  selector: 'app-semvis-dialog',
  templateUrl: './semvis-dialog.component.html',
  styleUrls: ['./semvis-dialog.component.css']
})
export class SemvisDialogComponent {
  @ViewChild('dialog', { static: true }) dialog!: ElementRef<HTMLDialogElement>;
  @ViewChild('semVis') semVis?: SemVisComponent;

  @Output() selectionChange = new EventEmitter<{
    sentenceId: string;
    items: any[];
    selectedScopeIds: string[];
    selectedMcIds: string[];
  }>();

  /** A changed discourse selection (N4 6d), null for the default; the owner stores it and
   *  passes it back (`setReadingSelection`). */
  @Output() readingSelectionChange = new EventEmitter<{ sentenceId: string; selection: ReadingSelection | null }>();

  private activeSentenceId: string | null = null;
  title = 'Solutions';
  /** A second header line, e.g. the sentence the solutions belong to. */
  subtitle = '';
  /** Ids the items are always narrowed to (the discriminant selection); null: no narrowing.
   *  The counter's total still counts every item, as for a sentence's discriminants. */
  narrowIds: string[] | null = null;

  open(payload: {
    sentenceId: string;
    items: any[];
    discriminants?: any[];
    startIndex?: number;
    meaningConstructors?: any;
    selectedScopeIds?: string[];
    selectedMcIds?: string[];
    svgSolutions?: boolean;
    /** Caption per item, index-aligned with `items`. */
    itemLabels?: string[];
    /** Ranking table per item, index-aligned with `items`. */
    itemRankings?: (AnaphoraRankingTable | null)[];
    title?: string;
    subtitle?: string;
    /** When given, only these items are shown, whatever the checkbox says. */
    narrowTo?: string[];
    /** Offers the sem-vis's Collapse for LFGxDRT items with presuppositions or anaphora. */
    collapsible?: boolean;
    /** The discourse the items are PCDRS readings of, for the reading order and filters. */
    readingOrder?: ReadingOrderContext;
    /** The discourse's reading selection, which the view applies and edits. */
    readingSelection?: { selection: ReadingSelection; own: boolean };
    /** The readings the last run sent to Vampire, marked while the selection keeps others. */
    sentByLastRun?: string[];
  }): void {
    this.activeSentenceId = payload.sentenceId;
    this.title = payload.title ?? 'Solutions';
    this.subtitle = payload.subtitle ?? '';
    this.narrowIds = payload.narrowTo ? [...payload.narrowTo] : null;
    this.dialog.nativeElement.show();

    const items = Array.isArray(payload.items) ? payload.items : [];
    const discriminants = Array.isArray(payload.discriminants) ? payload.discriminants : [];
    const startIndex = Number.isFinite(payload.startIndex) ? payload.startIndex! : 0;

    const mc = payload.meaningConstructors;
    const meaningConstructors =
      typeof mc === 'string' ? mc :
        Array.isArray(mc) ? mc.join('\n') :
          '';

    const scopeIds = payload.selectedScopeIds ?? [];
    const mcIds = payload.selectedMcIds ?? [];
    const svgSolutions = Boolean(payload.svgSolutions);

    setTimeout(() => {
      if (!this.semVis) return;

      // set discriminants + items first so filtering has a universe.
      // Unconditional: an empty array is the correct instruction, not a no-op. Guarding
      // on `.length` meant a sentence with NO discriminants never cleared the previous
      // sentence's, so opening an ambiguous sentence and then an unambiguous one showed
      // the first one's scope discriminants against the second one's solutions -- present
      // but unselectable, since they name scope constraints that do not occur there.
      // Verified live: GSWB returns zero discriminants for those sentences, batch or
      // alone, so the bleed was entirely here. gswb-vis already calls setDiscriminants([]).
        // Always set: a dialog of semantic readings must not keep the previous discourse's.
        this.semVis.readingOrder = payload.readingOrder ?? null;
        // Through null, so a reused view starts from this discourse's selection.
        this.semVis.readingSelection = null;
        this.semVis.readingSelection = payload.readingSelection ?? null;
        this.semVis.sentByLastRun = payload.sentByLastRun ?? null;
        this.semVis.setDiscriminants(discriminants);
        this.semVis.meaningConstructors = meaningConstructors;
        this.semVis.svgSolutions = svgSolutions;
        this.semVis.collapsible = Boolean(payload.collapsible);
        this.semVis.itemLabels = payload.itemLabels ?? [];
        this.semVis.itemRankings = payload.itemRankings ?? [];
        this.semVis.setItems(items, startIndex);

      // restore selection and re-filter
      this.semVis.setItemFilter(this.narrowIds);
      this.semVis.setSelectedDiscriminants(scopeIds, mcIds);
    }, 0);
  }

  onSemVisSelection(ev: any) {
    if (!this.activeSentenceId) return;

    this.selectionChange.emit({
      sentenceId: this.activeSentenceId,  // ✅ key the event
      ...ev
    });
  }

  onReadingSelectionChange(selection: ReadingSelection | null): void {
    if (this.activeSentenceId) this.readingSelectionChange.emit({ sentenceId: this.activeSentenceId, selection });
  }

  /** The selection as the owner stored it. */
  setReadingSelection(value: { selection: ReadingSelection; own: boolean }): void {
    if (this.semVis) this.semVis.readingSelection = value;
  }

  close(): void {
    this.dialog.nativeElement.close();
  }

}
