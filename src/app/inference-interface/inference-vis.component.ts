import {Component, ViewChild, OnInit, AfterViewInit} from '@angular/core';
import { GswbSettingsComponent } from "../gswb-vis/gswb-settings/gswb-settings.component";
import {context, GswbPreferences} from "../models/models";
import {ChatComponent} from "./chat/chat.component";
import {HistoryComponent} from "./history/history.component";

@Component({
  selector: 'app-inference-vis',
  templateUrl: './inference-vis.component.html',
  styleUrls: ['./inference-vis.component.css']
})
export class InferenceVisComponent implements AfterViewInit {

  ruleFile: string = '';
  history: context[][] = [];

  @ViewChild('gswbPrefs') gswbPreferences!: GswbSettingsComponent; // Ensures it is initialized later
  @ViewChild('chat') chatComponent: ChatComponent;
  @ViewChild('history') historyComponent: HistoryComponent;

  selectedElements: number[] = []; // Stores selected box indices from history



  ngAfterViewInit() {
    if (this.gswbPreferences) {
      this.gswbPreferences.gswbPreferences = {
        prover: 1,
        debugging: false,
        outputstyle: 4,
        parseSem: false,
        noreduce: false,
        glueOnly: false,
        meaningOnly: false,
        explainFail: false,
        naturalDeductionStyle: 0,
      };
    } else {
      console.error("ERROR: `gswbPreferences` ViewChild not initialized!");
    }
  }


  updateData(ruleFile: string) {
    this.ruleFile = ruleFile;
  }

  // This method is called automatically when historyChange emits
  updateHistory(newHistory: context[][]) {
    console.log("History updated:", newHistory);
    this.history = newHistory;  // Assign the updated history
  }

  onSelectionChanged(selectedIndices: number[]): void {
    this.selectedElements = selectedIndices;
    console.log("Selected elements updated in parent:", this.selectedElements);
  }

  onClearSelection(): void {
    this.selectedElements = [];  // Reset selection in parent
    if (this.historyComponent) {
      this.historyComponent.clearSelection();  // Call method in HistoryComponent
    }
    console.log("Called onClearSelection in parent component");
  }

}
