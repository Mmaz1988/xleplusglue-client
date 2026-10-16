import {Component, Input, ViewChild} from '@angular/core';
//import {DialogComponent} from "../../dialog/dialog.component";

@Component({
  selector: 'app-test-item',
  templateUrl: './test-item.component.html',
  styleUrls: ['./test-item.component.css']
})
export class TestItemComponent {
  @Input() data: any;
  @Input() sentenceMap: {};

  sentences: string[] = [];
  sentence_string = '';
  premises: string[] = [];
  conclusion: string[] = [];
  gold_label: number; // 1 for entailment, 0 for neutral, -1 for contradiction


  wellformed_inference: boolean;

  ngOnInit(): void {
    if (this.data) {
      console.log("Item data", this.data)
      this.sentences = this.data.sentences;
      this.sentence_string = this.sentences.join('\n');
      if (this.data.hasOwnProperty("premises") && this.data.hasOwnProperty("conclusion")) {
        this.premises = this.data.premises;
        this.conclusion = this.data.conclusion;
        this.wellformed_inference = true;

        let premise_string = ''
        let conclusion_string = ''

        this.premises.forEach((index: string) => {
          //check if index is in sentence_map, index is a string S+number
          if (this.sentenceMap[index]) {
            premise_string += this.sentenceMap[index] + '\n';
          }
        });

        this.conclusion.forEach((index: string) => {
          if (this.sentenceMap[index]) {
            conclusion_string += this.sentenceMap[index] + '\n';
          }
        });


        this.sentence_string = premise_string.trim() + '\n___________________________________________\n' + conclusion_string.trim();

      }

      if ((this.data.hasOwnProperty("premises") && !this.data.hasOwnProperty("conclusion")) ||
        (!this.data.hasOwnProperty("premises") && this.data.hasOwnProperty("conclusion"))) {
        this.wellformed_inference = false;
      }
      if (this.data.hasOwnProperty("gold_label")) {
        this.gold_label = this.data.gold_label;
      }
    }
  }

  ngAfterViewInit(): void {
  }
}
