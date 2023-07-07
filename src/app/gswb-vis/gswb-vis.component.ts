import { Component, ViewChild } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { SemComponent } from './sem/sem.component';
import { LogComponent } from './log/log.component';
import { EditorComponent } from '../editor/editor.component';
import { DataService } from '../data.service';
import {DerivationContainerComponent} from "./derivation-container/derivation-container.component";
import {DialogComponent} from "../dialog/dialog.component";


@Component({
  selector: 'app-gswb-vis',
  templateUrl: './gswb-vis.component.html',
  styleUrls: ['./gswb-vis.component.css']
})


export class GswbVisComponent {
  @ViewChild('edit1') editor1: EditorComponent;
  @ViewChild('derivation') derivationContainer: DerivationContainerComponent;
  @ViewChild('sem1') sem: SemComponent;
  @ViewChild('log1') log: LogComponent;
  @ViewChild('dialog') dialog: DialogComponent;

  gswbPreferencesForm: FormGroup;

  constructor(private fb: FormBuilder, private dataService: DataService) {
    this.gswbPreferencesForm = this.fb.group({
      prover: [0, Validators.required], // Default value is 0
      outputstyle: [0, Validators.required], // Default value is 0
      parseSem: [false], // Default value is false
      explain: [false], // Default value is false
      debugging: [false] // Default value is false
    });
  }

  onSubmit(): void {
    const editorContent = this.editor1.getContent();
    console.log(editorContent);

    const gswbPreferences = {
      prover: this.gswbPreferencesForm.value.prover,
      outputstyle: this.gswbPreferencesForm.value.outputstyle,
      parseSem: this.gswbPreferencesForm.value.parseSem,
      noreduce: false,
      glueOnly: false,
      meaningOnly: false,
      explainFail: this.gswbPreferencesForm.value.explain,
      debugging: this.gswbPreferencesForm.value.debugging
    };
    console.log(gswbPreferences);

    const gswbRequest = {
      premises: editorContent,
      gswbPreferences: gswbPreferences
    }

    this.dataService.gswbDeduce(gswbRequest).subscribe(
      data => {
        // Handle the data here...
        // Depending on the structure of the data you might need to modify the below code.
        if (data.hasOwnProperty('solutions')) {
          // log each element in data.solutions individually
          data.solutions.forEach(element => {
            console.log(element);
            //print solutions line by line to sem
            this.sem.setContent(element);
          });
          //translate data.solutions to string with each solution in a new line
          let solutions = data.solutions.join('\n');
          this.sem.setContent(solutions);
        }

        if (data.hasOwnProperty('log'))
        {
          this.log.setContent(data.log)
        }

        if (data.hasOwnProperty('derivation')) {
          console.log(data.derivation)

          //check if derivation is a string or an object


     if (data.derivation.hasOwnProperty('graphElements'))
          {
            console.log(data.derivation.graphElements);
            this.derivationContainer.showEditor = false;
            this.derivationContainer.showGraph = true;
            const graphElements = data.derivation.graphElements;
            // Using setTimeout to enqueue the function call after the current execution context
            setTimeout(() => {
              this.derivationContainer.graphVisUpdateContent(graphElements);
            }, 0);

            this.dialog.setContent(graphElements)

          } else
          {
            this.derivationContainer.showGraph = false;
            this.derivationContainer.showEditor = true;
            // Using setTimeout to enqueue the function call after the current execution context
            setTimeout(() => {
              this.derivationContainer.editorVisUpdateContent(data.derivation.toString());
            }, 0);
            this.dialog.setContent(data.derivation.toString());
          }
                  // Update your component's property bound to your logContainerElement here...
        }
      },
      error => {
        console.log('ERROR: ', error);
      }
    );




    // Now, you can send 'editorContent' to your backend.
    // Use your preferred method to send data to backend (for instance, HttpClient).
  }

}
// Inside ParentComponent


