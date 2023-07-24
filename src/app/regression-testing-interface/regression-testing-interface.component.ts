import {Component, ViewChild, ElementRef} from '@angular/core';
import {DataService} from "../data.service";
import {GraphVisComponent} from "../liger-vis/liger-graph-vis/graph-vis.component";
import { LigerBatchParsingAnalysis, LigerRule, LigerRuleAnnotation, LigerWebGraph, LigerGraphComponent } from '../models/models';

@Component({
  selector: 'app-regression-testing-interface',
  templateUrl: './regression-testing-interface.component.html',
  styleUrls: ['./regression-testing-interface.component.css']
})
export class RegressionTestingInterfaceComponent {

  constructor(private dataService: DataService) {
  }


  @ViewChild('arcy') cy1: GraphVisComponent;
  @ViewChild('report') report: ElementRef;

  batchParse(sentences: String, rules: String)
{
  //Split sentences into lines and add all non-empty lines to an array
  let sentencesArray = sentences.split("\n").filter(line => line.trim() !== '');

  //map from id to sentences
  let sentenceMap = {};
  for (let i = 0; i < sentencesArray.length; i++) {
    sentenceMap["S"+i] = sentencesArray[i];
  }


  const ligerMultipleRequest= {sentences: sentenceMap, ruleString: rules};

  this.dataService.ligerBatchAnnotate(ligerMultipleRequest).subscribe(
    data => {
      console.log(data);
      if (data.hasOwnProperty("annotations")) {
        console.log(data.annotations);

        let mcMap = {}
        for (let i = 0; i < data.annotations.keys.length; i++) {
          mcMap[data.annotations.keys[i]] = data.annotations[data.annotations.keys[i]].meaningConstructors;

        }

        let gswbMultipleRequest = {premises: mcMap, gswbPreferences: {} }

          this.dataService.gswbBatchDeduce(gswbMultipleRequest).subscribe(


          );

      }
  if (data.hasOwnProperty("ruleApplicationGraph")) {

      console.log(data.ruleApplicationGraph);
      this.cy1.renderGraph(data.ruleApplicationGraph);
   }

  if (data.hasOwnProperty("report")) {
      this.report.nativeElement.innerHTML = data.report;
  }

    },
      error => {
        console.error('An error occurred:', error);
      });




}

}
