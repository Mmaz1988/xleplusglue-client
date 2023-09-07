import {Component, ViewChild, ElementRef} from '@angular/core';
import {DataService} from "../data.service";
import {GraphVisComponent} from "../liger-vis/liger-graph-vis/graph-vis.component";
import {
  LigerBatchParsingAnalysis,
  LigerRule,
  LigerRuleAnnotation,
  LigerWebGraph,
  LigerGraphComponent,
  GswbPreferences, GswbMultipleRequest
} from '../models/models';
import {GswbSettingsComponent} from "../gswb-vis/gswb-settings/gswb-settings.component";

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

  gswbMultipleRequest: GswbMultipleRequest;

  batchParse(sentences: String, rules: String) {

    this.gswbPreferences.onSubmit()

    //Split sentences into lines and add all non-empty lines to an array
    let sentencesArray = sentences.split("\n").filter(line => line.trim() !== '');

    //map from id to sentences
    let sentenceMap = {};
    for (let i = 0; i < sentencesArray.length; i++) {
      sentenceMap["S" + i] = sentencesArray[i];
    }

    const ligerMultipleRequest = {sentences: sentenceMap, ruleString: rules};

    this.dataService.ligerBatchAnnotate(ligerMultipleRequest).subscribe(
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
        if (data.hasOwnProperty("ruleApplicationGraph")) {

          console.log(data.ruleApplicationGraph);
          this.cy1.renderGraph(data.ruleApplicationGraph);
        }

        if (data.hasOwnProperty("report")) {
          this.ligerreport.nativeElement.innerHTML = data.report;
        }

        this.batchDeduce(this.gswbMultipleRequest);

      },
      error => {
        console.error('An error occurred:', error);
      });



  }

  batchMultistage(sentences: String) {

    this.gswbPreferences.onSubmit()

    //Split sentences into lines and add all non-empty lines to an array
    let sentencesArray = sentences.split("\n").filter(line => line.trim() !== '');

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
      });



  }



  batchDeduce(gswbMultipleRequest: GswbMultipleRequest){
    console.log("gswbRequest: ",gswbMultipleRequest);
    this.dataService.gswbBatchDeduce(gswbMultipleRequest).subscribe(
      data => {
        console.log(data);

        if (data.hasOwnProperty("report")) {
          this.gswbreport.nativeElement.innerHTML = data.report;
        }
      },
      error => {
        console.error('An error occurred:', error);
      });
  }

}
