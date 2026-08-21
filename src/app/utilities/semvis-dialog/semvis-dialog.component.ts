import {Component, ElementRef, EventEmitter, Output, ViewChild} from '@angular/core';
import {SemVisComponent} from "../../sem-vis/sem-vis.component";

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

  private activeSentenceId: string | null = null;

  open(payload: {
    sentenceId: string;
    items: any[];
    discriminants?: any[];
    startIndex?: number;
    meaningConstructors?: any;
    selectedScopeIds?: string[];
    selectedMcIds?: string[];
    svgSolutions?: boolean;
  }): void {
    this.activeSentenceId = payload.sentenceId;
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
        this.semVis.setDiscriminants(discriminants);
        this.semVis.meaningConstructors = meaningConstructors;
        this.semVis.svgSolutions = svgSolutions;
        this.semVis.setItems(items, startIndex);

      // restore selection and re-filter
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

  close(): void {
    this.dialog.nativeElement.close();
  }

}
