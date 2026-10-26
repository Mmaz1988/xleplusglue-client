import { Component, ViewChild, EventEmitter, ElementRef, AfterViewInit, Input } from '@angular/core';
import {RuleListComponent} from "./rule-list/rule-list.component";
import {GraphVisComponent} from "./liger-graph-vis/graph-vis.component";
import {GrammarLoaderComponent} from "../utilities/grammar-loader/grammar-loader.component";
import { proofInputsFrom } from '../document-builder/proof-inputs';
import { DataService } from '../data.service';
import { GswbProofInput, LigerSolutionAnnotation, LigerStructure, SequenceAnalysis } from '../models/models';
import { AnalysisWorkspaceStateService, LigerWorkspaceState } from '../analysis-workspace-state.service';
import { LigerWorkspaceService } from '../liger-workspace/liger-workspace.service';
import { APP_DEFAULTS } from "../app-defaults";

@Component({
  selector: 'app-liger-vis',
  templateUrl: './liger-vis.component.html',
  styleUrls: ['./liger-vis.component.css']
})
export class LigerVisComponent implements AfterViewInit {

  @Input() semanticSolutionReady = false;

  constructor(private dataService: DataService, private workspaceState: AnalysisWorkspaceStateService,
              private ligerWorkspace: LigerWorkspaceService) {
    const savedGrammarPath = this.workspaceState.getState().liger?.grammarLoadedPath;
    if (savedGrammarPath) {
      this.loadedGrammarPath = savedGrammarPath;
    }
  }

  defaultValue: string = APP_DEFAULTS.liger.sentence;
  sequenceSentences: string[] = [];
  sequenceSentenceIds: string[] = [];
  loadedGrammarPath = '';
  meaningConstructors: string;
  structureJson: LigerStructure | null = null;
  changeDetector: EventEmitter<any> = new EventEmitter();
  proofInputChange: EventEmitter<GswbProofInput[]> = new EventEmitter();
  /** Fires when a successful `analyzeSentence()` parse starts a brand new discourse (as
   *  opposed to `addSentence()`, which continues one). A discourse is not supposed to
   *  need an explicit "New discourse" action at all -- parsing a fresh first sentence
   *  IS starting one, per design intent (docs/plans/DOCUMENT_BUILDER_UNIFICATION_PLAN.md).
   *  Emitted before proofInputChange/changeDetector so the document is empty before the
   *  new sentence tries to register into it. */
  discourseReset: EventEmitter<void> = new EventEmitter();
  graphElements: any
  loading: boolean = false;
  solutions: LigerSolutionAnnotation[] = [];
  selectedSolutionIndex = 0;
  useAllResults = true;

  @ViewChild('rl1') rulelist1: RuleListComponent;
  @ViewChild('cy1') cy1: GraphVisComponent;
  @ViewChild('grammarLoader') grammarLoader: GrammarLoaderComponent;
  @ViewChild('textareaElement') textarea: ElementRef;
  @ViewChild('errorhandle') errorhandle: ElementRef;

  private pendingState: LigerWorkspaceState | null = null;

  ngAfterViewInit(): void {
    this.applyPendingState();
  }



  analyzeSentence(inputValue: string, ruleString: string) {
   // console.log(inputValue)
    // console.log(this.editor1.getContent())
    this.loading = true;

    this.errorhandle.nativeElement.innerHTML = "";
    const sentence = inputValue;

    this.dataService.ligerSequence({ sentences: [sentence], sentenceIds: ['sentence-1'], ruleString }).subscribe(
      data => {
        this.loading = false;
        this.errorhandle.nativeElement.innerHTML = "";
        this.solutions = Array.isArray(data.solutions) ? data.solutions : [];
        console.info('[LiGER] parse succeeded', { solutionCount: this.solutions.length });
        if (this.solutions.length > 0) {
          this.sequenceSentences = [sentence];
          this.sequenceSentenceIds = ['sentence-1'];
        }
        this.selectedSolutionIndex = 0;

        if (this.solutions.length > 0) {
          // A fresh parse always starts a new discourse -- the document must be empty
          // before this sentence tries to register as 'sentence-1', or it collides with
          // whatever discourse was there before (see docs/plans/
          // DOCUMENT_BUILDER_UNIFICATION_PLAN.md's captured
          // analysis-document-sequence-not-reset-properly.json repro).
          this.discourseReset.emit();
          this.renderSelectedSolution(0);
          this.displayMessage(`Parsing successful... ${this.solutions.length} solution(s) found`, "green");
        } else {
          this.cy1.renderGraph([]);
          this.rulelist1.clearList();
          this.meaningConstructors = '';
          this.structureJson = null;
          this.graphElements = [];
          this.displayMessage("Parsing failed...", "red")
        }

        if (data.hasOwnProperty('sentence')) {
          console.log('Sentence:', data.sentence);
        }


      },
      error => {
        this.loading = false;
        console.warn('[LiGER] parse failed', error);
        this.displayMessage("An error occurred while calling LiGER...", "red");
      }
    );
  }

