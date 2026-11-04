import { AfterViewInit, Component, Input, OnChanges, SimpleChanges, ViewChild, ViewEncapsulation } from '@angular/core';
import { EditorComponent } from '../../editor/editor.component';
import { ProofReading } from '../../models/models';

/** The four discourse checks, in the order Vampire returns a reading's proof files
 *  (CHECK_ROLES in inference/vampire_call.py). */
export const PROOF_CHECKS = [
  { name: 'info_pos_check', label: 'info +' },
  { name: 'info_neg_check', label: 'info −' },
  { name: 'cons_pos_check', label: 'cons +' },
  { name: 'cons_neg_check', label: 'cons −' },
];

export interface ProofFileStatus {
  /** The SZS status from the file's run summary; 'not run' without one. */
  status: string;
  /** The Vampire mode that produced it: fmb, casc, or '' if the summary does not say. */
  mode: string;
  /** Drawn as the verdict glyph draws it: a model (▲), a refutation (▼), undecided (●). */
  tone: 'model' | 'refutation' | 'open';
}

const MODEL = ['Satisfiable', 'CounterSatisfiable'];
const REFUTATION = ['Theorem', 'Unsatisfiable', 'ContradictoryAxioms', 'Refutation'];

/** What a proof file's run summary block (vampire_call.append_result_summary) says. */
export function proofFileStatus(file: string | undefined): ProofFileStatus {
  const statuses = [...(file ?? '').matchAll(/^% SZS status: (.*)$/gm)];
  const status = statuses.length ? statuses[statuses.length - 1][1].trim() : 'not run';
  const command = /^% command: (.*)$/m.exec(file ?? '')?.[1] ?? '';
  const mode = /--mode casc/.test(command) ? 'casc' : /-sa fmb/.test(command) ? 'fmb' : '';
  const tone = MODEL.includes(status) ? 'model' : REFUTATION.includes(status) ? 'refutation' : 'open';
  return { status, mode, tone };
}

/** The .p files Vampire ran for each reading of an inference, one reading and one check at a
 *  time, in a read-only TPTP editor. Rendered by app-pill's `proof-files` variant, so it
 *  exists only while the pill is open. */
@Component({
  selector: 'app-proof-files',
  templateUrl: './proof-files.component.html',
  styleUrls: ['./proof-files.component.css'],
  encapsulation: ViewEncapsulation.None,
})
export class ProofFilesComponent implements OnChanges, AfterViewInit {
  @Input() readings: ProofReading[] = [];

  @ViewChild('editor') editor?: EditorComponent;

  readonly checks = PROOF_CHECKS;
  readingIndex = 0;
  checkIndex = 0;
  statuses: ProofFileStatus[] = [];

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['readings']) {
      this.readingIndex = Math.min(this.readingIndex, Math.max(0, this.readings.length - 1));
      this.show();
    }
  }

  ngAfterViewInit(): void {
    // The overlay is laid out after the editor was created; measure it again once it is.
    setTimeout(() => this.show(), 0);
  }

  get reading(): ProofReading | undefined {
    return this.readings[this.readingIndex];
  }

  get currentFile(): string {
    const file = this.reading?.files?.[this.checkIndex];
    return file ?? '% No proof file: this reading got no verdict from Vampire.';
  }

  step(delta: number): void {
    this.selectReading(this.readingIndex + delta);
  }

  selectReading(index: number): void {
    if (index < 0 || index >= this.readings.length) return;
    this.readingIndex = index;
    this.show();
  }

  selectCheck(index: number): void {
    this.checkIndex = index;
    this.show();
  }

  download(): void {
    const name = `${this.readingIndex + 1}-${this.checks[this.checkIndex].name}.p`;
    const url = URL.createObjectURL(new Blob([this.currentFile], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  }

  private show(): void {
    this.statuses = this.checks.map((_, index) => proofFileStatus(this.reading?.files?.[index]));
    this.editor?.updateContent(this.currentFile);
  }
}
