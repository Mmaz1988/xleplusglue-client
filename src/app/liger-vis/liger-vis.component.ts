import { Component, ViewChild, EventEmitter } from '@angular/core';
import {EditorComponent} from "../editor/editor.component";
import {RuleListComponent} from "./rule-list/rule-list.component";
import {GraphVisComponent} from "./graph-vis/graph-vis.component";
import { DataService } from '../data.service';
import {FormBuilder} from "@angular/forms";

@Component({
  selector: 'app-liger-vis',
  templateUrl: './liger-vis.component.html',
  styleUrls: ['./liger-vis.component.css']
})
export class LigerVisComponent {

  constructor(private dataService: DataService) {
  }

  defaultValue: string = 'Every man loves a woman.';
  meaningConstructors: string;
  changeDetector: EventEmitter<any> = new EventEmitter();

  @ViewChild('edit1') editor1: EditorComponent;
  @ViewChild('rl1') rulelist1: RuleListComponent;
  @ViewChild('cy1') cy1: GraphVisComponent;

  analyzeSentence(inputValue: string) {
   // console.log(inputValue)
    // console.log(this.editor1.getContent())
    const sentence = inputValue;
    const ruleString = this.editor1.getContent();
    const ligerRequest = {sentence: sentence, ruleString: ruleString};

    // console.log(ligerRequest);

    this.dataService.ligerAnnotate(ligerRequest).subscribe(
      data => {
        if (data.hasOwnProperty("graph")) {
          if (data.graph.hasOwnProperty("graphElements")) {
            console.log(data.graph.graphElements);
            this.cy1.renderGraph(data.graph.graphElements);
          }
        }
        if (data.hasOwnProperty("appliedRules")) {
          console.log(data.appliedRules);

          for (let rule of data.appliedRules) {
            this.rulelist1.addElement(rule);
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


}