  /** Parses the next sentence of the discourse on its own, like `analyzeSentence`: the
   *  analysis view shows a sentence's own meaning constructors and derives its own readings,
   *  once per parse. Appending them to the discourse is the semantic merge's job
   *  (`DocumentBuilderService.appendSentence`), which places each reading in the sequence. */
  addSentence(inputValue: string, ruleString: string): void {
    const sentence = inputValue.trim();
    if (!sentence || !this.canAppendSentence() || this.loading) {
      if (sentence && this.sequenceSentences.length && !this.canAppendSentence()) {
        this.displayMessage("Calculate and select a GSWB semantics solution before adding a sentence.", "red");
      }
      return;
    }

    const sentences = [...this.sequenceSentences, sentence];
    const sentenceIds = [...this.sequenceSentenceIds, `sentence-${sentences.length}`];
    const sentenceId = sentenceIds[sentenceIds.length - 1];
    this.loading = true;
    this.errorhandle.nativeElement.innerHTML = "";
    console.info('[Analysis] parsing appended sentence on its own', { sentenceId, sentence });

    this.dataService.ligerSequence({ sentences: [sentence], sentenceIds: [sentenceId], ruleString }).subscribe(
      data => {
        this.loading = false;
        const solutions = Array.isArray(data.solutions) ? data.solutions : [];
        const graphAvailable = solutions.some(solution =>
          Array.isArray(solution?.graph?.graphElements) && solution.graph.graphElements.length > 0);
        if (data.success === false || !solutions.length || !graphAvailable) {
          this.displayMessage(
            data.failureMessage || `Sentence ${sentences.length} could not be parsed; sequence unchanged.`,
            "red");
          return;
        }

        this.solutions = solutions;
        this.selectedSolutionIndex = 0;
        // Before rendering: rendering emits the meaning constructors, and glue-interface
        // reads the sequence length off that emission to capture the previous context.
        this.sequenceSentences = sentences;
        this.sequenceSentenceIds = sentenceIds;
        this.renderSelectedSolution(0);
        this.displayMessage(`Sentence parsed... ${this.solutions.length} solution(s) found`, "green");
      },
      error => {
        this.loading = false;
        this.displayMessage("An error occurred while appending the sentence...", "red");
        console.log("ERROR: ", error);
      }
    );
  }

  canAppendSentence(): boolean {
    const selectedSolution = this.solutions[this.selectedSolutionIndex];
    return this.sequenceSentences.length > 0
      && this.semanticSolutionReady
      && !!selectedSolution
      && typeof selectedSolution.meaningConstructors === 'string'
      && selectedSolution.meaningConstructors.trim().length > 0;
  }

  /*
  hybridAnalysis(inputValue: string, ruleString: string) {
    const sentence = inputValue;

    const ligerRequest = {sentence: sentence, ruleString: ruleString};

    this.dataService.ligerHybrid(ligerRequest).subscribe(
      data => {
        this.errorhandle.nativeElement.innerHTML = "";

        if (data.hasOwnProperty("graph")) {
          if (data.graph.hasOwnProperty("graphElements")) {
            if (!(data.graph.graphElements.length == 0)) {
              console.log(data.graph.graphElements);
              this.cy1.renderGraph(data.graph.graphElements);
              this.graphElements = data.graph.graphElements;
            } else {
              this.errorhandle.nativeElement.innerHTML =  "Parsing failed...";
            }
          }
        }
        if (data.hasOwnProperty("appliedRules") && data.appliedRules !== null){
          console.log(data.appliedRules);

          this.rulelist1.clearList();

          for (let i = 0; i < data.appliedRules.length; i++) {
            this.rulelist1.addElement({rule: data.appliedRules[i], index: i});
          }
        }
        if (data.hasOwnProperty("meaningConstructors")) {
          console.log(data.meaningConstructors);
          this.meaningConstructors = data.meaningConstructors;
          this.changeDetector.emit(data.meaningConstructors);
        }
      },
      error => {
        console.log('ERROR: ', error);
      }
    );
  }
   */

