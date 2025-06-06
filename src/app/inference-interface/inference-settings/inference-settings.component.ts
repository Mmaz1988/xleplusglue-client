import { Component } from '@angular/core';
import {FormBuilder, FormGroup, Validators} from "@angular/forms";
import {VampirePreferences} from "../../models/models";

@Component({
  selector: 'app-inference-settings',
  templateUrl: './inference-settings.component.html',
  styleUrls: ['./inference-settings.component.css']
})
export class InferenceSettingsComponent {

  vampirePreferencesForm: FormGroup;
  vampirePreferences: VampirePreferences = {
    logic_type: 0,
    model_building: true,
    max_duration: 10,
    layered: false
  };

  constructor(private fb: FormBuilder) {
    this.vampirePreferencesForm = this.fb.group({
      logic_type: [0, Validators.required], // Default value is 0
      model_building: [true], // Default value is true
      max_duration: [10, Validators.required], // Default value is 10
      layered: [false] // Default value is false
    });
  }

  onSubmit(): void {


    const vampirePreferences: VampirePreferences = {
      logic_type: this.vampirePreferencesForm.value.logic_type,
      model_building: this.vampirePreferencesForm.value.model_building,
      max_duration: this.vampirePreferencesForm.value.max_duration,
      layered: this.vampirePreferencesForm.value.layered
    };
    console.log("Gswb preferences: ", vampirePreferences);

    this.vampirePreferences = vampirePreferences;

  }

}
