import {ChangeDetectorRef, Component, ViewChild} from '@angular/core';
import {context} from "../models/models";
import {GswbSettingsComponent} from "../gswb-vis/gswb-settings/gswb-settings.component";
import {ChatComponent} from "../chat-interface/chat/chat.component";
import {HistoryComponent} from "../chat-interface/history/history.component";
import {EditorComponent} from "../editor/editor.component";

@Component({
  selector: 'app-inference-interface',
  templateUrl: './inference-interface.component.html',
  styleUrls: ['./inference-interface.component.css']
})
export class InferenceInterfaceComponent {

  ruleFile: string = '';
  history: context[][] = [];

  @ViewChild('gswbPrefs') gswbPreferences!: GswbSettingsComponent; // Ensures it is initialized later
  @ViewChild('axiomEdit') editor: EditorComponent;

  axioms: string = '';

  tabsInitialized = false;

  constructor(private cdRef: ChangeDetectorRef) {
  }

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