  //Used for multistage parsing button
  parseSentence(inputValue: string, ruleString: string) {
    // console.log(inputValue)
    // console.log(this.editor1.getContent())
    const sentence = inputValue;
    this.errorhandle.nativeElement.innerHTML = "";
    this.loading = true;

    const ligerRequest = {sentence: sentence, ruleString: ""};

    // console.log(ligerRequest);

    this.dataService.ligerMulti(ligerRequest).subscribe(
      data => {
        this.loading = false;
        this.solutions = Array.isArray(data.solutions) ? data.solutions : [];
        this.selectedSolutionIndex = 0;

        if (this.solutions.length > 0) {
          this.renderSelectedSolution(0);
          this.displayMessage(`Parsing successful... ${this.solutions.length} solution(s) found`, "green");
        } else {
        this.cy1.renderGraph([]);
        this.rulelist1.clearList();
        this.meaningConstructors = '';
        this.structureJson = null;
        this.graphElements = [];
        this.displayMessage("Parsing failed...", "red");
        }


      },
      error => {
        console.log('ERROR: ', error);
        this.displayMessage("An error occurred...", "red");
        this.loading = false;
      }
    );
  }



  calculateFromRuleList(event: any) {

    let newRules = [];

    for (let i = 0; i <= event.index; i++) {
      newRules.push(this.rulelist1.elements[i].rule);
    }
    console.log("New rules: \n", newRules)

    // map each element of newRules to its rule property and join with newline
    let ruleString = newRules.map((element) => element["rule"]).join("\n");

    ruleString = "--replace(true);\n" + ruleString;

    console.log("Rule string: \n", ruleString);

    this.analyzeSentence(this.textarea.nativeElement.value, ruleString);
  }

  showDialog(){
    this.cy1.subgraphDialog.setContent(this.graphElements)
    this.cy1.subgraphDialog.showDialog()
  }

  selectSolution(index: number): void {
    if (index < 0 || index >= this.solutions.length) {
      return;
    }

    this.selectedSolutionIndex = index;
    this.renderSelectedSolution(index);
  }

  previousSolution(): void {
    if (!this.solutions.length) return;
    this.selectSolution((this.selectedSolutionIndex - 1 + this.solutions.length) % this.solutions.length);
  }

  nextSolution(): void {
    if (!this.solutions.length) return;
    this.selectSolution((this.selectedSolutionIndex + 1) % this.solutions.length);
  }

  displaySequenceAnalysis(sequence: SequenceAnalysis): void {
    const syntax = sequence?.syntax?.[0];
    if (!syntax) {
      return;
    }
    this.structureJson = syntax.structure;
    this.graphElements = syntax.graph?.graphElements ?? [];
    this.cy1.renderGraph(this.graphElements);
    console.info('[Analysis] displaying merged sequence syntax', {
      sequenceId: sequence.id,
      sentenceCount: sequence.sentenceIds.length,
      graphElements: this.graphElements.length,
    });
  }

  collectAllMeaningConstructors(): void {
    this.useAllResults = true;
    const selected = this.solutions[this.selectedSolutionIndex];
    const selectedMeaningConstructors = selected?.meaningConstructors ?? '';
    this.meaningConstructors = selectedMeaningConstructors;
    this.changeDetector.emit(selectedMeaningConstructors);
    const proofInputs = this.proofInputsFor(this.solutions);
    this.proofInputChange.emit(proofInputs);
  }

  toggleResultScope(): void {
    this.useAllResults = !this.useAllResults;
    if (this.useAllResults) {
      this.collectAllMeaningConstructors();
      return;
    }
    this.renderSelectedSolution(this.selectedSolutionIndex);
  }

  /** The current sentence's own parses, one proof each, with the sentence's id: GSWB names
   *  its readings after it, so two sentences' readings never share an id. A one-sentence
   *  sequence names each parse twice -- the solution `sequence-<n>-S<k>`, the sentence's
   *  syntax `S<k>` -- and the proof takes the syntax id, so every reading GSWB stamps names
   *  the parse it is registered under (gswb-vis `updateSentenceAnalyses`). */
  private proofInputsFor(solutions: LigerSolutionAnnotation[]): GswbProofInput[] {
    return proofInputsFrom(
      solutions.map(solution => ({
        ...solution,
        solutionKey: solution.sequenceAnalysis?.sentences?.[0]?.syntax?.[0]?.synId ?? solution.solutionKey,
      })),
      { sentenceId: this.sequenceSentenceIds[this.sequenceSentenceIds.length - 1] });
  }

  private renderSelectedSolution(index: number): void {
    const solution = this.solutions[index];
    if (!solution) {
      return;
    }

    const graphElements = solution.graph?.graphElements ?? [];
    this.graphElements = graphElements;
    this.structureJson = solution.structureJson ?? null;

    this.cy1.renderGraph(graphElements);

    this.rulelist1.clearList();
    for (let i = 0; i < (solution.appliedRules?.length ?? 0); i++) {
      this.rulelist1.addElement({rule: solution.appliedRules[i], index: i});
    }

    this.meaningConstructors = solution.meaningConstructors ?? '';
    this.changeDetector.emit(this.meaningConstructors);
    const proofInputs = this.useAllResults ? this.proofInputsFor(this.solutions) : this.proofInputsFor([solution]);
    this.proofInputChange.emit(proofInputs);
  }

