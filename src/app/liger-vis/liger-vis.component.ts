import { Component, ViewChild, EventEmitter, ElementRef } from '@angular/core';
import {EditorComponent} from "../editor/editor.component";
import {RuleListComponent} from "./rule-list/rule-list.component";
import {GraphVisComponent} from "./liger-graph-vis/graph-vis.component";
import { DataService } from '../data.service';
import { LigerBatchParsingAnalysis, LigerRule, LigerRuleAnnotation, LigerWebGraph, LigerGraphComponent } from '../models/models';

@Component({
  selector: 'app-liger-vis',
  templateUrl: './liger-vis.component.html',
  styleUrls: ['./liger-vis.component.css']
})
export class LigerVisComponent {

  constructor(private dataService: DataService) {
  }

  defaultValue: string = 'Every man hugged a woman.';
  meaningConstructors: string;
  changeDetector: EventEmitter<any> = new EventEmitter();
  graphElements: any
  loading: boolean = false;

  @ViewChild('edit1') editor1: EditorComponent;
  @ViewChild('rl1') rulelist1: RuleListComponent;
  @ViewChild('cy1') cy1: GraphVisComponent;
  @ViewChild('textareaElement') textarea: ElementRef;
  @ViewChild('errorhandle') errorhandle: ElementRef;



  analyzeSentence(inputValue: string, ruleString: string) {
   // console.log(inputValue)
    // console.log(this.editor1.getContent())
    this.loading = true;

    this.errorhandle.nativeElement.innerHTML = "";
    const sentence = inputValue;

    const ligerRequest = {sentence: sentence, ruleString: ruleString};

    // console.log(ligerRequest);

    this.dataService.ligerAnnotate(ligerRequest).subscribe(
      data => {
        this.loading = false;
        this.errorhandle.nativeElement.innerHTML = "";

        if (data.hasOwnProperty("graph")) {
          if (data.graph.hasOwnProperty("graphElements")) {
            if (!(data.graph.graphElements.length == 0)) {
              console.log(data.graph.graphElements);
              this.cy1.renderGraph(data.graph.graphElements);
              this.graphElements = data.graph.graphElements;
              this.displayMessage("Parsing successful...", "green");
            } else {
              this.displayMessage("Parsing failed...", "red");
            }
          }
        } else {
          this.displayMessage("Parsing failed...", "red")
        }

        if (data.hasOwnProperty("appliedRules") && data.appliedRules !== null){
          console.log(data.appliedRules);

          /*
          for (let rule of data.appliedRules) {
            this.rulelist1.addElement(rule);
          }

           */

          // iterate through data.appliedRules via index

          //remove all elements from ruleList1 via removeElement(index)
       //   console.log("Before clearing:", this.rulelist1);
          this.rulelist1.clearList();
        // console.log("After clearing:", this.rulelist1);

          for (let i = 0; i < data.appliedRules.length; i++) {
            this.rulelist1.addElement({rule: data.appliedRules[i], index: i});
          }
        }
        if (data.hasOwnProperty("meaningConstructors")) {
          console.log(data.meaningConstructors);
          this.meaningConstructors = data.meaningConstructors;
          this.changeDetector.emit(data.meaningConstructors);
        }

        if (data.hasOwnProperty('axioms')) {
          console.log("Axioms: ", data.axioms);
        }


      },
      error => {
        this.loading = false;
        console.log('ERROR: ', error);
        this.displayMessage("An error occurred while calling LiGER...", "red");
      }
    );
  }
x
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

        if (data.hasOwnProperty("graph")) {
          if (data.graph.hasOwnProperty("graphElements")) {
            if (!(data.graph.graphElements.length == 0)) {
              console.log(data.graph.graphElements);
              this.cy1.renderGraph(data.graph.graphElements);
              this.graphElements = data.graph.graphElements;
            } else {
              this.displayMessage("Parsing failed...", "red");
            }
          }
        } else
        {
          this.displayMessage("Parsing failed...", "red");
        }

        if (data.hasOwnProperty("meaningConstructors")) {
          console.log(data.meaningConstructors);
          this.meaningConstructors = data.meaningConstructors;
          this.changeDetector.emit(data.meaningConstructors);
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

  displayMessage(message: string, color: string) {
    this.errorhandle.nativeElement.style.color = color;
    this.errorhandle.nativeElement.innerHTML = "[" + new Date().toLocaleTimeString() + "] " + message;
  }


}

