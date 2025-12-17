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


  showResolveDrs: boolean = false;

  gswbPreferencesForm: FormGroup;
  gswbPreferences: GswbPreferences = {
    prover: 0,
    debugging: false,
    outputstyle: 0,
    parseSem: false,
    betaReduce: true,
    resolveDrs: false,
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
      betaReduce: [true],
      //Resolve drs should be true if outputstyle is 4 (DRT)
      resolveDrs: [false],
      explain: [false], // Default value is false
      debugging: [false],
      ndstyle: [0, Validators.required]// Default value is false
    });


    //Makes the resolveDrs option visible only when outputstyle is 4 (DRT)
    this.gswbPreferencesForm.get('outputstyle')?.valueChanges.subscribe(value => {
      console.log('outputstyle changed to:', value);
      if (value === '4') {
        this.showResolveDrs = true;
      } else {
        this.showResolveDrs = false;
        this.gswbPreferencesForm.get('resolveDrs')?.setValue(false);
      }
    });

    // Call onSubmit whenever any value changes
    this.gswbPreferencesForm.valueChanges.subscribe(() => {
      this.onSubmit();
    });

  }

  onSubmit(): void {


    const gswbPreferences: GswbPreferences = {
      prover: this.gswbPreferencesForm.value.prover,
      outputstyle: this.gswbPreferencesForm.value.outputstyle,
      parseSem: this.gswbPreferencesForm.value.parseSem,
      betaReduce: this.gswbPreferencesForm.value.betaReduce,
      resolveDrs: this.gswbPreferencesForm.value.resolveDrs,
      glueOnly: false,
      meaningOnly: false,
      explainFail: this.gswbPreferencesForm.value.explain,
      debugging: this.gswbPreferencesForm.value.debugging,
      naturalDeductionStyle: this.gswbPreferencesForm.value.ndstyle
    };
    console.log("Gswb preferences: ", gswbPreferences);

    this.gswbPreferences = gswbPreferences;

  }

  updateFormFromPreferences(prefs: GswbPreferences) {
    this.gswbPreferencesForm.patchValue({
      prover: prefs.prover,
      outputstyle: prefs.outputstyle,
      parseSem: prefs.parseSem,
      betaReduce: prefs.betaReduce,
      resolveDrs: prefs.resolveDrs,
      explain: prefs.explainFail,
      debugging: prefs.debugging,
      ndstyle: prefs.naturalDeductionStyle
    });

    if (prefs.outputstyle === 4) {
      this.showResolveDrs = true;
    } else {
      this.showResolveDrs = false;
    }

  }

}
