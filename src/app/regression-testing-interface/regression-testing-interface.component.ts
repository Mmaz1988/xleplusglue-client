import {Component, ViewChild, ElementRef} from '@angular/core';
import {DataService} from "../data.service";
import {GraphVisComponent} from "../liger-vis/liger-graph-vis/graph-vis.component";
import {
  LigerBatchParsingAnalysis,
  LigerRule,
  LigerRuleAnnotation,
  LigerWebGraph,
  LigerGraphComponent,
  GswbPreferences, GswbMultipleRequest, GswbBatchOutput, GswbOutput, StanzaMultipleAnnotation
} from '../models/models';
import {GswbSettingsComponent} from "../gswb-vis/gswb-settings/gswb-settings.component";
import {EditorComponent} from "../editor/editor.component";
import {catchError, EMPTY, map, Observable} from "rxjs";
import {tap} from "rxjs/operators";
import {error} from "@angular/compiler-cli/src/transformers/util";

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
  @ViewChild('ligerRules') ligerRules: EditorComponent;
  @ViewChild('errorhandle') errorhandle: ElementRef;

  gswbMultipleRequest: GswbMultipleRequest;

  regressionTestResults: any[] = [];

  loading: boolean = false;

  batchParse(sentences: String, rules: String) {

    this.errorhandle.nativeElement.innerHTML = "";
    this.loading = true;
    this.regressionTestResults = [];

    this.gswbPreferences.onSubmit()

    //Split sentences into lines and add all non-empty lines to an array
    let sentencesArray = sentences.split("\n").filter(line => {
      let trimmedLine = line.trim();
      return trimmedLine !== '' && !trimmedLine.startsWith("#");
    });

    //map from id to sentences
    let sentenceMap = {};
    for (let i = 0; i < sentencesArray.length; i++) {
      sentenceMap["S" + (i + 1)] = sentencesArray[i];
    }

    this.displayMessage("Sending testsuite to Stanza for parsing ...", "blue");

    const stanzaMultipleRequest = {sentences: sentenceMap, language : "en"};

    this.dataService.stanzaBatchParse(stanzaMultipleRequest).subscribe(
      stanza_data => {
        console.log("Stanza parse result: ", stanza_data);

        const stanza_json_string_obj: { [key: string]: string } = {};

        //Stringify stanza_data to send to LiGER
        for (let [key, value] of Object.entries(stanza_data.annotations)) {
          stanza_json_string_obj[key] = JSON.stringify(value);
        }

        const ligerMultipleRequest = {sentences: stanza_json_string_obj, ruleString: rules};

        console.log("Liger request: ", ligerMultipleRequest);

        this.displayMessage("Sending testsuite to LiGER for analyzing ...", "blue");
        this.dataService.ligerBatchAnnotateDependencies(ligerMultipleRequest).subscribe(
          data => {
            // console.log(data);
            if (data.hasOwnProperty("annotations")) {

              console.log("Annotations:", data.annotations);

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

              console.log("sorted MCs", sortedMcMap);

              this.gswbMultipleRequest = {
                premises: sortedMcMap,
                gswbPreferences: this.gswbPreferences.gswbPreferences
              }

              console.log("Specified request: ", this.gswbMultipleRequest);

            }
            if (data.hasOwnProperty("ruleApplicationGraph")) {

              console.log(data.ruleApplicationGraph);
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

              console.log("GSWB Map: ", gswbMap);

              let successCount = 0;
              let successFullKeys = [];

              //Iterate through sentenceMap keys
              for (let key of Object.keys(sentenceMap)) {

                if (gswbMap.get(key).solutions.length > 0) {
                  successCount++;
                  successFullKeys.push(key);
                }

                let regressionTestResult: {}
                  = {
                  sentence_id: key,
                  sentence: sentenceMap[key],
                  noOfAppliedRules: data.annotations[key].appliedRules.length,
                  noOfMCsets: data.annotations[key].numberOfMCsets,
                  noOfSolutions: gswbMap.get(key).solutions.length,
                  ligerGraph: data.annotations[key].graph,
                  ligerMCsets: data.annotations[key].meaningConstructors,
                  gswbSolutions: gswbMap.get(key).solutions,
                  gswbDerivation: gswbMap.get(key).derivation
                }
                console.log("Regression test result for " + key + ": ", regressionTestResult);
                this.regressionTestResults.push(regressionTestResult);
              }

              console.log("Successful keys: ", successFullKeys);
              let quickReport = "Parsed " + successCount + " of " + (Object.keys(sentenceMap).length) + " sentences! \n"

              this.loading = false;
              this.displayMessage(quickReport +
                "Batch processing completed successfully.", "green");
            });
          },
          error => {
            console.error('An error occurred:', error);
            this.displayMessage("An error occurred during batch parsing.", "red");
            this.loading = false;
          });
      },
      error => {
        console.error('An error occurred during Stanza parsing:', error);
        this.displayMessage("An error occurred during Stanza parsing.", "red");
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

  updateData(ruleFile: string) {
    this.ligerRules.updateContent(ruleFile);
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

}
