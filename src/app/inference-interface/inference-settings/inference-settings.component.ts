import { Component, Input } from '@angular/core';
import {FormBuilder, FormGroup, Validators} from "@angular/forms";
import {AnaphoraRankerSelection, GswbPreferences, VampirePreferences} from "../../models/models";
import {APP_DEFAULTS} from "../../app-defaults";
import {anaphoraRankerSelection} from "../../analysis-model";
import {
  CRITERION_HINTS,
  CRITERION_LABELS,
  DEFAULT_READING_SELECTION,
  FILTER_HINTS,
  FILTER_LABELS,
  ORDER_HINT,
  READING_CRITERIA,
  READING_FILTERS,
  ReadingCriterion,
  ReadingFilter,
  ReadingSelection,
  normalizedReadingSelection,
} from "../../reading-order";

@Component({
  selector: 'app-inference-settings',
  templateUrl: './inference-settings.component.html',
  styleUrls: ['./inference-settings.component.css']
})
export class InferenceSettingsComponent {

  /** Shows the default reading selection (N4 6d): which readings of a discourse go to Vampire
   *  unless the discourse has its own. Only views that apply it turn it on. */
  @Input() showReadingSelection = false;

  readonly criteria = READING_CRITERIA;
  readonly filters = READING_FILTERS;
  readonly criterionLabels = CRITERION_LABELS;
  readonly criterionHints = CRITERION_HINTS;
  readonly filterLabels = FILTER_LABELS;
  readonly filterHints = FILTER_HINTS;
  readonly orderHint = ORDER_HINT;
  /** Shows the anaphora ranker selection, for views that rank anaphora branches (regression,
   *  chat). */
  @Input() showAnaphoraRankers = false;

  vampirePreferencesForm: FormGroup;
  vampirePreferences: VampirePreferences = {
    logic_type: 0,
    model_building: true,
    max_duration: 10,
    layered: false,
    reading_selection: { ...DEFAULT_READING_SELECTION },
    anaphora_rankers: [...APP_DEFAULTS.anaphoraRanking.rankers],
    anaphora_averager: APP_DEFAULTS.anaphoraRanking.averager,
  };

  constructor(private fb: FormBuilder) {
    this.vampirePreferencesForm = this.fb.group({
      logic_type: [0, Validators.required], // Default value is 0
      model_building: [true], // Default value is true
      max_duration: [10, Validators.required], // Default value is 10
      layered: [false], // Default value is false
      reading_selection: [{ ...DEFAULT_READING_SELECTION }],
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
      reading_selection: normalizedReadingSelection(this.vampirePreferencesForm.value.reading_selection),
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
      reading_selection: normalizedReadingSelection(prefs.reading_selection),
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

  get readingSelection(): ReadingSelection {
    return normalizedReadingSelection(this.vampirePreferencesForm.value.reading_selection);
  }

  toggleCriterion(criterion: ReadingCriterion): void {
    const selection = this.readingSelection;
    this.setReadingSelection({
      ...selection,
      criteria: selection.criteria.includes(criterion)
        ? selection.criteria.filter(checked => checked !== criterion)
        : [...selection.criteria, criterion],
    });
  }

  toggleFilter(filter: ReadingFilter): void {
    const selection = this.readingSelection;
    this.setReadingSelection({
      ...selection,
      filters: selection.filters.includes(filter)
        ? selection.filters.filter(checked => checked !== filter)
        : [...selection.filters, filter],
    });
  }

  /** "all" or a number of places. */
  setTopK(value: string): void {
    const k = value === 'all' ? null : Number(value);
    this.setReadingSelection({ ...this.readingSelection, k: k === null || k >= 1 ? k : 1 });
  }

  private setReadingSelection(selection: ReadingSelection): void {
    this.vampirePreferencesForm.patchValue({ reading_selection: normalizedReadingSelection(selection) });
  }

  private rankerPreferences(prefs: Pick<VampirePreferences, 'anaphora_rankers' | 'anaphora_averager'>) {
    const selection = anaphoraRankerSelection(prefs);
    return { anaphora_rankers: selection.rankers, anaphora_averager: selection.averager };
  }

}
