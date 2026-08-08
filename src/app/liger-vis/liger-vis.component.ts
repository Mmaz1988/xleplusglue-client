import { Component, ViewChild, EventEmitter, ElementRef, AfterViewInit, Input } from '@angular/core';
import {EditorComponent} from "../editor/editor.component";
import {RuleListComponent} from "./rule-list/rule-list.component";
import {GraphVisComponent} from "./liger-graph-vis/graph-vis.component";
import {GrammarLoaderComponent} from "../utilities/grammar-loader/grammar-loader.component";
import { DataService } from '../data.service';
import { GswbProofInput, LigerSolutionAnnotation, LigerStructure, SequenceAnalysis } from '../models/models';
import { AnalysisWorkspaceStateService, LigerWorkspaceState } from '../analysis-workspace-state.service';
import { APP_DEFAULTS } from "../app-defaults";

@Component({
  selector: 'app-liger-vis',
  templateUrl: './liger-vis.component.html',
  styleUrls: ['./liger-vis.component.css']
})
export class LigerVisComponent implements AfterViewInit {

  @Input() semanticSolutionReady = false;

  constructor(private dataService: DataService, private workspaceState: AnalysisWorkspaceStateService) {
    const savedGrammarPath = this.workspaceState.getState().liger?.grammarLoadedPath;
    if (savedGrammarPath) {
      this.loadedGrammarPath = savedGrammarPath;
    }
  }

  defaultValue: string = APP_DEFAULTS.liger.sentence;
  sequenceSentences: string[] = [];
  sequenceSentenceIds: string[] = [];
  parsedSentenceStructures: LigerStructure[][] = [];
  loadedGrammarPath = '';
  meaningConstructors: string;
  structureJson: LigerStructure | null = null;
  changeDetector: EventEmitter<any> = new EventEmitter();
  proofInputChange: EventEmitter<GswbProofInput[]> = new EventEmitter();
  graphElements: any
  loading: boolean = false;
  solutions: LigerSolutionAnnotation[] = [];
  selectedSolutionIndex = 0;
  useAllResults = true;

  @ViewChild('ligerRules') ligerRules: EditorComponent;
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

