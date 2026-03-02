import { Component, Input, OnInit } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

type Label = '1' | '0' | '-1';

@Component({
  selector: 'app-inference-result',
  templateUrl: './inference-result.component.html',
  styleUrls: ['./inference-result.component.css'],
})
export class InferenceResultComponent implements OnInit {
  @Input() data: any;

  premises: string[] = [];
  conclusion = '';
  predictedLabel = '';
  goldLabel = '';

  glyphs: string[] = [];
  safeGlyphs: SafeHtml[] = [];
  glyphGridSize = 1;

  constructor(private sanitizer: DomSanitizer) {}

  ngOnInit(): void {
    if (!this.data) return;

    this.premises = this.data.premises ?? [];
    this.conclusion = this.data.conclusion ?? '';
    this.predictedLabel = String(this.data.predictedLabel ?? this.data.predicted ?? '');
    this.goldLabel = String(this.data.goldLabel ?? this.data.gold ?? '');

    const raw = this.data.glyphs ?? [];
    const glyphArr: string[] = Array.isArray(raw) ? raw : Object.values(raw);

    this.glyphs = glyphArr.filter((g): g is string => typeof g === 'string' && g.trim().length > 0);

    // cache sanitized glyphs once
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
