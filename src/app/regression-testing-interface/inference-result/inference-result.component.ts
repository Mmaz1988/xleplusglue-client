import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

type Label = '1' | '0' | '-1';

@Component({
  selector: 'app-inference-result',
  templateUrl: './inference-result.component.html',
  styleUrls: ['./inference-result.component.css'],
})
export class InferenceResultComponent implements OnChanges {
  @Input() data: any;
  @Input() displayIndex: number | null = null;

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

  get mismatch(): boolean {
    return this.normLabel(this.predictedLabel) !== this.normLabel(this.goldLabel);
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
