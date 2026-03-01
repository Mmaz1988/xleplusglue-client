import {Component, ViewChild, ElementRef, Output, EventEmitter} from '@angular/core';
import { GswbGraphVisComponent } from "../gswb-vis/gswb-graph-vis/gswb-graph-vis.component";
import { EditorComponent } from "../editor/editor.component";
import { SemVisComponent } from "../sem-vis/sem-vis.component"; // <-- adjust path

type DialogContent =
  | string
  | { kind: 'graph', graph: any }
  | { kind: 'semvis', items: any[], discriminants?: any[], startIndex?: number };

@Component({
  selector: 'app-dialog',
  templateUrl: './dialog.component.html',
  styleUrls: ['./dialog.component.css']
})
export class DialogComponent {
  @ViewChild('dialog') dialog!: ElementRef<HTMLDialogElement>;

  @ViewChild('graphVis') graphVis?: GswbGraphVisComponent;
  @ViewChild('editorVis') editorVis?: EditorComponent;
  @ViewChild('semVis') semVis?: SemVisComponent;

  @Output() semvisSelectionChange = new EventEmitter<{
    items: any[];
    selectedScopeIds: string[];
    selectedMcIds: string[];
  }>();

  showEdit = false;
  showGraph = false;
  showSemVis = false;

  private lastContent: any = null;

  ngAfterViewInit(): void {
    // keep defaults as-is
  }

  private resetViews(): void {
    this.showEdit = false;
    this.showGraph = false;
    this.showSemVis = false;
  }

  setContent(content: DialogContent | any) {
    console.log("Content of dialog window:", content);
    this.lastContent = content;
    // 1) String => editor
    if (typeof content === 'string' || content instanceof String) {
      this.resetViews();
      this.showEdit = true;

      const text = content.toString();
      setTimeout(() => {
        if (this.editorVis) this.editorVis.updateContent(text);
        else console.warn('Editor component not initialized yet');
      }, 0);

      return;
    }

    // 2) Explicit "kind" routing
    if (content?.kind === 'semvis') {
      this.resetViews();
      this.showSemVis = true;

      const items = Array.isArray(content.items) ? content.items : [];
      const discriminants = Array.isArray(content.discriminants) ? content.discriminants : [];
      const startIndex = Number.isFinite(content.startIndex) ? content.startIndex : 0;

      setTimeout(() => {
        if (!this.semVis) {
          console.warn('SemVis component not initialized yet');
          return;
        }
        // Order doesn’t matter much, but discriminants first can help if you rely on initial filtering
        if (discriminants.length) this.semVis.setDiscriminants(discriminants);
        this.semVis.setItems(items, startIndex);
      }, 0);

      return;
    }

    if (content?.kind === 'graph') {
      this.resetViews();
      this.showGraph = true;

      setTimeout(() => {
        if (this.graphVis) this.graphVis.renderGraph(content.graph);
        else console.warn('Graph component not initialized yet');
      }, 0);

      return;
    }

    // 3) Backward-compatible fallback:
    // If it’s not a string and doesn’t declare kind, treat it as a graph payload (your previous behavior).
    this.resetViews();
    this.showGraph = true;

    setTimeout(() => {
      if (this.graphVis) this.graphVis.renderGraph(content);
      else console.warn('Graph component not initialized yet');
    }, 0);
  }

  showDialog() {
    if (this.lastContent !== null) {
      // ensures flags + child renders are correct at open time
      this.setContent(this.lastContent);
    }
    this.dialog.nativeElement.show();
  }

  onSemVisSelection(ev: { items: any[]; selectedScopeIds: string[]; selectedMcIds: string[] }) {
    this.semvisSelectionChange.emit(ev);
  }
}
