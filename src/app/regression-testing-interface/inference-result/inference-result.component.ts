import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ProofReading } from '../../models/models';

type Label = '1' | '0' | '-1';

@Component({
  selector: 'app-inference-result',
  templateUrl: './inference-result.component.html',
  styleUrls: ['./inference-result.component.css'],
})
export class InferenceResultComponent implements OnChanges {
  @Input() data: any;
  @Input() displayIndex: number | null = null;
  /** Where this item stands. The report lists every NLI item, not only the ones with a
   *  verdict, so `data` is often a placeholder whose predicted label is empty -- and an
   *  empty label differs from the gold one, which would otherwise mark every unrun item as
   *  a mismatch. Anything but `done` means there is no prediction to compare. */
  @Input() status: 'unparsed' | 'pending' | 'running' | 'done' | 'failed' = 'done';
  /** Each reading's .p files as Vampire ran them, for the TPTP pill. */
  @Input() proofReadings: ProofReading[] = [];
  /** How many readings the item's next run would send, of how many; null before it has a
   *  discourse. More than one: the item is not disambiguated yet (tinted yellow, as a
   *  sentence with several selected parses is in the parsing report). */
  @Input() readingCount: { sent: number; total: number } | null = null;

  /** The item's sentences that still have more than one selected parse: tinted orange, ahead
   *  of the yellow reading tint, since those are disambiguated in the parsing report first. */
  @Input() ambiguousSentences: string[] = [];

  get sentencesAmbiguous(): boolean {
    return this.ambiguousSentences.length > 0;
  }

  get ambiguous(): boolean {
    return !this.sentencesAmbiguous && (this.readingCount?.sent ?? 0) > 1;
  }

  get readingCountTitle(): string | null {
    const count = this.readingCount;
    const parts: string[] = [];
    if (this.sentencesAmbiguous) {
      parts.push(`Sentences with several selected parses: ${this.ambiguousSentences.join(' / ')}`);
    }
    if (count) {
      parts.push(`The next run sends ${count.sent} of ${count.total} reading${count.total === 1 ? '' : 's'}`
        + (count.sent > 1 ? ': not disambiguated yet' : ''));
    }
    return parts.length ? parts.join('\n') : null;
  }

  premises: string[] = [];
  conclusion = '';
  predictedLabel = '';
  goldLabel = '';

  glyphs: string[] = [];
  safeGlyphs: SafeHtml[] = [];
  glyphGridSize = 1;

  constructor(private sanitizer: DomSanitizer) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['data']) {
      this.hydrateFromData();
    }
  }

  private hydrateFromData(): void {
    const d = this.data;
    if (!d) return;

    this.premises = d.premises ?? [];
    this.conclusion = d.conclusion ?? '';
    this.predictedLabel = String(d.predictedLabel ?? d.predicted ?? '');
    this.goldLabel = String(d.goldLabel ?? d.gold ?? '');

    const raw = d.glyphs ?? [];
    const glyphArr: string[] = Array.isArray(raw) ? raw : Object.values(raw);

    this.glyphs = glyphArr.filter((g): g is string => typeof g === 'string' && g.trim().length > 0);
    this.safeGlyphs = this.glyphs.map(g => this.sanitizer.bypassSecurityTrustHtml(g));
    this.glyphGridSize = Math.max(1, Math.ceil(Math.sqrt(this.glyphs.length)));
  }

  get hasPrediction(): boolean {
    return this.status === 'done' && this.predictedLabel.trim() !== '';
  }

  get mismatch(): boolean {
    if (!this.hasPrediction) return false;
    return this.normLabel(this.predictedLabel) !== this.normLabel(this.goldLabel);
  }

  /** What to show in place of a verdict. */
  get statusText(): string {
    switch (this.status) {
      case 'unparsed': return 'not fully parsed';
      case 'running': return 'running...';
      case 'failed': return 'no verdict';
      default: return 'not run yet';
    }
  }

  labelName(l: string): string {
    const n = this.normLabel(l);
    if (n === '1') return 'Entailment';
    if (n === '0') return 'Neutral';
    if (n === '-1') return 'Contradiction';
    return l;
  }

  labelClass(l: string): string {
    const n = this.normLabel(l);
    if (n === '1') return 'label-entailment';
    if (n === '0') return 'label-neutral';
    if (n === '-1') return 'label-contradiction';
    return 'label-unknown';
  }

  private normLabel(l: string): Label | 'unknown' {
    const s = String(l).trim();
    if (s === '1' || s === '0' || s === '-1') return s;
    return 'unknown';
  }
}
