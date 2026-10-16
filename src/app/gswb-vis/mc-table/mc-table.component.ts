import { Component, Input, OnChanges, SimpleChanges, ViewEncapsulation } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import katex from 'katex';
import { LigerStructure } from '../../models/models';
import { formulaToLatex } from './formula-latex';
import { resolveAllGlueNodes } from './resource-resolver';

export const RESOURCE_TOKEN = /g(\d+)_([a-z])/g;
const LINE_REGEX = /^(?:\[(\d+)\]\s+)?(.*) : ([\w^().\s-]+?)(?:\s\|\|\s([\w, ]+))?$/;

interface McRow {
  index: string | null;
  meaning: string;
  formula: string;
  params: string | null;
  resourceTokens: string[];
  formulaHtml: SafeHtml;
  editingFormula: boolean;
  editDraft: string;
  editingMeaning: boolean;
  meaningEditDraft: string;
}

interface McBlock {
  rows: McRow[];
}

@Component({
  selector: 'app-mc-table',
  templateUrl: './mc-table.component.html',
  styleUrls: [
    '../../../../node_modules/katex/dist/katex.min.css',
    './mc-table.component.css'
  ],
  encapsulation: ViewEncapsulation.None
})
export class McTableComponent implements OnChanges {
  @Input() content = '';
  @Input() structureJson: LigerStructure | null = null;

  blocks: McBlock[] = [];
  resolved = new Map<string, string>();

  constructor(private sanitizer: DomSanitizer) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['structureJson']) {
      this.resolved.clear();
    }

    this.blocks = this.parseBlocks(this.content);
    this.resolveResources();
  }

  private parseBlocks(content: string): McBlock[] {
    const lines = (content ?? '').split('\n');
    const blocks: McBlock[] = [];
    let current: McBlock | null = null;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }
      if (line === '{') {
        current = { rows: [] };
        blocks.push(current);
        continue;
      }
      if (line === '}' || line.startsWith('//')) {
        continue;
      }

      const row = this.parseLine(line);
      if (!row) {
        continue;
      }
      if (!current) {
        current = { rows: [] };
        blocks.push(current);
      }
      current.rows.push(row);
    }

    return blocks;
  }

  private parseLine(line: string): McRow | null {
    const match = LINE_REGEX.exec(line);
    if (!match) {
      return null;
    }

    const [, index, meaning, formula, params] = match;
    const trimmedFormula = formula.trim();

    return {
      index: index ?? null,
      meaning: meaning.trim(),
      formula: trimmedFormula,
      params: params ?? null,
      resourceTokens: this.extractResourceTokens(trimmedFormula),
      formulaHtml: this.renderFormulaHtml(trimmedFormula),
      editingFormula: false,
      editDraft: trimmedFormula,
      editingMeaning: false,
      meaningEditDraft: meaning.trim()
    };
  }

  private extractResourceTokens(formula: string): string[] {
    return Array.from(new Set(
      Array.from(formula.matchAll(RESOURCE_TOKEN)).map(m => `${m[1]}_${m[2]}`)
    ));
  }

  private renderFormulaHtml(formula: string): SafeHtml {
    const html = katex.renderToString(formulaToLatex(formula), {
      throwOnError: false,
      displayMode: false
    });
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  startEdit(row: McRow): void {
    row.editDraft = row.formula;
    row.editingFormula = true;
  }

  commitEdit(row: McRow): void {
    const next = row.editDraft.trim();
    row.formula = next;
    row.resourceTokens = this.extractResourceTokens(next);
    row.formulaHtml = this.renderFormulaHtml(next);
    row.editingFormula = false;
  }

  // Escape removes the <input> from the DOM, which can itself trigger a native blur
  // on the element being torn down — resetting editDraft first makes any stray
  // commitEdit that fires afterward a no-op instead of undoing the cancellation.
  cancelEdit(row: McRow): void {
    row.editDraft = row.formula;
    row.editingFormula = false;
  }

  onFormulaKeydown(event: KeyboardEvent, row: McRow): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.commitEdit(row);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.cancelEdit(row);
    }
  }

  startEditMeaning(row: McRow): void {
    row.meaningEditDraft = row.meaning;
    row.editingMeaning = true;
  }

  commitEditMeaning(row: McRow): void {
    row.meaning = row.meaningEditDraft.trim();
    row.editingMeaning = false;
  }

  cancelEditMeaning(row: McRow): void {
    row.meaningEditDraft = row.meaning;
    row.editingMeaning = false;
  }

  onMeaningKeydown(event: KeyboardEvent, row: McRow): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.commitEditMeaning(row);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.cancelEditMeaning(row);
    }
  }

  private resolveResources(): void {
    const labels = resolveAllGlueNodes(this.structureJson);
    for (const [id, text] of labels) {
      this.resolved.set(id, text);
    }
  }

  resourceLabel(token: string): string {
    const [id, type] = token.split('_');
    const text = this.resolved.get(id);
    const g = `g${id}_${type}`;
    return text ? `${g} → ${text}` : g;
  }
}
