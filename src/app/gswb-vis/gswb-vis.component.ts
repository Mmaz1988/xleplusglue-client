import {Component, ElementRef, ViewChild, AfterViewInit, Input, Output, EventEmitter} from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { LogComponent } from './log/log.component';
import { EditorComponent } from '../editor/editor.component';
import { DataService } from '../data.service';
import {DerivationContainerComponent} from "./derivation-container/derivation-container.component";
import {DialogComponent} from "../utilities/dialog/dialog.component";
import {GswbDiscriminant, GswbProofInput, GswbRequest,GswbPreferences, GswbSolution, LigerStructure, SemanticAnalysis, SentenceAnalysis, SequenceAnalysis} from "../models/models";
import {GswbSettingsComponent} from "./gswb-settings/gswb-settings.component";
import {SemVisComponent} from "../sem-vis/sem-vis.component";
import { GswbWorkspaceState } from "../analysis-workspace-state.service";
import { APP_DEFAULTS } from "../app-defaults";
import { selectedSentenceSemantics } from '../analysis-model';
import { DocumentBuilderService } from '../document-builder/document-builder.service';


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
  /** Canonical, always-fully-enriched sentence registry (glue-interface's
   *  analysisDocument.sentences) -- resolve SequenceAnalysis.sentenceIds against
   *  this, distinct from previousSentenceAnalyses which is only a "was there a
   *  previous element to continue" gating signal. */
  @Input() knownSentences: SentenceAnalysis[] = [];
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



  constructor(private dataService: DataService, private documentBuilder: DocumentBuilderService) {

  }
  loading: boolean = false;

  calculateSemantics(){
    this.loading = true;
    this.hasSemanticSolutions = false;
    this.semanticSolutionReady = false;

    this.updateMeaningConstructors();
    this.syncSelectedProofInputFromEditor();

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
             // A fresh parse always starts a new sentence/sequence; only an
             // add-sentence continuation (previous context present) merges.
             // Mirrors the same gate onSemanticSelectionChange() already uses.
             if (this.previousSentenceAnalyses.length || this.previousSequenceAnalyses.length) {
               this.mergeCurrentSolutions(data.solutions);
             } else {
               this.updateSentenceAnalyses(data.solutions);
             }
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

  /** Clears every piece of in-flight semantic state a discourse accumulates. Paired with
   *  LigerVisComponent.resetForNewDiscourse() -- see
   *  docs/plans/DOCUMENT_BUILDER_UNIFICATION_PLAN.md, "starting a new discourse does not
   *  reset the document". Does not touch gswbPreferences -- those are workspace
   *  settings, not discourse state. */
  resetForNewDiscourse(): void {
    this.meaningConstructors = '';
    this.proofInputs = [];
    this.selectedProofInputIndex = 0;
    this.allSemanticSolutions = [];
    this.semanticDiscriminants = [];
    this.selectedSemanticIds = [];
    this.selectedScopeIds = [];
    this.selectedMcIds = [];
    this.hasSemanticSolutions = false;
    this.semanticSolutionReady = false;
    this.editor1?.updateContent('');
    this.sem?.updateContent('');
    this.log?.updateContent('');
    if (this.semvis) {
      this.semvis.setItems([]);
      this.semvis.setDiscriminants([]);
      this.semvis.clearMc();
      this.semvis.clearScope();
    }
  }

  displayMessage(message: string, color: string) {
    this.errorhandle.nativeElement.style.color = color;
    this.errorhandle.nativeElement.innerHTML = "[" + new Date().toLocaleTimeString() + "] " + message;
  }


  updateMeaningConstructors() {
    this.meaningConstructors = this.editor1?.getContent() ?? '';
  }

  /**
   * Wired to editor1's (contentChange) output. GSWB's /deduce endpoint uses
   * `proofs` instead of `premises` whenever `proofs` is non-empty, so an edit
   * made only in the editor was previously discarded silently -- keep the
   * selected proof input's meaningConstructors in sync as the user types.
   */
  onMeaningConstructorsEdited(content: string): void {
    this.meaningConstructors = content;
    const selected = this.proofInputs[this.selectedProofInputIndex];
    if (selected) {
      selected.meaningConstructors = content;
    }
  }

  private syncSelectedProofInputFromEditor(): void {
    const selected = this.proofInputs[this.selectedProofInputIndex];
    const liveContent = this.editor1?.getContent();
    if (selected && liveContent !== undefined && selected.meaningConstructors !== liveContent) {
      selected.meaningConstructors = liveContent;
    }
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
      ('sentenceIds' in element ? element.semantics : selectedSentenceSemantics(element))
        .map(semantic => ({ semantic, element }))
    );
    const canonicalPreviousContexts = previousContexts.filter(context => !!context.semantic.graph);
    if (!canonicalPreviousContexts.length) {
      this.updateSentenceAnalyses(solutions);
      console.info('[Analysis] no previous semantic context; skipping sequence merge', {
        currentSentences: solutions.map(solution => this.sentenceAnalysisFor(solution)?.text),
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
      previousSentences: previousElements.map(element => element.text),
      currentSentences: current.map(solution => this.sentenceAnalysisFor(solution)?.text),
      previousSemanticCount: canonicalPreviousContexts.length,
      currentSolutionCount: current.length,
      currentSolutions: current.map(solution => ({
        id: solution.id,
        solutionKey: solution.solutionKey,
        semanticLength: solution.semantic?.length ?? 0,
        graphConstraints: solution.graph?.constraints?.length ?? 0,
        graphAnnotations: solution.graph?.annotations?.length ?? 0,
      })),
    });

    const currentEntries = current.map(solution => ({
      solution,
      semantic: this.semanticAnalysisFor(solution),
      sentenceAnalysis: this.sentenceAnalysisFor(solution),
    }));

    this.documentBuilder.mergeSequence({
      current: currentEntries,
      previousContexts: canonicalPreviousContexts,
      knownSentences: this.knownSentences,
      resolveDrs: this.gswbPreferences.gswbPreferences.resolveDrs,
    }).subscribe(result => {
      const mergedSolutions = result.pairs.map(pair => pair.merged);
      this.sequenceAnalysisChange.emit(result.sequenceAnalyses);
      console.info('[Analysis] GSWB sequence semantic merges completed', {
        mergeCount: mergedSolutions.length,
        sequenceCount: result.sequenceAnalyses.length,
        mergedSolutions: mergedSolutions.map(solution => ({
          id: solution.id,
          solutionKey: solution.solutionKey,
          sentences: solution.sequenceAnalysis?.text,
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

  private sentenceAnalysisFor(solution: GswbSolution): SentenceAnalysis | undefined {
    if (solution.sentenceAnalysis) {
      return solution.sentenceAnalysis;
    }
    const proof = this.proofInputs.find(input => input.solutionKey === solution.solutionKey);
    const embedded = proof?.sequenceAnalysis?.sentences?.[0];
    // Prefer the canonical, fully-enriched entry when it's already registered, but a
    // sentence's very first deduction runs before document.sentences has an entry for
    // it at all (chicken-and-egg) -- fall back to the embedded (syntax-only) copy from
    // LiGER's own response rather than returning nothing.
    const known = embedded && this.knownSentences.find(sentence => sentence.id === embedded.id);
    return proof?.sentenceAnalysis ?? known ?? embedded;
  }

  private updateSentenceAnalyses(solutions: GswbSolution[]): void {
    // Prefer proofInput.sentenceAnalysis (set for every LiGER solution, including the
    // single-sentence /apply_rules_xle path addSentence() uses) over
    // proofInput.sequenceAnalysis.sentences[0] (only set by /apply_rules_xle_sequence,
    // i.e. the first sentence's analyzeSentence() call). Mirrors sentenceAnalysisFor()'s
    // priority so both stay in sync.
    const fallbackInput = this.proofInputs.find(input => !!input.sentenceAnalysis || !!input.sequenceAnalysis?.sentences?.[0]);
    const fallbackEmbedded = fallbackInput?.sequenceAnalysis?.sentences?.[0];
    const fallbackKnown = fallbackEmbedded && this.knownSentences.find(sentence => sentence.id === fallbackEmbedded.id);
    const fallbackTemplate = fallbackInput?.sentenceAnalysis ?? fallbackKnown ?? fallbackEmbedded;
    const analyses = solutions
      .map(solution => {
        const template = this.sentenceAnalysisFor(solution) ?? fallbackTemplate;
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
