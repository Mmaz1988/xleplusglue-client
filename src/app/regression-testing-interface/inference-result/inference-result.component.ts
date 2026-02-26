import { Component, Input, OnInit } from '@angular/core';

type Label = '1' | '0' | '-1';

@Component({
  selector: 'app-inference-result',
  templateUrl: './inference-result.component.html',
  styleUrls: ['./inference-result.component.css'],
})
export class InferenceResultComponent implements OnInit {
  @Input() data: any;

  premises: string[] = [];
  conclusion: string = '';
  predictedLabel: string = '';
  goldLabel: string = '';

  ngOnInit(): void {
    if (!this.data) return;

    // Adjust these field names if your "element" uses different keys
    this.premises = this.data.premises ?? [];
    this.conclusion = this.data.conclusion ?? '';
    this.predictedLabel = String(this.data.predictedLabel ?? this.data.predicted ?? '');
    this.goldLabel = String(this.data.goldLabel ?? this.data.gold ?? '');
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
