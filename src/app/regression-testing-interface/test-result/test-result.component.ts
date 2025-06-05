import {Component, Input, OnInit, ViewChild, AfterViewInit} from '@angular/core';
import {DialogComponent} from "../../dialog/dialog.component";

@Component({
  selector: 'app-test-result',
  templateUrl: './test-result.component.html',
  styleUrls: ['./test-result.component.css']
})
export class TestResultComponent implements OnInit, AfterViewInit {

  @Input() data: any;
  @ViewChild('solution') dialog!: DialogComponent;

  sentence_id: string = '';
  sentence: string = '';
  numberOfAppliedRules: number = 0;
  numberOfMCsets: number = 0;
  noOfSolutions: number = 0;
  ligerGraph: any;
  ligerMCsets: string = '';
  gswbSolutions: string[] = [];
  gswbDerivation: any;

  private solutionsContent: string = '';

  ngOnInit(): void {
    if (this.data) {
      this.sentence_id = this.data.sentence_id;
      this.sentence = this.data.sentence;
      this.numberOfAppliedRules = this.data.noOfAppliedRules;
      this.numberOfMCsets = this.data.noOfMCsets;
      this.noOfSolutions = this.data.noOfSolutions;
      this.gswbDerivation = this.data.gswbDerivation;
      this.ligerGraph = this.data.ligerGraph;
      this.ligerMCsets = this.data.ligerMCsets;


      this.solutionsContent = this.data.gswbSolutions.join('\n');
      console.log("Solutions content:", this.solutionsContent);
    }
  }

  ngAfterViewInit(): void {
    setTimeout(() => {
      if (this.dialog && this.solutionsContent) {
        this.dialog.setContent(this.solutionsContent);
      }
    });
  }
}
