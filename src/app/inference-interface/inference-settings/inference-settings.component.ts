import { Component, Input } from '@angular/core';
import {FormBuilder, FormGroup, Validators} from "@angular/forms";
import {GswbPreferences, VampirePreferences} from "../../models/models";

@Component({
  selector: 'app-inference-settings',
  templateUrl: './inference-settings.component.html',
  styleUrls: ['./inference-settings.component.css']
})
export class InferenceSettingsComponent {

  /** Shows the anaphora branch selection. Only views that apply it to their verdicts turn it
   *  on (regression); elsewhere every branch is reasoned over regardless. */
  @Input() showAnaphoraSelection = false;

  vampirePreferencesForm: FormGroup;
  vampirePreferences: VampirePreferences = {
    logic_type: 0,
    model_building: true,
    max_duration: 10,
    layered: false,
    anaphora_selection: 'all',
    anaphora_top_k: 1,
  };

  constructor(private fb: FormBuilder) {
    this.vampirePreferencesForm = this.fb.group({
      logic_type: [0, Validators.required], // Default value is 0
      model_building: [true], // Default value is true
      max_duration: [10, Validators.required], // Default value is 10
      layered: [false], // Default value is false
      anaphora_selection: ['all'],
      anaphora_top_k: [1, [Validators.required, Validators.min(1)]],
    });

    // Call onSubmit whenever any value changes
    this.vampirePreferencesForm.valueChanges.subscribe(() => {
      this.onSubmit();
    });
  }

  onSubmit(): void {


    const vampirePreferences: VampirePreferences = {
      logic_type: Number(this.vampirePreferencesForm.value.logic_type),
      model_building: this.vampirePreferencesForm.value.model_building,
      max_duration: this.vampirePreferencesForm.value.max_duration,
      layered: this.vampirePreferencesForm.value.layered,
      anaphora_selection: this.vampirePreferencesForm.value.anaphora_selection === 'top_k' ? 'top_k' : 'all',
      anaphora_top_k: Math.max(1, Math.floor(Number(this.vampirePreferencesForm.value.anaphora_top_k) || 1)),
    };
    console.log("Gswb preferences: ", vampirePreferences);

    this.vampirePreferences = vampirePreferences;

  }


  updateFormFromPreferences(prefs: VampirePreferences) {
    this.vampirePreferencesForm.patchValue({
      logic_type: prefs.logic_type,
      model_building: prefs.model_building,
      max_duration: prefs.max_duration,
      layered: prefs.layered,
      anaphora_selection: prefs.anaphora_selection ?? 'all',
      anaphora_top_k: prefs.anaphora_top_k ?? 1,
    }, { emitEvent: false });
  }

}
