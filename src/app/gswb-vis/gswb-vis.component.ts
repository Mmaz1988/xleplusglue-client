import {Component, ElementRef, ViewChild, AfterViewInit, Input, Output, EventEmitter} from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { LogComponent } from './log/log.component';
import { EditorComponent } from '../editor/editor.component';
import { DataService } from '../data.service';
import {DerivationContainerComponent} from "./derivation-container/derivation-container.component";
import {DialogComponent} from "../utilities/dialog/dialog.component";
import {GswbDiscriminant, GswbProofInput, GswbRequest,GswbPreferences, GswbSemanticMergePart, GswbSolution, LigerStructure, SemanticAnalysis, SentenceAnalysis, SequenceAnalysis} from "../models/models";
import {GswbSettingsComponent} from "./gswb-settings/gswb-settings.component";
import {SemVisComponent} from "../sem-vis/sem-vis.component";
import { GswbWorkspaceState } from "../analysis-workspace-state.service";
import { APP_DEFAULTS } from "../app-defaults";
import { selectedSentenceSemantics } from '../analysis-model';
import { catchError, forkJoin, map, of, switchMap } from 'rxjs';


@Component({
  selector: 'app-gswb-vis',
  templateUrl: './gswb-vis.component.html',
  styleUrls: ['./gswb-vis.component.css']
})


export class GswbVisComponent implements AfterViewInit {
  @Input() structureJson: LigerStructure | null = null;
  @Input() canPostProcess = false;
  @Input() postProcessingLoading = false;
  @Input() previousSentenceAnalyses: SentenceAnalysis[] = [];
  @Input() previousSequenceAnalyses: SequenceAnalysis[] = [];
  @Output() postProcessing = new EventEmitter<'inline' | 'standalone'>();
  @Output() sentenceAnalysisChange = new EventEmitter<SentenceAnalysis[]>();
  @Output() sequenceAnalysisChange = new EventEmitter<SequenceAnalysis[]>();

  @ViewChild('edit1') editor1: EditorComponent;
  @ViewChild('derivation') derivationContainer: DerivationContainerComponent;
  @ViewChild('sem1') sem: EditorComponent;
  @ViewChild('semvis') semvis: SemVisComponent;
  @ViewChild('log1') log: EditorComponent;
  @ViewChild('dialog') dialog: DialogComponent;
  @ViewChild('gswbPrefs') gswbPreferences : GswbSettingsComponent;
  @ViewChild('errorhandle') errorhandle: ElementRef;
  meaningConstructors = '';
  proofInputs: GswbProofInput[] = [];
  selectedProofInputIndex = 0;
  private allSemanticSolutions: GswbSolution[] = [];
  private semanticDiscriminants: GswbDiscriminant[] = [];
  private selectedSemanticIds: string[] = [];
  private selectedScopeIds: string[] = [];
  private selectedMcIds: string[] = [];
  private loadingSemanticState = false;
  private updatingMergedSolutions = false;
  private hasSemanticSolutions = false;
  semanticSolutionReady = false;
  postProcessingMode: 'inline' | 'standalone' = 'inline';

  private pendingState: GswbWorkspaceState | null = null;

  ngAfterViewInit() {
    if (this.gswbPreferences) {
      this.gswbPreferences.gswbPreferences = { ...APP_DEFAULTS.gswb.preferences };
      this.gswbPreferences.updateFormFromPreferences(this.gswbPreferences.gswbPreferences)
    } else {
      console.error("ERROR: `gswbPreferences` ViewChild not initialized!");
    }

    this.applyPendingState();
  }



  constructor(private dataService: DataService) {

  }
  loading: boolean = false;

