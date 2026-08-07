import {Component, ElementRef, ViewChild, AfterViewInit, Input, Output, EventEmitter} from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { LogComponent } from './log/log.component';
import { EditorComponent } from '../editor/editor.component';
import { DataService } from '../data.service';
import {DerivationContainerComponent} from "./derivation-container/derivation-container.component";
import {DialogComponent} from "../utilities/dialog/dialog.component";
import {GswbProofInput, GswbRequest,GswbPreferences, GswbSolution, LigerStructure, SemanticAnalysis, SequenceAnalysis} from "../models/models";
import {GswbSettingsComponent} from "./gswb-settings/gswb-settings.component";
import {SemVisComponent} from "../sem-vis/sem-vis.component";
import { GswbWorkspaceState } from "../analysis-workspace-state.service";
import { APP_DEFAULTS } from "../app-defaults";
import { forkJoin } from 'rxjs';


@Component({
  selector: 'app-gswb-vis',
  templateUrl: './gswb-vis.component.html',
  styleUrls: ['./gswb-vis.component.css']
})


export class GswbVisComponent implements AfterViewInit {
  @Input() structureJson: LigerStructure | null = null;
  @Input() canPostProcess = false;
  @Input() postProcessingLoading = false;
  @Input() previousSemanticGraphs: LigerStructure[] = [];
  @Input() previousSemanticStrings: string[] = [];
  @Input() previousSequenceAnalyses: SequenceAnalysis[] = [];
  @Output() postProcessing = new EventEmitter<'inline' | 'standalone'>();
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
              this.hasSemanticSolutions = true;
              // For a sequence, the raw current-sentence readings are not
              // ready for the next append until their sequence merge finishes.
              this.semanticSolutionReady = this.previousSemanticGraphs.length === 0;
            this.semvis.clearMc();
            this.semvis.clearScope();
            this.semvis.applyFiltersAndResetIndex();

             this.semvis.setItems(data.solutions);
             this.semvis.setDiscriminants(data.discriminants);
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

  onSemanticSelectionChange(selection: { items: any[] }): void {
    this.semanticSolutionReady = this.hasSemanticSolutions
      && Array.isArray(selection?.items)
      && selection.items.some(solution =>
        typeof solution?.solution === 'string' && solution.solution.trim().length > 0);
  }

  private mergeCurrentSolutions(solutions: GswbSolution[]): void {
    const canonicalPrevious = this.previousSequenceAnalyses
      .flatMap(analysis => analysis.semantics)
      .filter(semantic => !!semantic.graph);
    const previous = canonicalPrevious.length
      ? canonicalPrevious.map(semantic => semantic.graph as LigerStructure)
      : this.previousSemanticGraphs.filter(graph => !!graph);
    const previousSemantics = canonicalPrevious.length
      ? canonicalPrevious.map(semantic => semantic.semString)
      : this.previousSemanticStrings;
    if (!previous.length) {
      this.updateSequenceAnalyses(solutions);
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
      previousGraphCount: previous.length,
      currentSolutionCount: current.length,
      previousGraphSizes: previous.map(graph => ({
        constraints: graph.constraints?.length ?? 0,
        annotations: graph.annotations?.length ?? 0,
      })),
      currentSolutions: current.map(solution => ({
        id: solution.id,
        solutionKey: solution.solutionKey,
        semanticLength: solution.semantic?.length ?? 0,
        graphConstraints: solution.graph?.constraints?.length ?? 0,
        graphAnnotations: solution.graph?.annotations?.length ?? 0,
      })),
    });

    const mergeRequests = current.flatMap(solution => previous.map((previousGraph, index) =>
      this.dataService.gswbMergeSequenceSemantics({
        semantics: [previousSemantics[index] || '', solution.semantic || ''],
        graphs: [previousGraph, solution.graph as LigerStructure],
        parentSolutionId: solution.id,
        solutionKey: solution.solutionKey,
        mcSetId: solution.mcSetId,
      })));

    forkJoin(mergeRequests).subscribe(mergedSolutions => {
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
      this.semvis.setItems(mergedSolutions);
      this.semvis.setDiscriminants([]);
      this.hasSemanticSolutions = mergedSolutions.length > 0;
      this.semanticSolutionReady = this.hasSemanticSolutions;
    }, () => {
      this.hasSemanticSolutions = false;
      this.semanticSolutionReady = false;
    });
  }

  private updateSequenceAnalyses(solutions: GswbSolution[]): void {
    const sequenceByKey = new Map(
      this.proofInputs
        .filter(input => !!input.sequenceAnalysis)
        .map(input => [input.solutionKey, input.sequenceAnalysis] as const)
    );
    const analyses = solutions
      .map(solution => {
        const template = sequenceByKey.get(solution.solutionKey)
          ?? this.proofInputs.find(input => !!input.sequenceAnalysis)?.sequenceAnalysis;
        if (!template) {
          return null;
        }
        const semantic = this.semanticAnalysisFor(solution);
        const mapping = solution.synSemMapping ?? {
          [semantic.syntacticOrigin]: [semantic.semId]
        };
        return {
          ...template,
          id: solution.id || template.id,
          semantics: [semantic],
          synSemMapping: mapping,
        } as SequenceAnalysis;
      })
      .filter((analysis): analysis is SequenceAnalysis => !!analysis);
    this.sequenceAnalysisChange.emit(analyses);
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
