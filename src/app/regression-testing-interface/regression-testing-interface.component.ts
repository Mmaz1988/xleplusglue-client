import { Component, ViewChild, ElementRef, AfterViewInit, OnDestroy } from '@angular/core';
import { DataService } from "../data.service";
import { GraphVisComponent } from "../liger-vis/liger-graph-vis/graph-vis.component";
import {
  LigerRuleAnnotation,
  GswbMultipleRequest,
  GswbBatchOutput,
  GswbOutput,
  RegressionInferenceResult,
  RegressionParseResult,
  RegressionTestingSession,
  createRegressionTestingSession,
  nliItem,
  vampireMultipleRequest,
  check,
  VampireSessionSummary
} from '../models/models';
import { GswbSettingsComponent } from "../gswb-vis/gswb-settings/gswb-settings.component";
import { EditorComponent } from "../editor/editor.component";
import { catchError, EMPTY, Observable, forkJoin } from "rxjs";
import { tap } from "rxjs/operators";
import { InferenceSettingsComponent } from "../inference-interface/inference-settings/inference-settings.component";
import {SemvisDialogComponent} from "../utilities/semvis-dialog/semvis-dialog.component";

@Component({
  selector: 'app-regression-testing-interface',
  templateUrl: './regression-testing-interface.component.html',
  styleUrls: ['./regression-testing-interface.component.css']
})
export class RegressionTestingInterfaceComponent implements AfterViewInit, OnDestroy {

  constructor(private dataService: DataService) {}

  session: RegressionTestingSession = createRegressionTestingSession();

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

  inferenceSummary = "";
  loading: boolean = false;
  private vampireSummaryPollTimer: ReturnType<typeof setInterval> | null = null;
  private vampirePendingItemCount: number | null = null;
  private activeVampireRunStartedAt: number | null = null;

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
  get disambiguationMode(): boolean {
    return this.session.disambiguationMode;
  }

  set disambiguationMode(value: boolean) {
    this.session.disambiguationMode = value;
  }

  get regressionTestResults(): RegressionParseResult[] {
    return this.session.regressionTestResults;
  }

  set regressionTestResults(value: RegressionParseResult[]) {
    this.session.regressionTestResults = value;
  }

  get inferenceResults(): RegressionInferenceResult[] {
    return this.session.inferenceResults;
  }

  set inferenceResults(value: RegressionInferenceResult[]) {
    this.session.inferenceResults = value;
  }

  get regressionTestItems(): any[] {
    return this.session.regressionTestItems;
  }

  set regressionTestItems(value: any[]) {
    this.session.regressionTestItems = value;
  }

  get sentenceMap(): Record<string, string> {
    return this.session.sentenceMap;
  }

  set sentenceMap(value: Record<string, string>) {
    this.session.sentenceMap = value;
  }

  get sortedMCmap(): Record<string, any> {
    return this.session.sortedMCmap;
  }

  set sortedMCmap(value: Record<string, any>) {
    this.session.sortedMCmap = value;
  }

  // sentenceId -> selected solution IDs
  // session stores parse, inference, and selection state as JSON-friendly data

  // Tune these numbers to match your row heights (in px)
  itemSizeParse = 220;  // app-test-result row height estimate
  itemSizeInfer = 180;  // app-inference-result row height estimate

// Prefetch buffer (smoother scrolling)
  minBufferPx = 600;
  maxBufferPx = 1200;