  calculateSemantics(){
    this.loading = true;
    this.hasSemanticSolutions = false;
    this.semanticSolutionReady = false;

    this.updateMeaningConstructors();

    this.gswbPreferences.onSubmit();

    const gswbRequest: GswbRequest = {
      premises: this.editor1.getContent(),
      gswbPreferences: this.gswbPreferences.gswbPreferences,
      structure: this.structureJson ?? undefined
      , proofs: this.proofInputs.length ? this.proofInputs : undefined
    }

    this.displayMessage("[" +  new Date().toLocaleTimeString() + "] Sending request to GSWB ...", "blue");
    console.info('[GSWB] deduction started', {
      proofCount: gswbRequest.proofs?.length ?? 0,
      proofIds: (gswbRequest.proofs ?? []).map(proof => proof.proofId),
      premisesLength: gswbRequest.premises.length,
      hasStructure: !!gswbRequest.structure,
    });
    this.dataService.gswbDeduce(gswbRequest).subscribe(
      data => {
        this.loading = false;
        console.info('[GSWB] deduction succeeded', {
          solutionCount: data.solutions?.length ?? 0,
          discriminantCount: data.discriminants?.length ?? 0,
        });
        // Handle the data here...
        // Depending on the structure of the data you might need to modify the below code.
         if (data.hasOwnProperty('solutions')) {
          // log each element in data.solutions individually


          //Check if data.solutions is not null and not empty
           if (data.solutions.some(solution =>
             typeof solution?.solution === 'string' && solution.solution.trim().length > 0)) {
              this.allSemanticSolutions = [...data.solutions];
              this.semanticDiscriminants = [...(data.discriminants ?? [])];
              this.selectedSemanticIds = this.allSemanticSolutions.map(solution => solution.id);
              this.selectedScopeIds = [];
              this.selectedMcIds = [];
              this.hasSemanticSolutions = true;
              // For a sequence, the raw current-sentence readings are not
              // ready for the next append until their sequence merge finishes.
              this.semanticSolutionReady = this.previousSentenceAnalyses.length === 0
                && this.previousSequenceAnalyses.length === 0;
            this.loadingSemanticState = true;
            this.semvis.clearMc();
            this.semvis.clearScope();
            this.semvis.applyFiltersAndResetIndex();
            this.semvis.setItems(data.solutions);
            this.semvis.setDiscriminants(data.discriminants);
            this.loadingSemanticState = false;
             this.mergeCurrentSolutions(data.solutions);
          } else {
            //create error message with request time stamp
            //create gswb solution with no solutions found and create list to treat as semvis
            this.semvis.setItems([{solution: "[" +  new Date().toLocaleTimeString() + "] No solutions found.", id: "S0"}]);
          }
        } else {
          this.semvis.setItems([{solution: "[" +  new Date().toLocaleTimeString() + "] No solutions found.", id: "S0"}]);
        }

        if (data.hasOwnProperty('log'))
        {
          this.log.updateContent(data.log)
        }

        if (data.hasOwnProperty('derivation') && this.gswbPreferences.gswbPreferences.explainFail) {

          //check if derivation is a string or an object


     if (data.derivation.hasOwnProperty('graphElements'))
          {
            this.derivationContainer.showEditor = false;
            this.derivationContainer.showGraph = true;
            const graphElements = data.derivation.graphElements;
            // Using setTimeout to enqueue the function call after the current execution context
            setTimeout(() => {
              this.derivationContainer.graphVisUpdateContent(graphElements);
            }, 0);

            //this.dialog.setContent(graphElements)
            this.dialog.setContent({ kind: 'graph', graph: graphElements });

          } else
          {
            this.derivationContainer.showGraph = false;
            this.derivationContainer.showEditor = true;
            // Using setTimeout to enqueue the function call after the current execution context
            setTimeout(() => {
              this.derivationContainer.editorVisUpdateContent(data.derivation.toString());
            }, 0);
            this.dialog.setContent(data.derivation.toString());
          }
                  // Update your component's property bound to your logContainerElement here...

        }
        this.displayMessage("GSWB deduction completed.", "green");
      },
      error => {
        console.warn('[GSWB] deduction failed', error);
        this.loading = false;
        // this.sem.updateContent("[" +  new Date().toLocaleTimeString() + "] An error occurred.");
        this.displayMessage( "An error occurred during GSWB deduction.", "red");
      }
    );

    // Now, you can send 'editorContent' to your backend.
    // Use your preferred method to send data to backend (for instance, HttpClient).
  }

  requestPostProcessing(mode: 'inline' | 'standalone'): void {
    this.postProcessing.emit(mode);
  }

  displayMessage(message: string, color: string) {
    this.errorhandle.nativeElement.style.color = color;
    this.errorhandle.nativeElement.innerHTML = "[" + new Date().toLocaleTimeString() + "] " + message;
  }


  updateMeaningConstructors() {
    this.meaningConstructors = this.editor1?.getContent() ?? '';
  }

  setProofInputs(proofInputs: GswbProofInput[]): void {
    this.proofInputs = Array.isArray(proofInputs)
      ? proofInputs.map(input => ({ ...input }))
      : [];
    this.selectedProofInputIndex = Math.min(
      this.selectedProofInputIndex,
      Math.max(this.proofInputs.length - 1, 0),
    );
    this.showSelectedProofInput();
  }