  displayMessage(message: string, color: string) {
    this.errorhandle.nativeElement.style.color = color;
    this.errorhandle.nativeElement.innerHTML = "[" + new Date().toLocaleTimeString() + "] " + message;
  }

  /** The rule set's semantics rules, in-memory edits included; empty while none is loaded. */
  semanticsRules(): string {
    return this.ligerWorkspace.semantics ?? '';
  }

  onGrammarLoaded(path: string): void {
    this.loadedGrammarPath = path;
  }

  /** Clears every piece of in-flight parse/sequence state a discourse accumulates, so
   *  the next sentence starts a genuinely new sequence instead of appending onto the
   *  previous discourse's sentence-1/2/... ids (see
   *  docs/plans/DOCUMENT_BUILDER_UNIFICATION_PLAN.md, "starting a new discourse does not
   *  reset the document"). Does not touch the grammar/rules selection -- those are
   *  workspace settings, not discourse state. */
  resetForNewDiscourse(): void {
    this.sequenceSentences = [];
    this.sequenceSentenceIds = [];
    this.structureJson = null;
    this.graphElements = [];
    this.solutions = [];
    this.selectedSolutionIndex = 0;
    this.meaningConstructors = '';
    if (this.textarea) {
      this.textarea.nativeElement.value = this.defaultValue;
    }
    if (this.errorhandle) {
      this.errorhandle.nativeElement.innerHTML = '';
    }
    // Clears gswb-vis's proofInputs and glue's editor content -- both already subscribe
    // to these for the normal parse flow, so reset reuses the same path rather than
    // reaching into gswb-vis directly.
    this.proofInputChange.emit([]);
    this.changeDetector.emit('');
  }

  captureState(): LigerWorkspaceState | null {
    if (!this.textarea) {
      return this.pendingState;
    }

    return {
      sentence: this.textarea.nativeElement.value ?? this.defaultValue,
      sequenceSentences: [...this.sequenceSentences],
      sequenceSentenceIds: [...this.sequenceSentenceIds],
      grammarLoadedPath: this.loadedGrammarPath ?? '',
      grammarSelectedPath: this.grammarLoader?.selectedPath ?? this.loadedGrammarPath ?? '',
      structureJson: this.structureJson,
      graphElements: Array.isArray(this.graphElements)
        ? this.graphElements.map(element => ({
          ...element,
          data: element?.data ? { ...element.data } : element?.data,
        }))
        : [],
      solutions: Array.isArray(this.solutions)
        ? this.solutions.map(solution => ({ ...solution }))
        : [],
      selectedSolutionIndex: this.selectedSolutionIndex,
      meaningConstructors: this.meaningConstructors ?? '',
    };
  }

  restoreState(state: LigerWorkspaceState | null): void {
    this.pendingState = state;
    this.applyPendingState();
  }

  private applyPendingState(): void {
    const state = this.pendingState;
    if (!state || !this.textarea || !this.cy1) {
      return;
    }

    this.defaultValue = state.sentence || this.defaultValue;
    this.sequenceSentences = Array.isArray(state.sequenceSentences) && state.sequenceSentences.length
      ? [...state.sequenceSentences]
      : (state.sentence ? [state.sentence] : []);
    this.sequenceSentenceIds = Array.isArray(state.sequenceSentenceIds)
      && state.sequenceSentenceIds.length === this.sequenceSentences.length
      ? [...state.sequenceSentenceIds]
      : this.sequenceSentences.map((_, index) => `sentence-${index + 1}`);
    this.textarea.nativeElement.value = this.defaultValue;
    this.loadedGrammarPath = state.grammarLoadedPath || state.grammarSelectedPath || this.loadedGrammarPath;
    if (this.grammarLoader) {
      this.grammarLoader.restoreState({
        loadedPath: state.grammarLoadedPath ?? state.grammarSelectedPath ?? this.loadedGrammarPath,
        selectedPath: state.grammarSelectedPath ?? state.grammarLoadedPath ?? this.loadedGrammarPath,
      });
    }
    this.structureJson = state.structureJson ?? null;
    this.graphElements = Array.isArray(state.graphElements) ? state.graphElements : [];
    this.solutions = Array.isArray(state.solutions) ? state.solutions : [];
    this.selectedSolutionIndex = Math.min(
      Math.max(state.selectedSolutionIndex ?? 0, 0),
      Math.max(this.solutions.length - 1, 0)
    );
    this.meaningConstructors = state.meaningConstructors ?? '';

    this.cy1.renderGraph(this.graphElements);
    this.pendingState = null;
  }

}
