import { Component, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { DataService } from "../data.service";
import { GraphVisComponent } from "../liger-vis/liger-graph-vis/graph-vis.component";
import {
  LigerRuleAnnotation,
  GswbMultipleRequest,
  GswbBatchOutput,
  GswbOutput,
  nliItem,
  vampireMultipleRequest,
  vampireMultipleResponse,
  check
} from '../models/models';
import { GswbSettingsComponent } from "../gswb-vis/gswb-settings/gswb-settings.component";
import { EditorComponent } from "../editor/editor.component";
import { catchError, EMPTY, Observable } from "rxjs";
import { tap } from "rxjs/operators";
import { InferenceSettingsComponent } from "../inference-interface/inference-settings/inference-settings.component";
import {SemvisDialogComponent} from "../utilities/semvis-dialog/semvis-dialog.component";

@Component({
  selector: 'app-regression-testing-interface',
  templateUrl: './regression-testing-interface.component.html',
  styleUrls: ['./regression-testing-interface.component.css']
})
export class RegressionTestingInterfaceComponent implements AfterViewInit {

  constructor(private dataService: DataService) {}

  @ViewChild('arcy') cy1: GraphVisComponent;
  @ViewChild('ligerreport') ligerreport: ElementRef;
  @ViewChild('gswbreport') gswbreport: ElementRef;
  @ViewChild('gswbSettings') gswbPreferences: GswbSettingsComponent;

  @ViewChild('vampirePrefs') vampirePreferences!: InferenceSettingsComponent;
  @ViewChild('contextPruning') contextPruning!: ElementRef;
  @ViewChild('axiomEdit') axiomEdit: EditorComponent;

  @ViewChild('testfile') testfile: EditorComponent;
  @ViewChild('ligerRules') ligerRules: EditorComponent;
  @ViewChild('errorhandle') errorhandle: ElementRef;

  @ViewChild('semvisDialog') semvisDialog: SemvisDialogComponent;

  gswbMultipleRequest: GswbMultipleRequest;

  regressionTestResults: any[] = [];
  inferenceResults: any[] = [];
  inferenceSummary = "";
  regressionTestItems: any[] = [];

  sentenceMap = {};
  loading: boolean = false;

  labels = ['1', '0', '-1'] as const;
  labelName = { '1': 'Entailment', '0': 'Neutral', '-1': 'Contradiction' } as const;

  cmView: {
    gold: string;
    rows: {
      pred: string;
      v: number;
      pct: string;
      intensity: number;
      diag: boolean;
    }[];
  }[] = [];

  cellIds: string[][][] = Array.from({ length: 3 }, () =>
    Array.from({ length: 3 }, () => [])
  );

  // =========================
  // NEW: disambiguation controls
  // =========================
  enableDisambiguation = false; // bind to checkbox in HTML
  disambiguationMode = false;   // show "Continue" button when true

  // sentenceId -> selected solution IDs
  private selectedSolutionIdsBySentence = new Map<string, string[]>();
  private selectedScopeIdsBySentence = new Map<string, string[]>();
  private selectedMcIdsBySentence = new Map<string, string[]>();


  // stash state after GSWB so we can resume later
  private lastGswbMap: Map<string, GswbOutput> | null = null;
  private lastAnnotations: Record<string, LigerRuleAnnotation> | null = null;
  private lastLogicType: 'fof' | 'tff' = 'fof';

  private sortedMCmap= {};

  // Tune these numbers to match your row heights (in px)
  itemSizeParse = 220;  // app-test-result row height estimate
  itemSizeInfer = 180;  // app-inference-result row height estimate

// Prefetch buffer (smoother scrolling)
  minBufferPx = 600;
  maxBufferPx = 1200;

  // Called from template on each <app-test-result ... (selectionChange)="onSelectionChange($event)">
  onSelectionChange(ev: { sentenceId: string; selectedSolutionIds: string[] }) {
    if (!ev?.sentenceId) return;
    this.selectedSolutionIdsBySentence.set(ev.sentenceId, ev.selectedSolutionIds ?? []);
  }

  ngAfterViewInit() {
    if (this.gswbPreferences) {
      this.gswbPreferences.gswbPreferences = {
        prover: 1,
        debugging: false,
        outputstyle: 4,
        parseSem: false,
        resolveDrs: true,
        betaReduce: true,
        glueOnly: false,
        meaningOnly: false,
        explainFail: false,
        naturalDeductionStyle: 0,
      };
      this.gswbPreferences.updateFormFromPreferences(this.gswbPreferences.gswbPreferences);
    } else {
      console.error("ERROR: `gswbPreferences` ViewChild not initialized!");
    }

    if (this.vampirePreferences) {
      this.vampirePreferences.vampirePreferences = {
        logic_type: 0,
        model_building: true,
        max_duration: 10,
        layered: false
      };
      this.vampirePreferences.updateFormFromPreferences(this.vampirePreferences.vampirePreferences);
    } else {
      console.error("ERROR: `vampirePreferences` ViewChild not initialized!");
    }
  }

  // Button handler (appears only when disambiguationMode is true)
  continueAfterDisambiguation(): void {
    this.runVampireFromCurrentState(/*useDisambiguated*/ true);
  }

  // Optional: allow skipping disambiguation
  skipDisambiguation(): void {
    this.runVampireFromCurrentState(/*useDisambiguated*/ false);
  }

  batchParse(sentences: string, rules: string) {
    if (this.runLocked) return;
    this.errorhandle.nativeElement.innerHTML = "";
    this.loading = true;

    this.regressionTestResults = [];
    this.regressionTestItems = [];
    this.inferenceResults = [];
    this.inferenceSummary = "";
    this.updateConfusionMatrixView(Array.from({ length: 3 }, () => Array(3).fill(0)));

    // reset disambiguation state per run
    this.disambiguationMode = false;
    this.selectedSolutionIdsBySentence.clear();
    this.lastGswbMap = null;
    this.lastAnnotations = null;
    this.sortedMCmap = {};
    this.selectedSolutionIdsBySentence = new Map<string, string[]>();
    this.selectedScopeIdsBySentence = new Map<string, string[]>();
    this.selectedMcIdsBySentence = new Map<string, string[]>();



    this.gswbPreferences.onSubmit();

    const logicType: 'fof' | 'tff' =
      this.vampirePreferences.vampirePreferences.logic_type === 0 ? 'fof' : 'tff';

    this.parse_testfile(sentences);

    this.displayMessage("Sending testsuite to LiGER for parsing ...", "blue");

    const ligerMultipleRequest = { sentences: this.sentenceMap, ruleString: rules, logicType: logicType };

    this.dataService.ligerBatchAnnotate(ligerMultipleRequest).subscribe(
      data => {
        if (data.hasOwnProperty("annotations")) {
          console.log("Annotations:", data.annotations);

          let mcMap = {};
          for (let [key, value] of Object.entries(data.annotations) as [string, LigerRuleAnnotation][]) {
            mcMap[key] = value.meaningConstructors;
          }

          let sortedMcMap = {};
          Object.keys(mcMap).sort((a, b) => {
            let aNum = parseInt(a.match(/\d+/)[0]);
            let bNum = parseInt(b.match(/\d+/)[0]);
            return aNum - bNum;
          }).forEach(key => {
            sortedMcMap[key] = mcMap[key];
          });

          this.sortedMCmap = sortedMcMap;

          this.gswbMultipleRequest = {
            premises: sortedMcMap,
            gswbPreferences: this.gswbPreferences.gswbPreferences
          };
        }

        if (data.hasOwnProperty("ruleApplicationGraph")) {
          console.log("Rule application graph: ", data.ruleApplicationGraph);
          this.cy1.renderGraph(data.ruleApplicationGraph);
        }

        this.displayMessage("Sending parsing results to GSWB for deduction ...", "blue");

        this.batchDeduce(this.gswbMultipleRequest).subscribe((result: GswbBatchOutput) => {
          const outputs = result.outputs;
          console.log("GSWB outputs: ", outputs);

          const gswbMap = new Map<string, GswbOutput>();
          for (const key in outputs) {
            gswbMap.set(key, outputs[key]);
          }

          let successCount = 0;
          let successFullKeys: string[] = [];

          let currentRegressionTestResults = [];

          for (let key of Object.keys(this.sentenceMap)) {
            const out = gswbMap.get(key);
            const sols = out?.solutions ?? [];

            if (sols.length > 0) {
              successCount++;
              successFullKeys.push(key);
            }

            // Seed selection map to "ALL solution IDs" initially.
            // TestResult will later emit updates if user filters.
            this.selectedSolutionIdsBySentence.set(key, sols.map(s => s.id));

            const regressionTestResult = {
              sentence_id: key,
              sentence: this.sentenceMap[key],
              noOfAppliedRules: data.annotations[key].appliedRules.length,
              noOfMCsets: data.annotations[key].numberOfMCsets,
              noOfSolutions: sols.length,
              ligerGraph: data.annotations[key].graph,
              ligerMCsets: data.annotations[key].meaningConstructors,
              allMCs: this.sortedMCmap[key],
              gswbSolutions: sols,
              gswbDerivation: out.derivation,
              result_type: 'parseResult',
              discriminants: out.discriminants
            };

            currentRegressionTestResults.push(regressionTestResult);
          }

          this.regressionTestResults = currentRegressionTestResults;

          console.log("Successful keys: ", successFullKeys);
          const quickReport =
            "Parsed " + successCount + " of " + (Object.keys(this.sentenceMap).length) + " sentences! \n";

          this.loading = false;
          this.displayMessage(quickReport + "Batch processing completed successfully.", "green");

          // Stash state for resuming after disambiguation
          this.lastGswbMap = gswbMap;
          this.lastAnnotations = data.annotations;
          this.lastLogicType = logicType;

          // ========= PAUSE HERE if flag is set =========
          if (this.enableDisambiguation) {
            this.disambiguationMode = true;
            this.displayMessage(
              "Disambiguation enabled: open solutions dialogs, select discriminants, then click Continue.",
              "blue"
            );
            return;
          }

          // Otherwise proceed immediately with ALL solutions
          this.runVampireFromCurrentState(false);
        });
      },
      error => {
        console.error('An error occurred:', error);
        this.displayMessage("An error occurred during batch parsing.", "red");
        this.loading = false;
      }
    );
  }

  // Builds NLI items + runs Vampire.
  // If useDisambiguated=true, filters each sentence’s solutions by selectedSolutionIdsBySentence.
  private runVampireFromCurrentState(useDisambiguated: boolean): void {
    if (!this.lastGswbMap || !this.lastAnnotations) {
      console.warn("No stored GSWB/LiGER state to proceed to Vampire.");
      return;
    }

    const gswbMap = this.lastGswbMap;
    const annotations = this.lastAnnotations;
    const logicType = this.lastLogicType;

    this.disambiguationMode = false;

    this.displayMessage("Sending NLI items to Vampire ...", "blue");
    console.log("Preparing call to Vampire ...");

    const inference_items: Record<string, nliItem> = {};

    for (let item of this.regressionTestItems) {
      let axioms = this.axiomEdit.getContent();
      let axiomCounter = 0;

      const premise_strings: string[] = [];
      for (let premise of item.premises) {
        if (gswbMap.has(premise) && gswbMap.get(premise).solutions.length > 0) {
          const sols = this.getSolutionsText(premise, gswbMap, useDisambiguated);
          if (sols.length > 0) premise_strings.push(sols.join('\n'));

          const liger_data = annotations[premise];
          if (liger_data?.axioms?.length) {
            for (let axiom of liger_data.axioms) {
              if (axiom.trim() !== '' && !axioms.includes(axiom.trim())) {
                axioms += logicType + "(" +
                  "axiom" + axiomCounter + ",axiom," + axiom + ').\n';
                axiomCounter++;
              }
            }
          } else {
            // optional: console.log("No axioms for premise:", premise);
          }
        }
      }

      const conclusion_strings: string[] = [];
      for (let conclusion of item.conclusion) {
        if (gswbMap.has(conclusion) && gswbMap.get(conclusion).solutions.length > 0) {
          const sols = this.getSolutionsText(conclusion, gswbMap, useDisambiguated);
          if (sols.length > 0) conclusion_strings.push(sols.join('\n'));

          const liger_data = annotations[conclusion];
          if (liger_data?.axioms?.length) {
            for (let axiom of liger_data.axioms) {
              if (axiom.trim() !== '' && !axioms.includes(axiom.trim())) {
                axioms += logicType + "(" +
                  "axiom" + axiomCounter + ",axiom," + axiom + ').\n';
                axiomCounter++;
              }
            }
          } else {
            // optional: console.log("No axioms for conclusion:", conclusion);
          }
        }
      }

      if (premise_strings.length > 0 && conclusion_strings.length > 0) {
        inference_items[item.id] = { premises: premise_strings, hypothesis: conclusion_strings, axioms: axioms };
      }
    }

    const pruning = this.contextPruning.nativeElement.checked;

    const vampireRequest: vampireMultipleRequest = {
      nli_items: inference_items,
      vampire_preferences: this.vampirePreferences.vampirePreferences,
      pruning: pruning
    };

    console.log("Vampire request: ", vampireRequest);
    this.loading = true;

    this.batchVampire(vampireRequest).subscribe((vampireResult: vampireMultipleResponse) => {
      this.handleVampireResult(vampireResult);
    });
  }

  private getSolutionsText(
    sentenceId: string,
    gswbMap: Map<string, GswbOutput>,
    useDisambiguated: boolean
  ): string[] {
    const sols = gswbMap.get(sentenceId)?.solutions ?? [];

    if (!useDisambiguated) return sols.map(x => x.solution);

    const selectedIds = this.selectedSolutionIdsBySentence.get(sentenceId);

    // If nothing selected, default to ALL (safe fallback)
    if (!selectedIds || selectedIds.length === 0) return sols.map(x => x.solution);

    const sel = new Set(selectedIds);
    return sols.filter(x => sel.has(x.id)).map(x => x.solution);
  }

  // ===== Vampire handling: kept from your code (moved into a method to avoid duplication) =====
  private handleVampireResult(vampireResult: vampireMultipleResponse): void {
    console.log("Vampire results: ", vampireResult);
    this.displayMessage("Batch processing completed successfully.", "green");

    const idx = { '1': 0, '0': 1, '-1': 2 };
    const cm = Array.from({ length: 3 }, () => Array(3).fill(0));

    this.selectedIds.clear();
    this.selectedGoldIdx = this.selectedPredIdx = null;

    let all_entailment_predictions = 0;
    let all_neutral_predictions = 0;
    let all_contradiction_predictions = 0;

    let successful_entailment_predictions = 0;
    let successful_neutral_predictions = 0;
    let successful_contradiction_predictions = 0;

    let currentInferenceResults: any[] = [];

    for (let [key, value] of Object.entries(vampireResult.results) as [string, check[]][]) {
      let infoCount = value.filter(check => check.informative).length;
      let consistentCount = value.filter(check => check.consistent).length;

      let glyphs: string[] = value.map(check => check.glyph);

      let infoSuccess = infoCount > value.length / 2;
      let consistentSuccess = consistentCount > value.length / 2;

      let entailment_label = '0';
      if (infoSuccess && consistentSuccess) entailment_label = '0';
      else if (!infoSuccess && consistentSuccess) entailment_label = '1';
      else if (!consistentSuccess) entailment_label = '-1';

      const testItem = this.regressionTestItems.find(item => item.id === key);

      if (testItem.gold_label === entailment_label) {
        if (entailment_label === '1') successful_entailment_predictions++;
        else if (entailment_label === '0') successful_neutral_predictions++;
        else if (entailment_label === '-1') successful_contradiction_predictions++;
      }

      if (testItem.gold_label === '1') all_entailment_predictions++;
      else if (testItem.gold_label === '0') all_neutral_predictions++;
      else if (testItem.gold_label === '-1') all_contradiction_predictions++;

      const gold = testItem.gold_label;
      const pred = entailment_label;

      const premiseSentences: string[] = (testItem?.premises ?? [])
        .map((sid: string) => this.sentenceMap[sid])
        .filter((s: any) => typeof s === 'string' && s.trim().length > 0);

      const conclusionSentences: string[] = (testItem?.conclusion ?? [])
        .map((sid: string) => this.sentenceMap[sid])
        .filter((s: any) => typeof s === 'string' && s.trim().length > 0);

      const conclusionString = conclusionSentences.join(' ');

      currentInferenceResults.push({
        id: key,
        premises: premiseSentences,
        conclusion: conclusionString,
        predictedLabel: entailment_label,
        goldLabel: testItem?.gold_label ?? 'unknown',
        premiseIds: testItem?.premises ?? [],
        conclusionIds: testItem?.conclusion ?? [],
        mismatch: (testItem?.gold_label ?? '') !== entailment_label,
        glyphs: glyphs
      });

      if (idx[gold] !== undefined && idx[pred] !== undefined) {
        const gi = idx[gold];
        const pj = idx[pred];
        cm[gi][pj] += 1;
        this.cellIds[gi][pj].push(key);
      } else {
        console.warn('Unknown label', { gold, pred });
      }
    }

    this.inferenceResults = currentInferenceResults;

    this.updateConfusionMatrixView(cm, Object.keys(vampireResult.results).length);

    this.inferenceSummary =
      "Inference results summary:\n" +
      "Successful entailment prediction ratio: " + successful_entailment_predictions / all_entailment_predictions +
      " (" + successful_entailment_predictions + " of " + all_entailment_predictions + ")\n" +
      "Successful neutral prediction ratio: " + successful_neutral_predictions / all_neutral_predictions +
      " (" + successful_neutral_predictions + " of " + all_neutral_predictions + ")\n" +
      "Successful contradiction prediction ratio: " + successful_contradiction_predictions / all_contradiction_predictions +
      " (" + successful_contradiction_predictions + " of " + all_contradiction_predictions + ")\n" +
      "Overall accuracy: " +
      (successful_entailment_predictions + successful_neutral_predictions + successful_contradiction_predictions) /
      Object.keys(vampireResult.results).length;

    this.loading = false;
  }

  // =========================
  // KEEP YOUR EXISTING FUNCTIONS BELOW (unchanged)
  // =========================

  batchMultistage(sentences: String) {
    if (this.runLocked) return;
    this.gswbPreferences.onSubmit();

    let sentencesArray = sentences.split("\n").filter(line => {
      let trimmedLine = line.trim();
      return trimmedLine !== '' && !trimmedLine.startsWith("#");
    });

    let sentenceMap = {};
    for (let i = 0; i < sentencesArray.length; i++) {
      sentenceMap["S" + i] = sentencesArray[i];
    }

    const ligerMultipleRequest = { sentences: sentenceMap, ruleString: null };

    this.dataService.ligerBatchMultistage(ligerMultipleRequest).subscribe(
      data => {
        console.log(data);
        if (data.hasOwnProperty("annotations")) {
          console.log(data.annotations);

          let mcMap = {};
          for (let [key, value] of Object.entries(data.annotations) as [string, LigerRuleAnnotation][]) {
            mcMap[key] = value.meaningConstructors;
          }

          this.gswbMultipleRequest = {
            premises: mcMap,
            gswbPreferences: this.gswbPreferences.gswbPreferences
          };

          console.log("Specified request: ", this.gswbMultipleRequest);
        }

        if (data.hasOwnProperty("report")) {
          this.ligerreport.nativeElement.innerHTML = data.report;
        }

        this.batchDeduce(this.gswbMultipleRequest);
      },
      error => {
        console.error('An error occurred:', error);
        this.loading = false;
      }
    );
  }

  updateRules(ruleFile: string) {
    this.ligerRules.updateContent(ruleFile);
  }

  updateTestsuite(ruleFile: string) {
    this.testfile.updateContent(ruleFile);
  }

  updateAxioms(ruleFile: string) {
    this.axiomEdit.updateContent(ruleFile);
  }

  batchVampire(vampireMultipleRequest: vampireMultipleRequest): Observable<vampireMultipleResponse> {
    return this.dataService.callBatchVampire(vampireMultipleRequest).pipe(
      tap(data => {
        console.log("Vampire data:", data);
      }),
      catchError(err => {
        console.error("An error occurred:", err);
        this.displayMessage("An error occurred during Vampire processing.", "red");
        this.loading = false;
        return EMPTY;
      })
    );
  }

  batchDeduce(gswbMultipleRequest: GswbMultipleRequest): Observable<GswbBatchOutput> {
    return this.dataService.gswbBatchDeduce(gswbMultipleRequest).pipe(
      tap(data => {
        console.log("Full data:", data);
        if (data.hasOwnProperty("outputs")) {
          console.log("Outputs map:");
          for (const key in data.outputs) {
            console.log(key, data.outputs[key]);
          }
        }
      }),
      catchError(err => {
        console.error("An error occurred:", err);
        this.displayMessage("An error occurred during GSWB deduction.", "red");
        this.loading = false;
        return EMPTY;
      })
    );
  }

  displayMessage(message: string, color: string) {
    this.errorhandle.nativeElement.style.color = color;
    this.errorhandle.nativeElement.innerHTML = "[" + new Date().toLocaleTimeString() + "] " + message;
  }


  parse_testfile(testfile: string) {
    try {
      this.parse_json_testfile(testfile);
    } catch (err) {
      this.parse_block_testfile(testfile);
    }
  }


  parse_block_testfile(testfile: string) {
    this.regressionTestItems = [];

    let parseItems: any[] = [];
    let lines = testfile.split('\n');

    let sentence_map = {};
    let sentence_id = 0;
    let item_id = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === '') continue;
      if (line.trim().startsWith('#')) continue;
      if (line.trim().length > 2) {
        sentence_map["S" + sentence_id] = line.trim();
        sentence_id++;
      }
      if (line.trim() === "{") {
        i++;
        let sentences: string[] = [];
        let premise_ids = [];
        let conclusion_ids = [];
        let gold_label = null;
        let premises: boolean = true;

        while (lines[i].trim() !== "}" && i < lines.length) {
          const innerLine = lines[i];
          if (innerLine.trim() === '') { i++; continue; }
          if (innerLine.trim().startsWith('}')) { break; }
          if (innerLine.trim().startsWith('#')) { i++; continue; }

          if (innerLine.trim() === "====") {
            premises = false;
            i++;
            continue;
          } else if (innerLine.trim().startsWith(">>>")) {
            gold_label = innerLine.trim().substring(3).trim();
          } else if (innerLine.trim().length > 2) {
            sentences.push(innerLine.trim());
            if (premises) {
              premise_ids.push('S' + sentence_id);
              sentence_map['S' + sentence_id] = innerLine.trim();
              sentence_id++;
            } else {
              conclusion_ids.push('S' + sentence_id);
              sentence_map['S' + sentence_id] = innerLine.trim();
              sentence_id++;
            }
          }
          i++;
        }

        let item = { id: "n" + item_id, sentences, premises: premise_ids, conclusion: conclusion_ids, gold_label };
        item_id++;
        parseItems.push(item);
      }
    }

    console.log("Sentence map:", sentence_map);
    this.sentenceMap = sentence_map;
    this.regressionTestItems.push(...parseItems);
  }

  parse_json_testfile(testfile: string) {
    this.regressionTestItems = [];

    let parseItems: any[] = [];
    let parsed = JSON.parse(testfile);

    if (!Array.isArray(parsed)) {
      throw new Error("JSON testfile must be a list.");
    }

    let sentence_map = {};
    let sentence_id = 0;
    let item_id = 0;

    for (let i = 0; i < parsed.length; i++) {
      const obj = parsed[i];

      if (!obj.premises || !Array.isArray(obj.premises)) {
        throw new Error("Each JSON item must have a premises array.");
      }

      let sentences: string[] = [];
      let premise_ids = [];
      let conclusion_ids = [];
      let gold_label = obj.gold_label ?? null;

      for (let j = 0; j < obj.premises.length; j++) {
        const premise = String(obj.premises[j]).trim();
        if (premise.length === 0) continue;

        sentences.push(premise);
        premise_ids.push("S" + sentence_id);
        sentence_map["S" + sentence_id] = premise;
        sentence_id++;
      }

      let conclusions = Array.isArray(obj.conclusion) ? obj.conclusion : [obj.conclusion];
      for (let j = 0; j < conclusions.length; j++) {
        const conclusion = String(conclusions[j]).trim();
        if (conclusion.length === 0) continue;

        sentences.push(conclusion);
        conclusion_ids.push("S" + sentence_id);
        sentence_map["S" + sentence_id] = conclusion;
        sentence_id++;
      }

      let item = {
        id: obj.id ?? "n" + item_id,
        sentences,
        premises: premise_ids,
        conclusion: conclusion_ids,
        gold_label
      };
      item_id++;
      parseItems.push(item);
    }

    console.log("Sentence map:", sentence_map);
    this.sentenceMap = sentence_map;
    this.regressionTestItems.push(...parseItems);
  }


  sortResultsByTrueCount(resultsObj: any): any {
    const sortedResults: any = { ...resultsObj };
    Object.keys(sortedResults.results).forEach(key => {
      sortedResults.results[key] = sortedResults.results[key].sort(
        (a: any, b: any) => this.countTrues(b) - this.countTrues(a)
      );
    });
    return sortedResults;
  }

  private countTrues(obj: any): number {
    return Object.values(obj).filter(v => v === true).length;
  }

  updateConfusionMatrixView(cm: number[][], total?: number): void {
    const denom =
      (typeof total === 'number' && total > 0)
        ? total
        : cm.reduce((acc, row) => acc + row.reduce((a, b) => a + b, 0), 0);

    this.cmView = this.labels.map((g, i) => ({
      gold: g,
      rows: this.labels.map((p, j) => {
        const v = cm[i][j];
        const pctNum = denom ? (100 * v) / denom : 0;
        return {
          pred: p,
          v,
          pct: pctNum.toFixed(1),
          intensity: pctNum / 100,
          diag: i === j,
        };
      }),
    }));
  }

  selectedGoldIdx: number | null = null;
  selectedPredIdx: number | null = null;
  selectedIds = new Set<string>();

  selectCell(gi: number, pj: number): void {
    if (this.selectedGoldIdx === gi && this.selectedPredIdx === pj) {
      this.clearSelection();
      return;
    }
    this.selectedGoldIdx = gi;
    this.selectedPredIdx = pj;
    this.selectedIds = new Set(this.cellIds[gi][pj] ?? []);
  }

  clearSelection(): void {
    this.selectedGoldIdx = this.selectedPredIdx = null;
    this.selectedIds.clear();
  }

  get runLocked(): boolean {
    return this.loading || (this.enableDisambiguation && this.disambiguationMode);
  }

  trackBySentenceId = (_: number, x: any) => x?.sentence_id ?? _;
  trackByInferenceId = (_: number, x: any) => x?.id ?? _;




  getSelectedSolutionIds(element: any): string[] {
    const fromUser = this.selectedSolutionIdsBySentence.get(element.sentence_id);
    if (fromUser) return fromUser;

    const sols = element?.gswbSolutions ?? [];
    return Array.isArray(sols) ? sols.map((s: any) => String(s.id)) : [];
  }

  onSemvisSelectionChange(ev: { sentenceId: string; items: { id: string }[]; selectedScopeIds: string[]; selectedMcIds: string[] }) {
    const sid = ev.sentenceId;

    // persist solution IDs
    this.selectedSolutionIdsBySentence.set(sid, (ev.items ?? []).map(x => x.id));

    // persist discriminant selection state
    this.selectedScopeIdsBySentence.set(sid, [...(ev.selectedScopeIds ?? [])]);
    this.selectedMcIdsBySentence.set(sid, [...(ev.selectedMcIds ?? [])]);
  }

  openSemVisDialog(payload: any): void {
    const sid = payload.sentenceId;

    this.semvisDialog.open({
      ...payload,
      selectedScopeIds: this.selectedScopeIdsBySentence.get(sid) ?? [],
      selectedMcIds: this.selectedMcIdsBySentence.get(sid) ?? [],
    });
  }



}