  previousProofInput(): void {
    if (this.proofInputs.length < 2) return;
    this.selectedProofInputIndex = (this.selectedProofInputIndex - 1 + this.proofInputs.length)
      % this.proofInputs.length;
    this.showSelectedProofInput();
  }

  nextProofInput(): void {
    if (this.proofInputs.length < 2) return;
    this.selectedProofInputIndex = (this.selectedProofInputIndex + 1) % this.proofInputs.length;
    this.showSelectedProofInput();
  }

  private showSelectedProofInput(): void {
    const input = this.proofInputs[this.selectedProofInputIndex];
    if (!input) {
      return;
    }
    this.meaningConstructors = input.meaningConstructors;
    this.editor1?.updateContent(this.meaningConstructors);
  }

  onSemanticSelectionChange(selection: {
    items: GswbSolution[];
    selectedScopeIds?: string[];
    selectedMcIds?: string[];
  }): void {
    if (this.loadingSemanticState || !this.allSemanticSolutions.length) {
      return;
    }
    if (this.updatingMergedSolutions) {
      return;
    }
    this.selectedSemanticIds = selection.items.map(solution => solution.id);
    this.selectedScopeIds = [...(selection.selectedScopeIds ?? [])];
    this.selectedMcIds = [...(selection.selectedMcIds ?? [])];
    this.semanticSolutionReady = this.hasSemanticSolutions
      && Array.isArray(selection?.items)
      && selection.items.some(solution =>
        typeof solution?.solution === 'string' && solution.solution.trim().length > 0);

    this.updateSentenceAnalyses(this.allSemanticSolutions);
    if (this.previousSentenceAnalyses.length || this.previousSequenceAnalyses.length) {
      this.mergeCurrentSolutions(selection.items);
    }
  }

  private mergeCurrentSolutions(solutions: GswbSolution[]): void {
    const previousElements: Array<SentenceAnalysis | SequenceAnalysis> = this.previousSequenceAnalyses.length
      ? this.previousSequenceAnalyses
      : this.previousSentenceAnalyses;
    const previousContexts = previousElements.flatMap(element =>
      ('sentences' in element ? element.semantics : selectedSentenceSemantics(element))
        .map(semantic => ({ semantic, element }))
    );
    const canonicalPrevious = previousContexts
      .map(context => context.semantic)
      .filter(semantic => !!semantic.graph);
    if (!canonicalPrevious.length) {
      this.updateSentenceAnalyses(solutions);
      console.info('[Analysis] no previous semantic context; skipping sequence merge', {
        currentSolutionCount: solutions.length,
      });
      return;
    }

    const current = solutions.filter(solution => !!solution?.graph);
    if (!current.length) {
      this.hasSemanticSolutions = false;
      this.semanticSolutionReady = false;
      return;
    }

    console.info('[Analysis] preparing GSWB sequence semantic merges', {
      previousSemanticCount: canonicalPrevious.length,
      currentSolutionCount: current.length,
      previousGraphCount: canonicalPrevious.filter(semantic => !!semantic.graph).length,
      currentSolutions: current.map(solution => ({
        id: solution.id,
        solutionKey: solution.solutionKey,
        semanticLength: solution.semantic?.length ?? 0,
        graphConstraints: solution.graph?.constraints?.length ?? 0,
        graphAnnotations: solution.graph?.annotations?.length ?? 0,
      })),
    });

    const mergeRequests = current.flatMap(solution =>
      canonicalPrevious.map((_previousSemantic, index) =>
        this.dataService.gswbMergeSequenceSemantics({
        parts: [
          this.semanticPart(canonicalPrevious[index]),
          this.semanticPart(this.semanticAnalysisFor(solution)),
        ],
        parentSolutionId: solution.id,
        solutionKey: solution.solutionKey,
        mcSetId: solution.mcSetId,
        resolveDrs: this.gswbPreferences.gswbPreferences.resolveDrs,
        }).pipe(
          map(merged => ({
            merged,
            previousElement: previousContexts[index].element,
            currentElement: this.sentenceAnalysisFor(solution),
          }))
        )
      )
    );

    forkJoin(mergeRequests).pipe(
      switchMap(results => this.mergeSyntaxForResults(results))
    ).subscribe(mergedSolutions => {
      this.updateSequenceAnalyses(mergedSolutions);
      console.info('[Analysis] GSWB sequence semantic merges completed', {
        mergeCount: mergedSolutions.length,
        mergedSolutions: mergedSolutions.map(solution => ({
          id: solution.id,
          solutionKey: solution.solutionKey,
          semanticLength: solution.semantic?.length ?? 0,
          graphConstraints: solution.graph?.constraints?.length ?? 0,
          graphAnnotations: solution.graph?.annotations?.length ?? 0,
        })),
      });
      this.updatingMergedSolutions = true;
      try {
        this.semvis.setItems(mergedSolutions);
        this.semvis.setDiscriminants([]);
      } finally {
        this.updatingMergedSolutions = false;
      }
      this.hasSemanticSolutions = mergedSolutions.length > 0;
      this.semanticSolutionReady = this.hasSemanticSolutions;
    }, () => {
      this.hasSemanticSolutions = false;
      this.semanticSolutionReady = false;
    });
  }

