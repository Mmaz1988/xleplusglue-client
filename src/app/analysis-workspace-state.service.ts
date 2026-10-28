import { Injectable } from '@angular/core';
import { skip } from 'rxjs';
import { SyntaxSourceService } from './syntax-source/syntax-source.service';

export interface LigerWorkspaceState {
  sentence: string;
  sequenceSentences?: string[];
  sequenceSentenceIds?: string[];
  grammarLoadedPath: string;
  grammarSelectedPath: string;
  structureJson: any;
  graphElements: any[];
  solutions: any[];
  selectedSolutionIndex: number;
  meaningConstructors: string;
}

export interface GswbWorkspaceState {
  meaningConstructors: string;
  editorText: string;
  logText: string;
  gswbPreferences: any;
  semvis: any;
}

export interface AnalysisWorkspaceState {
  liger: LigerWorkspaceState | null;
  gswb: GswbWorkspaceState | null;
}

@Injectable({
  providedIn: 'root'
})
export class AnalysisWorkspaceStateService {
  private state: AnalysisWorkspaceState = {
    liger: null,
    gswb: null,
  };

  /** The saved analysis was parsed with one parser: another one starts afresh. */
  constructor(syntaxSource: SyntaxSourceService) {
    syntaxSource.kind$.pipe(skip(1)).subscribe(() => this.clear());
  }

  saveLiger(state: LigerWorkspaceState): void {
    this.state = {
      ...this.state,
      liger: this.clone(state),
    };
  }

  saveGswb(state: GswbWorkspaceState): void {
    this.state = {
      ...this.state,
      gswb: this.clone(state),
    };
  }

  getState(): AnalysisWorkspaceState {
    return this.clone(this.state);
  }

  clear(): void {
    this.state = {
      liger: null,
      gswb: null,
    };
  }

  private clone<T>(value: T): T {
    if (value === null || value === undefined) {
      return value;
    }

    if (typeof structuredClone === 'function') {
      return structuredClone(value);
    }

    return JSON.parse(JSON.stringify(value));
  }
}
