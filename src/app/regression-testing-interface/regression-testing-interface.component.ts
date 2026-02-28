import {Component, ViewChild, ElementRef, AfterViewInit} from '@angular/core';
import {DataService} from "../data.service";
import {GraphVisComponent} from "../liger-vis/liger-graph-vis/graph-vis.component";
import {
  LigerBatchParsingAnalysis,
  LigerRule,
  LigerRuleAnnotation,
  LigerWebGraph,
  LigerGraphComponent,
  GswbPreferences,
  GswbMultipleRequest,
  GswbBatchOutput,
  GswbOutput,
  nliItem,
  vampireMultipleRequest,
  vampireMultipleResponse, context, check
} from '../models/models';
import {GswbSettingsComponent} from "../gswb-vis/gswb-settings/gswb-settings.component";
import {EditorComponent} from "../editor/editor.component";
import {catchError, EMPTY, map, Observable} from "rxjs";
import {tap} from "rxjs/operators";
import {InferenceSettingsComponent} from "../inference-interface/inference-settings/inference-settings.component";
import {coerceStringArray} from "@angular/cdk/coercion";


@Component({
  selector: 'app-regression-testing-interface',
  templateUrl: './regression-testing-interface.component.html',
  styleUrls: ['./regression-testing-interface.component.css']
})
export class RegressionTestingInterfaceComponent {

  constructor(private dataService: DataService) {
  }


  @ViewChild('arcy') cy1: GraphVisComponent;
  @ViewChild('ligerreport') ligerreport: ElementRef;
  @ViewChild('gswbreport') gswbreport: ElementRef;
  @ViewChild('gswbSettings') gswbPreferences: GswbSettingsComponent

  @ViewChild('vampirePrefs') vampirePreferences!: InferenceSettingsComponent;
  @ViewChild('contextPruning') contextPruning!: ElementRef;
  @ViewChild('axiomEdit') axiomEdit: EditorComponent;