  // Called from template on each <app-test-result ... (selectionChange)="onSelectionChange($event)">
  onSelectionChange(ev: { sentenceId: string; selectedSolutionIds: string[] }) {
    if (!ev?.sentenceId) return;
    this.session.selectedSolutionIdsBySentence[ev.sentenceId] = [...(ev.selectedSolutionIds ?? [])];
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

  private get redisSessionKey(): string {
    return this.session.redisSessionKey || 'last_session';
  }

  ngOnDestroy(): void {
    this.stopVampireSummaryPolling();
  }

  // Button handler (appears only when disambiguationMode is true)
  continueAfterDisambiguation(): void {
    this.runVampireFromCurrentState(/*useDisambiguated*/ true);
  }

  // Optional: allow skipping disambiguation
  skipDisambiguation(): void {
    this.runVampireFromCurrentState(/*useDisambiguated*/ false);
  }

  resendVampire(): void {
    if (!this.hasParsedExamples) return;
    this.runVampireFromCurrentState(/*useDisambiguated*/ true);
  }

  get hasParsedExamples(): boolean {
    return this.regressionTestResults.length > 0;
  }

  get vampireDiscriminantStatus(): string {
    if (!this.hasParsedExamples) return '';
    if (!this.session.hasRunVampire) return 'Vampire has not been run yet.';

    return this.haveDiscriminantSelectionsChangedSinceLastVampire()
      ? 'Discriminant selections have changed since the last Vampire call.'
      : 'Discriminant selections are unchanged since the last Vampire call.';
  }

  get canResendVampire(): boolean {
    return this.hasParsedExamples && !this.loading && !!this.session.lastGswbOutputs;
  }

  get hasTimingInfo(): boolean {
    return this.session.timing.parseMs !== null || this.session.timing.totalMs !== null;
  }

  get processingTimingSummary(): string {
    const timing = this.session.timing;

    if (timing.totalMs !== null) {
      return `Overall ${this.formatDuration(timing.totalMs)}`;
    }

    if (timing.parseMs !== null) {
      return `Parse ${this.formatDuration(timing.parseMs)} · Vampire pending`;
    }

    return '';
  }

  get processingTimingDetails(): string {
    const timing = this.session.timing;
    const lines: string[] = [];

    if (timing.startedAt) lines.push(`Started: ${timing.startedAt}`);
    if (timing.parseMs !== null) lines.push(`Parse phase: ${this.formatDuration(timing.parseMs, true)}`);
    if (timing.vampireMs !== null) lines.push(`Vampire phase: ${this.formatDuration(timing.vampireMs, true)}`);
    if (timing.totalMs !== null) lines.push(`Overall: ${this.formatDuration(timing.totalMs, true)}`);

    return lines.join('\n');
  }

  batchParse(sentences: string, rules: string) {
    if (this.runLocked) return;
    this.errorhandle.nativeElement.innerHTML = "";
    this.loading = true;
    const runStartedAt = Date.now();

    this.session.timing = {
      startedAt: new Date(runStartedAt).toISOString(),
      parseMs: null,
      vampireMs: null,
      totalMs: null,
    };

    this.regressionTestResults = [];
    this.regressionTestItems = [];
    this.inferenceResults = [];
    this.inferenceSummary = "";
    this.updateConfusionMatrixView(Array.from({ length: 3 }, () => Array(3).fill(0)));

    // reset disambiguation state per run
    this.session.disambiguationMode = false;
    this.session.selectedSolutionIdsBySentence = {};
    this.session.lastGswbOutputs = null;
    this.session.lastAnnotations = null;
    this.session.lastVampireScopeIdsBySentence = {};
    this.session.lastVampireMcIdsBySentence = {};
    this.session.hasRunVampire = false;
    this.session.sortedMCmap = {};
    this.session.selectedScopeIdsBySentence = {};
    this.session.selectedMcIdsBySentence = {};

    this.dataService.resetLastSession(this.redisSessionKey).subscribe({
      next: () => console.log(`Reset Redis session ${this.redisSessionKey}`),
      error: error => console.warn("Unable to reset Redis session before parse.", error)
    });



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

          const gswbOutputs: Record<string, GswbOutput> = { ...outputs };

          let successCount = 0;
          let successFullKeys: string[] = [];

          const currentRegressionTestResults: RegressionParseResult[] = [];

          for (let key of Object.keys(this.sentenceMap)) {
            const out = gswbOutputs[key];
            const sols = out?.solutions ?? [];

            if (sols.length > 0) {
              successCount++;
              successFullKeys.push(key);
            }

            // Seed selection map to "ALL solution IDs" initially.
            // TestResult will later emit updates if user filters.
            this.session.selectedSolutionIdsBySentence[key] = sols.map(s => s.id);

            const regressionTestResult: RegressionParseResult = {
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

          this.session.timing.parseMs = Date.now() - runStartedAt;

          console.log("Successful keys: ", successFullKeys);
          const quickReport =
            "Parsed " + successCount + " of " + (Object.keys(this.sentenceMap).length) + " sentences! \n";

          this.loading = false;
          this.displayMessage(quickReport + "Batch processing completed successfully.", "green");

          // Stash state for resuming after disambiguation
          this.session.lastGswbOutputs = gswbOutputs;
          this.session.lastAnnotations = data.annotations;
          this.session.lastLogicType = logicType;

          // ========= PAUSE HERE if flag is set =========
          if (this.enableDisambiguation) {
            this.session.disambiguationMode = true;
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
    if (!this.session.lastGswbOutputs || !this.session.lastAnnotations) {
      console.warn("No stored GSWB/LiGER state to proceed to Vampire.");
      return;
    }

    const gswbOutputs = this.session.lastGswbOutputs;
    const annotations = this.session.lastAnnotations;
    const logicType = this.session.lastLogicType;
    const vampireStartedAt = Date.now();

    this.session.lastVampireScopeIdsBySentence = this.cloneSelectionRecord(this.session.selectedScopeIdsBySentence);
    this.session.lastVampireMcIdsBySentence = this.cloneSelectionRecord(this.session.selectedMcIdsBySentence);
    this.session.hasRunVampire = true;

    this.session.disambiguationMode = false;

    this.displayMessage("Sending NLI items to Vampire ...", "blue");
    console.log("Preparing call to Vampire ...");

    const inference_items: Record<string, nliItem> = {};

    for (let item of this.regressionTestItems) {
      let axioms = this.axiomEdit.getContent();
      let axiomCounter = 0;

      const premise_strings: string[] = [];
      for (let premise of item.premises) {
        if (gswbOutputs[premise] && gswbOutputs[premise].solutions.length > 0) {
          const sols = this.getSolutionsText(premise, gswbOutputs, useDisambiguated);
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
        if (gswbOutputs[conclusion] && gswbOutputs[conclusion].solutions.length > 0) {
          const sols = this.getSolutionsText(conclusion, gswbOutputs, useDisambiguated);
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
    this.vampirePendingItemCount = Object.keys(inference_items).length;
    this.activeVampireRunStartedAt = vampireStartedAt;
    this.startVampireSummaryPolling(vampireStartedAt);
    this.loadAndRenderVampireState(false, vampireStartedAt);

    this.batchVampire(vampireRequest).subscribe({
      next: () => {
        this.stopVampireSummaryPolling();
        this.loadAndRenderVampireState(true, vampireStartedAt);
      },
      error: () => {
        this.stopVampireSummaryPolling();
        this.vampirePendingItemCount = null;
        this.activeVampireRunStartedAt = null;
        this.loading = false;
      }
    });
  }

  private getSolutionsText(
    sentenceId: string,
    gswbOutputs: Record<string, GswbOutput>,
    useDisambiguated: boolean
  ): string[] {
    const sols = gswbOutputs[sentenceId]?.solutions ?? [];

    if (!useDisambiguated) return sols.map(x => x.solution);

    const selectedIds = this.session.selectedSolutionIdsBySentence[sentenceId];

    // If nothing selected, default to ALL (safe fallback)
    if (!selectedIds || selectedIds.length === 0) return sols.map(x => x.solution);

    const sel = new Set(selectedIds);
    return sols.filter(x => sel.has(x.id)).map(x => x.solution);
  }

  private startVampireSummaryPolling(vampireStartedAt: number): void {
    this.stopVampireSummaryPolling();

    this.vampireSummaryPollTimer = setInterval(() => {
      this.loadAndRenderVampireState(false, vampireStartedAt);
    }, 15000);
  }

  private stopVampireSummaryPolling(): void {
    if (this.vampireSummaryPollTimer !== null) {
      clearInterval(this.vampireSummaryPollTimer);
      this.vampireSummaryPollTimer = null;
    }
  }

  private loadAndRenderVampireState(finalSnapshot: boolean, vampireStartedAt: number): void {
    if (!this.loading && !finalSnapshot) return;
    const runToken = this.activeVampireRunStartedAt;

    forkJoin({
      session: this.dataService.getLastSession(this.redisSessionKey),
      summary: this.dataService.getLastSessionSummary(this.redisSessionKey)
    }).subscribe({
      next: ({ session, summary }) => {
        if (runToken !== this.activeVampireRunStartedAt) return;

        this.renderVampireResults(session?.results ?? {}, summary, finalSnapshot);

        const processedItems = summary?.item_count ?? 0;
        const proofCount = summary?.proof_count ?? 0;
        const totalItems = this.vampirePendingItemCount ?? this.regressionTestItems.length;
        const message = `Vampire progress: ${processedItems} of ${totalItems} items processed, ${proofCount} proofs processed so far.`;

        console.log(message);
        this.displayMessage(message, finalSnapshot ? "green" : "blue");

        if (finalSnapshot) {
          this.session.timing.vampireMs = Date.now() - vampireStartedAt;
          if (this.session.timing.startedAt) {
            this.session.timing.totalMs = Date.now() - new Date(this.session.timing.startedAt).getTime();
          }
          this.loading = false;
          this.vampirePendingItemCount = null;
          this.activeVampireRunStartedAt = null;
        }
      },
      error: error => {
        if (runToken !== this.activeVampireRunStartedAt) return;

        console.warn("Unable to load Vampire progress summary.", error);
        if (finalSnapshot) {
          this.loading = false;
          this.vampirePendingItemCount = null;
          this.activeVampireRunStartedAt = null;
          this.displayMessage("Batch processing completed, but Redis state could not be reloaded.", "red");
        }
      }
    });
  }

  private renderVampireResults(results: Record<string, check[]>, summary: VampireSessionSummary, finalSnapshot: boolean): void {
    const idx = { '1': 0, '0': 1, '-1': 2 };
    const cm = Array.from({ length: 3 }, () => Array(3).fill(0));
    this.cellIds = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => []));

    this.selectedIds.clear();
    this.selectedGoldIdx = this.selectedPredIdx = null;

    let all_entailment_predictions = 0;
    let all_neutral_predictions = 0;
    let all_contradiction_predictions = 0;

    let successful_entailment_predictions = 0;
    let successful_neutral_predictions = 0;
    let successful_contradiction_predictions = 0;

    const currentInferenceResults: RegressionInferenceResult[] = [];

    for (const testItem of this.regressionTestItems) {
      const value = results?.[testItem.id];
      if (!value || value.length === 0) continue;

      const infoCount = value.filter(check => check.informative).length;
      const consistentCount = value.filter(check => check.consistent).length;
      const glyphs: string[] = value.map(check => check.glyph);

      const infoSuccess = infoCount > value.length / 2;
      const consistentSuccess = consistentCount > value.length / 2;

      let entailment_label = '0';
      if (infoSuccess && consistentSuccess) entailment_label = '0';
      else if (!infoSuccess && consistentSuccess) entailment_label = '1';
      else if (!consistentSuccess) entailment_label = '-1';

      if (testItem.gold_label === entailment_label) {
        if (entailment_label === '1') successful_entailment_predictions++;
        else if (entailment_label === '0') successful_neutral_predictions++;
        else if (entailment_label === '-1') successful_contradiction_predictions++;
      }

      if (testItem.gold_label === '1') all_entailment_predictions++;
      else if (testItem.gold_label === '0') all_neutral_predictions++;
      else if (testItem.gold_label === '-1') all_contradiction_predictions++;

      const premiseSentences: string[] = (testItem?.premises ?? [])
        .map((sid: string) => this.sentenceMap[sid])
        .filter((s: any) => typeof s === 'string' && s.trim().length > 0);

      const conclusionSentences: string[] = (testItem?.conclusion ?? [])
        .map((sid: string) => this.sentenceMap[sid])
        .filter((s: any) => typeof s === 'string' && s.trim().length > 0);

      currentInferenceResults.push({
        id: testItem.id,
        premises: premiseSentences,
        conclusion: conclusionSentences.join(' '),
        predictedLabel: entailment_label,
        goldLabel: testItem?.gold_label ?? 'unknown',
        premiseIds: testItem?.premises ?? [],
        conclusionIds: testItem?.conclusion ?? [],
        mismatch: (testItem?.gold_label ?? '') !== entailment_label,
        glyphs: glyphs
      });

      if (idx[testItem.gold_label] !== undefined && idx[entailment_label] !== undefined) {
        const gi = idx[testItem.gold_label];
        const pj = idx[entailment_label];
        cm[gi][pj] += 1;
        this.cellIds[gi][pj].push(testItem.id);
      }
    }

    this.inferenceResults = currentInferenceResults;
    this.updateConfusionMatrixView(cm, Object.keys(results ?? {}).length);

    const processedItems = summary?.item_count ?? Object.keys(results ?? {}).length;
    const proofCount = summary?.proof_count ?? 0;
    const totalItems = this.vampirePendingItemCount ?? this.regressionTestItems.length;

    this.inferenceSummary =
      `${finalSnapshot ? 'Inference results summary' : 'Vampire progress'}:\n` +
      `Processed items: ${processedItems} of ${totalItems}\n` +
      `Processed proofs: ${proofCount}\n` +
      `Entailment accuracy: ${all_entailment_predictions === 0 ? 'n/a' : successful_entailment_predictions / all_entailment_predictions}\n` +
      `Neutral accuracy: ${all_neutral_predictions === 0 ? 'n/a' : successful_neutral_predictions / all_neutral_predictions}\n` +
      `Contradiction accuracy: ${all_contradiction_predictions === 0 ? 'n/a' : successful_contradiction_predictions / all_contradiction_predictions}`;
  }

  private formatDuration(ms: number | null, precise = false): string {
    if (ms === null || Number.isNaN(ms)) return 'n/a';

    if (ms < 1000) return `${Math.round(ms)}ms`;
    const seconds = ms / 1000;
    return precise ? `${seconds.toFixed(2)}s` : `${seconds.toFixed(1)}s`;
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

  batchVampire(vampireMultipleRequest: vampireMultipleRequest): Observable<any> {
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
    const fromUser = this.session.selectedSolutionIdsBySentence[element.sentence_id];
    if (fromUser !== undefined) return fromUser;

    const sols = element?.gswbSolutions ?? [];
    return Array.isArray(sols) ? sols.map((s: any) => String(s.id)) : [];
  }

  onSemvisSelectionChange(ev: { sentenceId: string; items: { id: string }[]; selectedScopeIds: string[]; selectedMcIds: string[] }) {
    const sid = ev.sentenceId;

    // persist solution IDs
    this.session.selectedSolutionIdsBySentence[sid] = (ev.items ?? []).map(x => x.id);

    // persist discriminant selection state
    this.session.selectedScopeIdsBySentence[sid] = [...(ev.selectedScopeIds ?? [])];
    this.session.selectedMcIdsBySentence[sid] = [...(ev.selectedMcIds ?? [])];
  }

  private cloneSelectionRecord(source: Record<string, string[]>): Record<string, string[]> {
    const copy: Record<string, string[]> = {};
    Object.entries(source).forEach(([sid, ids]) => { copy[sid] = [...ids]; });
    return copy;
  }

  private haveDiscriminantSelectionsChangedSinceLastVampire(): boolean {
    return this.selectionRecordsDiffer(this.session.selectedScopeIdsBySentence, this.session.lastVampireScopeIdsBySentence)
      || this.selectionRecordsDiffer(this.session.selectedMcIdsBySentence, this.session.lastVampireMcIdsBySentence);
  }

  private selectionRecordsDiffer(current: Record<string, string[]>, previous: Record<string, string[]>): boolean {
    const currentKeys = Object.keys(current);
    const previousKeys = Object.keys(previous);
    if (currentKeys.length !== previousKeys.length) return true;

    for (const sentenceId of currentKeys) {
      const prior = previous[sentenceId];
      if (!prior) return true;

      if (!this.sameSelectionIds(current[sentenceId], prior)) return true;
    }

    return false;
  }

  private sameSelectionIds(left: string[], right: string[]): boolean {
    if (left.length !== right.length) return false;

    const normalize = (ids: string[]) => [...new Set(ids.map(id => String(id)))].sort();
    const a = normalize(left);
    const b = normalize(right);

    if (a.length !== b.length) return false;
    return a.every((id, index) => id === b[index]);
  }

  openSemVisDialog(payload: any): void {
    const sid = payload.sentenceId;

    this.semvisDialog.open({
      ...payload,
      selectedScopeIds: this.session.selectedScopeIdsBySentence[sid] ?? [],
      selectedMcIds: this.session.selectedMcIdsBySentence[sid] ?? [],
    });
  }



}
