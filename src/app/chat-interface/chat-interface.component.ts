import {Component, ViewChild, OnInit, AfterViewInit} from '@angular/core';
import { GswbSettingsComponent } from "../gswb-vis/gswb-settings/gswb-settings.component";
import {context, GswbPreferences} from "../models/models";
import {ChatComponent} from "./chat/chat.component";
import {HistoryComponent} from "./history/history.component";
import {EditorComponent} from "../editor/editor.component";
import {ChangeDetectorRef} from "@angular/core";

@Component({
  selector: 'app-inference-vis',
  templateUrl: './chat-interface.component.html',
  styleUrls: ['./chat-interface.component.css']
})
export class ChatInterfaceComponent implements AfterViewInit {

  ruleFile: string = '';
  history: context[][] = [];

  @ViewChild('gswbPrefs') gswbPreferences!: GswbSettingsComponent; // Ensures it is initialized later
  @ViewChild('chat') chatComponent: ChatComponent;
  @ViewChild('history') historyComponent: HistoryComponent;
  @ViewChild('axiomEdit') editor: EditorComponent;

  axioms: string = '';

  selectedElements: number[] = []; // Stores selected box indices from history

  tabsInitialized = false;

  constructor(private cdRef: ChangeDetectorRef) {}

  ngAfterViewInit() {

    this.cdRef.detectChanges();

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

    this.tabsInitialized = true;

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

  onTabChange(index: number) {
    setTimeout(() => {
      if (this.editor?.getContent) {
        console.log("Updating axioms to: ",this.editor.getContent())
        this.axioms = this.editor.getContent();
        this.cdRef.detectChanges();
      }
    });
  }

}
