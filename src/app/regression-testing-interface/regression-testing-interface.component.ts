import {Component, ViewChild} from '@angular/core';
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

  batchParse(sentences: String, rules: String)
{
  //Split sentences into lines and add all non-empty lines to an array
  let sentencesArray = sentences.split("\n").filter(line => line.trim() !== '');


  const ligerMultipleRequest = {sentences: sentencesArray, ruleString: rules};

  this.dataService.ligerBatchAnnotate(ligerMultipleRequest).subscribe(
    data => {
      console.log(data);
      if (data.hasOwnProperty("annotations")) {
        console.log(data.annotations);

      }
  if (data.hasOwnProperty("ruleApplicationGraph")) {

      console.log(data.ruleApplicationGraph);
      this.cy1.renderGraph(data.ruleApplicationGraph);
   }
    },
      error => {
        console.error('An error occurred:', error);
      });
}

}
