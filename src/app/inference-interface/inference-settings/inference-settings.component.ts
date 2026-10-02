import { Component, Input } from '@angular/core';
import {FormBuilder, FormGroup, Validators} from "@angular/forms";
import {AnaphoraRankerSelection, GswbPreferences, VampirePreferences} from "../../models/models";
import {APP_DEFAULTS} from "../../app-defaults";
import {anaphoraRankerSelection} from "../../analysis-model";

@Component({
  selector: 'app-inference-settings',
  templateUrl: './inference-settings.component.html',
  styleUrls: ['./inference-settings.component.css']
})
export class InferenceSettingsComponent {

  /** Shows the anaphora branch selection. Only views that apply it to their verdicts turn it
   *  on (regression); elsewhere every branch is reasoned over regardless. */
  @Input() showAnaphoraSelection = false;
  /** Shows the anaphora ranker selection, for views that rank anaphora branches (regression,
   *  chat). */
  @Input() showAnaphoraRankers = false;

  vampirePreferencesForm: FormGroup;
  vampirePreferences: VampirePreferences = {
    logic_type: 0,
    model_building: true,
    max_duration: 10,
    layered: false,
    anaphora_selection: 'all',
    anaphora_top_k: 1,
    anaphora_rankers: [...APP_DEFAULTS.anaphoraRanking.rankers],
    anaphora_averager: APP_DEFAULTS.anaphoraRanking.averager,
  };

  constructor(private fb: FormBuilder) {
    this.vampirePreferencesForm = this.fb.group({
      logic_type: [0, Validators.required], // Default value is 0
      model_building: [true], // Default value is true
      max_duration: [10, Validators.required], // Default value is 10
      layered: [false], // Default value is false
      anaphora_selection: ['all'],
      anaphora_top_k: [1, [Validators.required, Validators.min(1)]],
      anaphora_rankers: [[...APP_DEFAULTS.anaphoraRanking.rankers]],
      anaphora_averager: [APP_DEFAULTS.anaphoraRanking.averager],
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
      ...this.rankerPreferences(this.vampirePreferencesForm.value),
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
      ...this.rankerPreferences(prefs),
    }, { emitEvent: false });
  }

  /** The ranker settings changed: stored through the form, so hosts listening to its value
   *  changes (regression's session save) see them like any other setting. */
  onRankerSelectionChange(selection: AnaphoraRankerSelection): void {
    this.vampirePreferencesForm.patchValue({
      anaphora_rankers: selection.rankers,
      anaphora_averager: selection.averager,
    });
  }

  private rankerPreferences(prefs: Pick<VampirePreferences, 'anaphora_rankers' | 'anaphora_averager'>) {
    const selection = anaphoraRankerSelection(prefs);
    return { anaphora_rankers: selection.rankers, anaphora_averager: selection.averager };
  }

}