  @ViewChild('testfile') testfile: EditorComponent;
  @ViewChild('ligerRules') ligerRules: EditorComponent;
  @ViewChild('errorhandle') errorhandle: ElementRef;

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
      pct: string;        // e.g. "33.3"
      intensity: number;  // 0..1
      diag: boolean;
    }[];
  }[] = [];

  cellIds: string[][][] = Array.from({ length: 3 }, () =>
    Array.from({ length: 3 }, () => [])
  );

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
      this.gswbPreferences.updateFormFromPreferences(this.gswbPreferences.gswbPreferences)
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




  batchParse(sentences: string, rules: string) {

    this.errorhandle.nativeElement.innerHTML = "";
    this.loading = true;
    this.regressionTestResults = [];
    this.regressionTestItems =[];
    this.inferenceResults = [];
    this.inferenceSummary = "";
    this.updateConfusionMatrixView(Array.from({ length: 3 }, () => Array(3).fill(0)));


    this.gswbPreferences.onSubmit()

    const logicType = this.vampirePreferences.vampirePreferences.logic_type === 0 ? 'fof' : 'tff';

    //Split sentences into lines and add all non-empty lines to an array
    // let sentencesArray = sentences.split("\n").filter(line => {
    //   let trimmedLine = line.trim();
    //   return trimmedLine !== '' && !trimmedLine.startsWith("#");
    // });

    //this.sentenceMap = this.parse_testfile(this.testfile.getContent());

    //map from id to sentences
    // let sentenceMap = {};
    // for (let i = 0; i < sentencesArray.length; i++) {
    //   sentenceMap["S" + (i + 1)] = sentencesArray[i];
    // }

    this.parse_testfile(sentences);

    this.displayMessage("Sending testsuite to LiGER for parsing ...", "blue");

    const ligerMultipleRequest = {sentences: this.sentenceMap, ruleString: rules, logicType: logicType};

    this.dataService.ligerBatchAnnotate(ligerMultipleRequest).subscribe(
      data => {
        // console.log(data);
        if (data.hasOwnProperty("annotations")) {

          console.log("Annotations:",data.annotations);

          let mcMap = {}
          for (let [key, value] of Object.entries(data.annotations) as [string, LigerRuleAnnotation][]) {
            mcMap[key] = value.meaningConstructors;
          }

// sort mcMap by key where keys are of the form S0, S1, S2, ...
// sort by the entire numeric portion of the key
          let sortedMcMap = {};
          Object.keys(mcMap).sort((a, b) => {
            let aNum = parseInt(a.match(/\d+/)[0]);
            let bNum = parseInt(b.match(/\d+/)[0]);
            return aNum - bNum;
          }).forEach(key => {
            sortedMcMap[key] = mcMap[key];
          });

         // console.log("sorted MCs",sortedMcMap);

          this.gswbMultipleRequest = {
            premises: sortedMcMap,
            gswbPreferences: this.gswbPreferences.gswbPreferences
          }

         // console.log("Specified request: ",this.gswbMultipleRequest);

        }
        if (data.hasOwnProperty("ruleApplicationGraph")) {

          console.log("Rule application graph: ", data.ruleApplicationGraph);
          this.cy1.renderGraph(data.ruleApplicationGraph);
        }

        // if (data.hasOwnProperty("report")) {
        //   this.ligerreport.nativeElement.innerHTML = data.report;
        // }

        this.displayMessage("Sending parsing results to GSWB for deduction ...", "blue");

        this.batchDeduce(this.gswbMultipleRequest).subscribe((result: GswbBatchOutput) => {
          const outputs = result.outputs;
          console.log("GSWB outputs: ", outputs);
          const gswbMap = new Map<string, GswbOutput>();
          for (const key in outputs) {
            gswbMap.set(key, outputs[key]);
          }

          //console.log("GSWB Map: ", gswbMap);

          let successCount = 0;
          let successFullKeys = [];

          //Iterate through sentenceMap keys
          for (let key of Object.keys(this.sentenceMap)){

            if (gswbMap.get(key).solutions.length > 0) {
              successCount++;
              successFullKeys.push(key);
            }

            let regressionTestResult: {}
            = {
              sentence_id: key,
              sentence: this.sentenceMap[key],
              noOfAppliedRules : data.annotations[key].appliedRules.length,
              noOfMCsets: data.annotations[key].numberOfMCsets,
              noOfSolutions: gswbMap.get(key).solutions.length,
              ligerGraph: data.annotations[key].graph,
              ligerMCsets: data.annotations[key].meaningConstructors,
              gswbSolutions: gswbMap.get(key).solutions.map(x => x.solution),
              gswbDerivation: gswbMap.get(key).derivation,
              result_type: 'parseResult'
            }
            console.log("Regression test result for " + key + ": ", regressionTestResult);
            this.regressionTestResults.push(regressionTestResult);
          }

          console.log("Successful keys: ", successFullKeys);
          let quickReport = "Parsed " + successCount + " of " + (Object.keys(this.sentenceMap).length) + " sentences! \n"

         this.loading = false;
          this.displayMessage(  quickReport +
            "Batch processing completed successfully.", "green");


          //Todo implement intervention for disambiguating before call to Vampire


          this.displayMessage("Sending NLI items to Vampire ...", "blue");
          console.log("Preparing call to Vampire ...");

          //a map from string to NLI items
          let inference_items = {};

          //          for (let [key, value] of Object.entries(data.annotations) as [string, LigerRuleAnnotation][]) {
          //             mcMap[key] = value.meaningConstructors;

          console.log("Current regression test items:", this.regressionTestItems);
          // Produce a dictionary from ids for regression test items to solutions
          for (let item of this.regressionTestItems){

            let axioms = this.axiomEdit.getContent();
            let axiomCounter = 0;

            //console.log("Current item:", item);
            let premise_strings: string[] = [];
            for (let premise of item.premises) {
              //console.log("current premise:", premise);
              //console.log("Boolean", gswbMap.get(premise).solutions.length > 0);
              if (gswbMap.has(premise) && gswbMap.get(premise).solutions.length > 0) {
                premise_strings.push(gswbMap.get(premise).solutions.map(x => x.solution).join('\n'));

              // console.log("Extracting axioms for premise:", premise);
              const liger_data = data.annotations[premise];
              if (liger_data.axioms != null && liger_data.axioms.length > 0) {
                  for (let axiom of liger_data.axioms) {
                    if (axiom.trim() !== '' && !axioms.includes(axiom.trim())) {
                      axioms += logicType + "(" +
                        "axiom" + axiomCounter + ",axiom," + axiom + ').\n';
                      axiomCounter++;
                    }
                }
              } else {console.log("No axioms for premise:", premise);}
              }
            }

            console.log("Finished processing premises")

            let conclusion_strings: string[] = [];

            //console.log("Item conclusions:", item.conclusion);

            for (let conclusion of item.conclusion){
              if (gswbMap.has(conclusion) && gswbMap.get(conclusion).solutions.length > 0) {
                conclusion_strings.push(gswbMap.get(conclusion).solutions.map(x => x.solution).join('\n'));
                console.log("Extracting axioms for conclusion:", conclusion);
                const liger_data = data.annotations[conclusion];
               // console.log("LiGER data:", liger_data)
                if (liger_data.axioms != null && liger_data.axioms.length > 0) {
                  for (let axiom of liger_data.axioms) {
                    if (axiom.trim() !== '' && !axioms.includes(axiom.trim())) {
                      axioms += logicType + "(" +
                        "axiom" + axiomCounter + ",axiom," + axiom + ').\n';
                      axiomCounter++;
                    }
                  }

                  // console.log("Axioms after processing conclusion:", axioms);

                } else {console.log("No axioms for conclusion:", conclusion);}

              }
            }

            console.log("Finished processing conclusion")

            console.log("premise strings:", premise_strings);
            console.log("conclusion strings:", conclusion_strings);



            // let conclusion: string = '';
            // if (item.conclusion in gswbMap.keys() && gswbMap.get(item.conclusion).solutions.length > 0) {
            //   //data.solutions.join('\n');
            //   conclusion = gswbMap.get(item.conclusion).solutions.join('\n');
            // }

            if (premise_strings.length > 0 && conclusion_strings.length > 0) {
              let nli_item: nliItem = {premises: premise_strings, hypothesis: conclusion_strings, axioms: axioms}
              inference_items[item.id] = nli_item;
            }
          }
          // console.log("Inference items: ", inference_items);

          let pruning = this.contextPruning.nativeElement.checked


          let vampireRequest: vampireMultipleRequest = {nli_items: inference_items,
                                                        vampire_preferences: this.vampirePreferences.vampirePreferences,
                                                        pruning: pruning};

          // console.log("Vampire multiple request:",vampireRequest);

          this.batchVampire(vampireRequest).subscribe((vampireResult: vampireMultipleResponse) => {
            console.log("Vampire results: ", vampireResult);
            this.displayMessage("Batch processing completed successfully.", "green");

            // const labels = ['1', '0', '-1']; // entailment, neutral, contradiction
            // const labelName = { '1': 'Entailment', '0': 'Neutral', '-1': 'Contradiction' };
             const idx = { '1': 0, '0': 1, '-1': 2 };
            //
             const cm = Array.from({ length: 3 }, () => Array(3).fill(0));
            // alongside cm:
            this.selectedIds.clear();
            this.selectedGoldIdx = this.selectedPredIdx = null;

            let all_entailment_predictions = 0;
            let all_neutral_predictions = 0;
            let all_contradiction_predictions = 0;

            let successful_entailment_predictions = 0;
            let successful_neutral_predictions = 0;
            let successful_contradiction_predictions = 0;

            //vampireResult is a map with strings as keys, iterate over map
            for (let [key, value] of Object.entries(vampireResult.results) as [string, check[]][]) {

              //Number of info checks with value true
              let infoCount = value.filter(check => check.informative).length;
              //Number of consistent checks with value true
              let consistentCount = value.filter(check => check.consistent).length;
              //Number of relevant checks with value true
              //let relevantCount = value.filter(check => check.relevant).length;

              // if more than half of checks are true per property, then they are successful
              let infoSuccess = infoCount > value.length / 2;
              let consistentSuccess = consistentCount > value.length / 2;
              //let relevantSuccess = relevantCount > value.length / 2;

              let entailment_label = '0';

              if (infoSuccess && consistentSuccess) {
                entailment_label = '0';
              } else if (!infoSuccess && consistentSuccess) {
                entailment_label = '1';
              } else if (!consistentSuccess) {
                entailment_label = '-1';
              }

              console.log("Entailment label for " + key + ": ", entailment_label);

              //if test items has key, then compare results
              const testItem = this.regressionTestItems.find(item => item.id === key);
              console.log("Gold label: ",testItem.gold_label)

              if (testItem.gold_label === entailment_label) {
                if (entailment_label === '1') {
                  successful_entailment_predictions++;
                } else if (entailment_label === '0') {
                  successful_neutral_predictions++;
                } else if (entailment_label === '-1') {
                  successful_contradiction_predictions++;
                }
              }

              if (testItem.gold_label === '1') {
                all_entailment_predictions++;
              } else if (testItem.gold_label === '0') {
                all_neutral_predictions++;
              } else if (testItem.gold_label === '-1') {
                all_contradiction_predictions++;
              }

              // ... inside your loop, once you have:
              const gold = testItem.gold_label;     // '1' | '0' | '-1'
              const pred = entailment_label;        // your predicted label as string


              // ... inside your vampireResult loop, after entailment_label is computed:
            //  const testItem = this.regressionTestItems.find(item => item.id === key);

// Pull the human-readable premise/hypothesis strings you already built for Vampire
// Plain-language premises/conclusion from sentenceMap via IDs (e.g., "S12")
              const premiseSentences: string[] = (testItem?.premises ?? [])
                .map((sid: string) => this.sentenceMap[sid])
                .filter((s: any) => typeof s === 'string' && s.trim().length > 0);

              const conclusionSentences: string[] = (testItem?.conclusion ?? [])
                .map((sid: string) => this.sentenceMap[sid])
                .filter((s: any) => typeof s === 'string' && s.trim().length > 0);

// If your component expects a single conclusion string, join them:
              const conclusionString = conclusionSentences.join(' '); // or '\n' if you prefer

              this.inferenceResults.push({
                id: key,
                premises: premiseSentences,
                conclusion: conclusionString,
                predictedLabel: entailment_label,
                goldLabel: testItem?.gold_label ?? 'unknown',

                // optional debug fields
                premiseIds: testItem?.premises ?? [],
                conclusionIds: testItem?.conclusion ?? [],
                mismatch: (testItem?.gold_label ?? '') !== entailment_label,
              });

              if (idx[gold] !== undefined && idx[pred] !== undefined) {
                const gi = idx[gold];
                const pj = idx[pred];
                cm[gi][pj] += 1;
                this.cellIds[gi][pj].push(key);



              } else {
                // optional: track unknown labels
                console.warn('Unknown label', { gold, pred });
              }

            }

            this.updateConfusionMatrixView(cm,Object.keys(vampireResult.results).length);

            this.inferenceSummary = "Inference results summary:\n" +
                                    "Successful entailment prediction ratio: " + successful_entailment_predictions / all_entailment_predictions + " (" + successful_entailment_predictions + " of " + all_entailment_predictions + ")\n" +
                                    "Successful neutral prediction ratio: " + successful_neutral_predictions / all_neutral_predictions + " (" + successful_neutral_predictions + " of " + all_neutral_predictions + ")\n" +
                                    "Successful contradiction prediction ratio: " + successful_contradiction_predictions / all_contradiction_predictions + " (" + successful_contradiction_predictions + " of " + all_contradiction_predictions + ")\n" +
                                    "Overall accuracy: " + (successful_entailment_predictions + successful_neutral_predictions + successful_contradiction_predictions) /  Object.keys(vampireResult.results).length

            this.loading = false;
          });



        });
      },
      error => {
        console.error('An error occurred:', error);
        this.displayMessage("An error occurred during batch parsing.", "red");
        this.loading = false;
      });



  }

  batchMultistage(sentences: String) {

    this.gswbPreferences.onSubmit()

    //Split sentences into lines and add all non-empty lines and comment lines to an array
    let sentencesArray = sentences.split("\n").filter(line => {
      let trimmedLine = line.trim();
      return trimmedLine !== '' && !trimmedLine.startsWith("#");
    });

    //map from id to sentences
    let sentenceMap = {};
    for (let i = 0; i < sentencesArray.length; i++) {
      sentenceMap["S" + i] = sentencesArray[i];
    }

    const ligerMultipleRequest = {sentences: sentenceMap, ruleString: null};

    this.dataService.ligerBatchMultistage(ligerMultipleRequest).subscribe(
      data => {
        console.log(data);
        if (data.hasOwnProperty("annotations")) {
          console.log(data.annotations);

          let mcMap = {}
          for (let [key, value] of Object.entries(data.annotations) as [string, LigerRuleAnnotation][]) {
            mcMap[key] = value.meaningConstructors;
          }

          this.gswbMultipleRequest = {
            premises: mcMap,
            gswbPreferences: this.gswbPreferences.gswbPreferences
          }

          console.log("Specified request: ",this.gswbMultipleRequest);

        }

        if (data.hasOwnProperty("report")) {
          this.ligerreport.nativeElement.innerHTML = data.report;
        }

        this.batchDeduce(this.gswbMultipleRequest);

      },
      error => {
        console.error('An error occurred:', error);
        this.loading = false;
      });



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
    )
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


  parse_testfile(testfile: string){
    // Split into lines and iterate over them

    //empty regressionTestItems
    this.regressionTestItems = [];

    let parseItems: any[] = [];

    let lines  = testfile.split('\n');

    let sentence_map = {};
    let sentence_id = 0;
    let item_id = 0;

    //iterate over lines by index
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line.trim() === '') continue; // Skip empty lines
      if (line.trim().startsWith('#')) continue; // Skip comment lines
      if (line.trim().length > 2) {

       // let sentences: string[] = [];
       // sentences.push(line.trim())
       // let item = {sentences: sentences}
       // parseItems.push(item);

        sentence_map["S" + sentence_id] = line.trim();
        sentence_id++;
      }
      if (line.trim() === "{") {
         i++;
         let sentences: string[] = [];
         let premise_ids = [];
          let conclusion_ids = [];
          let gold_label = null; // 1 for entailment, 0 for neutral, -1 for contradiction
         let premises: boolean = true;
         while (lines[i].trim() !== "}" && i < lines.length) {
           const innerLine = lines[i];
           if (innerLine.trim() === '') { i++; continue;} // Skip empty lines
           if (innerLine.trim().startsWith('}')) {break;}
             if (innerLine.trim().startsWith('#')) {
             i++;
             continue; // Skip comment lines
           }
           if (innerLine.trim() === "====") {
             premises = false;
             i++;
             continue;
           } else if (innerLine.trim().startsWith(">>>"))
           {
             // Take rest of line and check whether 1, 0, or -1
              gold_label = innerLine.trim().substring(3).trim();
           } else if (innerLine.trim().length > 2){
             sentences.push(innerLine.trim())
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
        let item = {id: "n" + item_id,
                                            sentences: sentences, premises: premise_ids,
                                            conclusion: conclusion_ids, gold_label: gold_label};
        item_id++;
        parseItems.push(item);
      }
    }
   // console.log("Parsed items:", parseItems);
    console.log("Sentence map:", sentence_map);
    this.sentenceMap = sentence_map
    this.regressionTestItems.push(...parseItems);
  }

  /**
   * Sorts result entries by number of true boolean values (descending).
   */
  sortResultsByTrueCount(resultsObj: any): any {
    // Copy to avoid mutating original
    const sortedResults: any = { ...resultsObj };

    Object.keys(sortedResults.results).forEach(key => {
      sortedResults.results[key] = sortedResults.results[key].sort(
        (a: any, b: any) => this.countTrues(b) - this.countTrues(a)
      );
    });

    return sortedResults;
  }

  /**
   * Helper: counts how many boolean properties are true in an object.
   */
  private countTrues(obj: any): number {
    return Object.values(obj)
      .filter(v => v === true)
      .length;
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

}
