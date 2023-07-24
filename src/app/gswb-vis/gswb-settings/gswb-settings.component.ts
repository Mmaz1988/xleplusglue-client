import { Component } from '@angular/core';
import {FormBuilder, FormGroup, Validators} from "@angular/forms";
import {DataService} from "../../data.service";
import {GswbPreferences} from "../../models/models";

@Component({
  selector: 'app-gswb-settings',
  templateUrl: './gswb-settings.component.html',
  styleUrls: ['./gswb-settings.component.css']
})
export class GswbSettingsComponent {

  gswbPreferencesForm: FormGroup;
  gswbPreferences: GswbPreferences = {
    prover: 0,
    debugging: false,
    outputstyle: 0,
    parseSem: false,
    noreduce: false,
    glueOnly: false,
    meaningOnly: false,
    explainFail: false,
    naturalDeductionStyle: 0,
  };

  constructor(private fb: FormBuilder) {
    this.gswbPreferencesForm = this.fb.group({
      prover: [0, Validators.required], // Default value is 0
      outputstyle: [0, Validators.required], // Default value is 0
      parseSem: [false], // Default value is false
      explain: [false], // Default value is false
      debugging: [false],
      ndstyle: [0, Validators.required]// Default value is false
    });
  }

  onSubmit(): void {


    const gswbPreferences: GswbPreferences = {
      prover: this.gswbPreferencesForm.value.prover,
      outputstyle: this.gswbPreferencesForm.value.outputstyle,
      parseSem: this.gswbPreferencesForm.value.parseSem,
      noreduce: false,
      glueOnly: false,
      meaningOnly: false,
      explainFail: this.gswbPreferencesForm.value.explain,
      debugging: this.gswbPreferencesForm.value.debugging,
      naturalDeductionStyle: this.gswbPreferencesForm.value.ndstyle
    };
    console.log("Gswb preferences: ", gswbPreferences);

    this.gswbPreferences = gswbPreferences;

  }
}