    this.dataService.ligerSequence({ sentences: [sentence], ruleString }).subscribe(
      data => {
        this.loading = false;
        this.errorhandle.nativeElement.innerHTML = "";
        this.solutions = Array.isArray(data.solutions) ? data.solutions : [];
        this.cacheParsedSentenceStructures(this.solutions);
        console.info('[LiGER] parse succeeded', { solutionCount: this.solutions.length });
        if (this.solutions.length > 0) {
          this.sequenceSentences = [sentence];
          this.sequenceSentenceIds = ['sentence-1'];
        }
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

  addSentence(inputValue: string, ruleString: string): void {
    const sentence = inputValue.trim();
    if (!sentence || !this.canAppendSentence() || this.loading) {
      if (sentence && this.sequenceSentences.length && !this.canAppendSentence()) {
        this.displayMessage("Calculate and select a GSWB semantic solution before adding a sentence.", "red");
      }
      return;
    }

    const sentences = [...this.sequenceSentences, sentence];
    const sentenceIds = [...this.sequenceSentenceIds, `sentence-${sentences.length}`];
    const newSentenceIndex = sentences.length - 1;
    // Reuse the already-accepted sentences' parsed structures so only the new
    // sentence is re-parsed/rule-applied, while LiGER's sequence assembler
    // still computes the SYN-ID offset the new sentence needs to occupy once
    // merged into the sequence -- this is what keeps SRC ids in the new
    // sentence's meaning constructors consistent with the merged syntactic
    // tree's SYN-IDs (see plan.md "LiGER SYN-ID assignment" / "the minimal
    // required change is to offset the second structure's SYN-ID values by
    // the maximum SYN-ID in the first structure").
    const parsedSentences = this.parsedSentenceStructures.length === this.sequenceSentences.length
      && this.parsedSentenceStructures.every(structures => structures.length > 0)
      ? this.parsedSentenceStructures
      : undefined;
    this.loading = true;
    this.errorhandle.nativeElement.innerHTML = "";

    console.info('[Analysis] appending sentence through LiGER', {
      sentenceIndex: sentences.length,
      sentence,
      sequenceLength: sentences.length,
      reparsingSentences: sentences,
      hasRuleString: !!ruleString?.trim(),
      reusingParsedSentences: !!parsedSentences,
    });

    this.dataService.ligerSequence({ sentences, sentenceIds, ruleString, parsedSentences }).subscribe(
      data => {
        this.loading = false;
        const solutions = Array.isArray(data.solutions) ? data.solutions : [];
        console.info('[Analysis] LiGER sequence append completed', {
          sentence,
          success: data.success !== false,
          solutionCount: solutions.length,
          sequenceLength: sentences.length,
          solutionKeys: solutions.map(solution => solution.solutionKey),
          sequenceParts: solutions.map(solution => (solution.sequenceParts ?? []).map(part => ({
            sourceIndex: part.sourceIndex,
            sourceIndexOffset: part.sourceIndexOffset,
            solutionKey: part.solutionKey,
            meaningConstructorsLength: part.meaningConstructors?.length ?? 0,
          }))),
        });
        const graphAvailable = solutions.some(solution =>
          Array.isArray(solution?.graph?.graphElements) && solution.graph.graphElements.length > 0);
        if (data.success === false || !solutions.length || !graphAvailable) {
          const failedIndex = Number.isInteger(data.failedSentenceIndex)
            ? (data.failedSentenceIndex as number) + 1
            : sentences.length;
          this.displayMessage(
            data.failureMessage || `Sentence ${failedIndex} could not be parsed; sequence unchanged.`,
            "red");
          return;
        }

        this.solutions = solutions;
        this.cacheParsedSentenceStructures(this.solutions);
        this.selectedSolutionIndex = 0;
        if (this.solutions.length > 0) {
          this.sequenceSentences = sentences;
          this.sequenceSentenceIds = sentenceIds;
          console.info('[Analysis] accepted LiGER sequence append', {
            sequenceSentences: this.sequenceSentences,
            selectedSolutionKey: this.solutions[0].solutionKey,
            selectedStructureConstraints: this.solutions[0].structureJson?.constraints?.length ?? 0,
            selectedStructureAnnotations: this.solutions[0].structureJson?.annotations?.length ?? 0,
          });
          this.renderSelectedSolution(0);
          // renderSelectedSolution() emits proof inputs built from the whole
          // merged sequence's meaning constructors (correct for the initial
          // parse, where the "sequence" is just sentence 1). For an appended
          // sentence we still want to prove the new sentence's semantics on
          // its own -- so re-emit proof inputs scoped to just this sentence's
          // part, using its already source-index-shifted meaning constructors
          // paired with the full (SRC-consistent) merged structure.
          const solutionsForProof = this.useAllResults ? this.solutions : [this.solutions[0]];
          const proofInputs = this.proofInputsForSequencePart(solutionsForProof, newSentenceIndex);
          this.proofInputChange.emit(proofInputs);
          this.displayMessage(`Sentence appended... ${this.solutions.length} sequence variant(s) found`, "green");
        } else {
          this.displayMessage("No sequence parse was found...", "red");
        }
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

  private proofInputsFor(solutions: LigerSolutionAnnotation[]): GswbProofInput[] {
    return solutions
      .map((solution, index) => ({
        proofId: solution.solutionKey || `solution-${index}`,
        sentenceId: solution.sentenceAnalysis?.id,
        solutionKey: solution.solutionKey,
        mcSetId: solution.solutionKey || `solution-${index}`,
         meaningConstructors: solution.meaningConstructors ?? '',
         structure: solution.structureJson,
         sentenceAnalysis: solution.sentenceAnalysis,
         sequenceAnalysis: solution.sequenceAnalysis,
       }))
      .filter(input => input.meaningConstructors.trim().length > 0);
  }

  /**
   * Proof inputs for one sentence's own part within a merged sequence
   * response, keyed by sequenceParts[sentenceIndex] rather than the
   * solution's whole-sequence meaningConstructors. sequenceParts entries are
   * already shifted into the sequence-global SYN-ID range by LiGER's
   * SequenceGraphAssembler, so SRC ids in the returned meaning constructors
   * line up with the SYN-IDs of the same sentence's nodes in structureJson
   * (the full merged structure).
   */
  private proofInputsForSequencePart(solutions: LigerSolutionAnnotation[], sentenceIndex: number): GswbProofInput[] {
    return solutions
      .map((solution, index) => {
        const part = solution.sequenceParts?.find(candidate => candidate.sourceIndex === sentenceIndex);
        return {
          proofId: part?.solutionKey || solution.solutionKey || `solution-${index}`,
          sentenceId: solution.sequenceAnalysis?.sentences?.[sentenceIndex]?.id,
          solutionKey: solution.solutionKey,
          mcSetId: part?.solutionKey || solution.solutionKey || `solution-${index}`,
          meaningConstructors: part?.meaningConstructors ?? '',
          structure: solution.structureJson,
          sentenceAnalysis: solution.sequenceAnalysis?.sentences?.[sentenceIndex],
          sequenceAnalysis: solution.sequenceAnalysis,
        };
      })
      .filter(input => input.meaningConstructors.trim().length > 0);
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

  updateRules(ruleFile: string) {
    this.ligerRules.updateContent(ruleFile);
  }

  onGrammarLoaded(path: string): void {
    this.loadedGrammarPath = path;
  }

  captureState(): LigerWorkspaceState | null {
    if (!this.textarea || !this.ligerRules) {
      return this.pendingState;
    }

    return {
      sentence: this.textarea.nativeElement.value ?? this.defaultValue,
      sequenceSentences: [...this.sequenceSentences],
      sequenceSentenceIds: [...this.sequenceSentenceIds],
      parsedSentenceStructures: this.parsedSentenceStructures,
      rulesText: this.ligerRules.getContent(),
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
    if (!state || !this.textarea || !this.ligerRules || !this.cy1) {
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
    this.parsedSentenceStructures = Array.isArray(state.parsedSentenceStructures)
      ? state.parsedSentenceStructures as LigerStructure[][]
      : [];
    this.textarea.nativeElement.value = this.defaultValue;
    this.ligerRules.updateContent(state.rulesText || '');
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

  private cacheParsedSentenceStructures(solutions: LigerSolutionAnnotation[]): void {
    const sentenceMaps: Array<Map<string, LigerStructure>> = [];
    solutions.forEach(solution => {
      solution.sequenceAnalysis?.sentences.forEach((sentence, index) => {
        const sentenceMap = sentenceMaps[index] ?? new Map<string, LigerStructure>();
        sentenceMaps[index] = sentenceMap;
        sentence.syntax.forEach(syntax => {
          if (syntax.structure) {
            sentenceMap.set(syntax.synId, syntax.structure);
          }
        });
      });
    });
    this.parsedSentenceStructures = sentenceMaps.map(sentenceMap =>
      Array.from(sentenceMap.values()));
  }

}