  private mergeSyntaxForResults(results: Array<{
    merged: GswbSolution;
    previousElement?: SentenceAnalysis | SequenceAnalysis;
    currentElement?: SentenceAnalysis;
  }>): import('rxjs').Observable<GswbSolution[]> {
    const groups = new Map<string, typeof results>();
    results.forEach(result => {
      const key = `${this.syntaxIds(result.previousElement)}=>${this.syntaxIds(result.currentElement)}`;
      const group = groups.get(key) ?? [];
      group.push(result);
      groups.set(key, group);
    });

    return forkJoin(Array.from(groups.values()).map(group => {
      const first = group[0];
      if (!first.previousElement || !first.currentElement) {
        return of(group.map(result => result.merged));
      }
      const previousSentences = 'sentences' in first.previousElement
        ? first.previousElement.sentences
        : [first.previousElement];
      const sentences = [...previousSentences, first.currentElement];
      return this.dataService.ligerSequence({
        sentences: sentences.map(sentence => sentence.text),
        sentenceIds: sentences.map(sentence => sentence.id),
        parsedSentences: sentences.map(sentence => sentence.syntax.map(syntax => syntax.structure)),
      }).pipe(
        map(sequence => {
          const syntax = sequence?.solutions?.[0]?.sequenceAnalysis;
          return group.map(result => {
            if (syntax) {
              const semantic = this.semanticAnalysisFor(result.merged);
              result.merged.sequenceAnalysis = {
                ...syntax,
                id: result.merged.id || syntax.id,
                semantics: [semantic],
                synSemMapping: result.merged.synSemMapping ?? {
                  [semantic.syntacticOrigin]: [semantic.semId]
                },
              };
            }
            return result.merged;
          });
        }),
        catchError(() => of(group.map(result => result.merged)))
      );
    })).pipe(
      map(groupResults => groupResults.flat())
    );
  }

  private syntaxIds(element?: SentenceAnalysis | SequenceAnalysis): string {
    return element?.syntax.map(syntax => syntax.synId).join('+') ?? 'unknown';
  }

  private sentenceAnalysisFor(solution: GswbSolution): SentenceAnalysis | undefined {
    if (solution.sentenceAnalysis) {
      return solution.sentenceAnalysis;
    }
    const proof = this.proofInputs.find(input => input.solutionKey === solution.solutionKey);
    return proof?.sentenceAnalysis
      ?? proof?.sequenceAnalysis?.sentences?.[0];
  }

  private updateSequenceAnalyses(solutions: GswbSolution[]): void {
    const sequenceByKey = new Map(
      this.proofInputs
        .filter(input => !!input.sequenceAnalysis)
        .map(input => [input.solutionKey, input.sequenceAnalysis] as const)
    );
    const analysesBySyntax = new Map<string, SequenceAnalysis>();
    solutions.forEach(solution => {
      const template = solution.sequenceAnalysis
        ?? sequenceByKey.get(solution.solutionKey)
        ?? this.proofInputs.find(input => !!input.sequenceAnalysis)?.sequenceAnalysis;
      if (!template) {
        return;
      }

      const syntaxId = template.syntax[0]?.synId || solution.solutionKey || solution.id;
      const existing = analysesBySyntax.get(syntaxId);
      const semantic = {
        ...this.semanticAnalysisFor(solution),
        syntacticOrigin: syntaxId,
      };
      const analysis = existing ?? {
        ...template,
        id: syntaxId,
        semantics: [],
        synSemMapping: {},
      } as SequenceAnalysis;

      if (!analysis.semantics.some(item => item.semId === semantic.semId)) {
        analysis.semantics = [...analysis.semantics, semantic];
      }
      analysis.synSemMapping[syntaxId] = Array.from(new Set([
        ...(analysis.synSemMapping[syntaxId] ?? []),
        semantic.semId,
      ]));
      analysesBySyntax.set(syntaxId, analysis);
      solution.sequenceAnalysis = analysis;
    });
    const analyses = Array.from(analysesBySyntax.values());
    this.sequenceAnalysisChange.emit(analyses);
  }

