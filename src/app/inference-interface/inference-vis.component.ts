import {Component, ViewChild, OnInit, AfterViewInit} from '@angular/core';
import { GswbSettingsComponent } from "../gswb-vis/gswb-settings/gswb-settings.component";
import { GswbPreferences } from "../models/models";
import {ChatComponent} from "./chat/chat.component";

@Component({
  selector: 'app-inference-vis',
  templateUrl: './inference-vis.component.html',
  styleUrls: ['./inference-vis.component.css']
})
export class InferenceVisComponent implements AfterViewInit {

  ruleFile: string = '';
  history: string[] = [];

  @ViewChild('gswbPrefs') gswbPreferences!: GswbSettingsComponent; // Ensures it is initialized later
  @ViewChild('chat') chatComponent: ChatComponent;
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
}