  private updateSentenceAnalyses(solutions: GswbSolution[]): void {
    const sentenceByKey = new Map(
      this.proofInputs
        .filter(input => !!input.sequenceAnalysis?.sentences?.[0])
        .map(input => [input.solutionKey, input.sequenceAnalysis?.sentences[0]] as const)
    );
    const analyses = solutions
      .map(solution => {
        const template = sentenceByKey.get(solution.solutionKey)
          ?? this.proofInputs.find(input => !!input.sequenceAnalysis?.sentences?.[0])
            ?.sequenceAnalysis?.sentences[0];
        if (!template) return null;
        const semantic = this.semanticAnalysisFor(solution);
        const syntacticOrigin = template.syntax.find(syntax => syntax.synId === semantic.syntacticOrigin)?.synId
          ?? template.syntax[0]?.synId
          ?? semantic.syntacticOrigin;
        const sentenceSemantic = { ...semantic, syntacticOrigin };
        const analysis = {
          ...template,
          semantics: [sentenceSemantic],
          discriminants: this.semanticDiscriminants.map(discriminant => ({
            ...discriminant,
            associatedSolutions: [...(discriminant.associatedSolutions ?? [])],
            instantiations: [...(discriminant.instantiations ?? [])],
          })),
          selectedSemanticIds: [...this.selectedSemanticIds],
          selectedScopeIds: [...this.selectedScopeIds],
          selectedMcIds: [...this.selectedMcIds],
          synSemMapping: {
            [sentenceSemantic.syntacticOrigin]: [sentenceSemantic.semId],
          },
        } as SentenceAnalysis;
        solution.sentenceAnalysis = analysis;
        return analysis;
      })
      .filter((analysis): analysis is SentenceAnalysis => !!analysis);
    this.sentenceAnalysisChange.emit(analyses);
  }

  private semanticAnalysisFor(solution: GswbSolution): SemanticAnalysis {
    if (solution.semanticAnalysis) {
      return solution.semanticAnalysis;
    }
    return {
      syntacticOrigin: solution.solutionKey || solution.proofId || 'syntax',
      semId: solution.id,
      semString: solution.semantic || solution.solution || '',
      graph: solution.graph,
      semType: 'lfgxdrt',
    };
  }

  private semanticPart(
    semantic: SemanticAnalysis
  ): GswbSemanticMergePart {
    return {
      id: semantic.semId,
      solutionId: semantic.semId,
      syntacticOrigin: semantic.syntacticOrigin,
      semantic: semantic.semString,
      graph: semantic.graph,
      provenance: {
        syntacticOrigin: semantic.syntacticOrigin,
        semanticId: semantic.semId,
      },
    };
  }

  captureState(): GswbWorkspaceState | null {
    if (!this.editor1 || !this.semvis || !this.gswbPreferences || !this.log) {
      return this.pendingState;
    }

    return {
      meaningConstructors: this.meaningConstructors ?? '',
      editorText: this.editor1.getContent(),
      logText: this.log.getContent(),
      gswbPreferences: { ...this.gswbPreferences.gswbPreferences },
      semvis: this.semvis.captureState(),
    };
  }

  restoreState(state: GswbWorkspaceState | null): void {
    this.pendingState = state;
    this.applyPendingState();
  }

  private applyPendingState(): void {
    const state = this.pendingState;
    if (!state || !this.editor1 || !this.semvis || !this.gswbPreferences || !this.log) {
      return;
    }

    this.meaningConstructors = state.meaningConstructors ?? '';
    this.editor1.updateContent(state.editorText ?? '');
    this.log.updateContent(state.logText ?? '');

    const prefs = state.gswbPreferences ?? APP_DEFAULTS.gswb.preferences;
    this.gswbPreferences.gswbPreferences = { ...prefs };
    this.gswbPreferences.updateFormFromPreferences(this.gswbPreferences.gswbPreferences);

    this.semvis.restoreState(state.semvis);
    this.hasSemanticSolutions = Array.isArray(state.semvis?.items)
      && state.semvis.items.some((solution: any) =>
        typeof solution?.solution === 'string' && solution.solution.trim().length > 0);
    this.semanticSolutionReady = this.hasSemanticSolutions;
    this.pendingState = null;
  }

}


// Inside ParentComponent
