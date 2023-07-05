import { Component, ViewChild } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { SemComponent } from './sem/sem.component';
import { LogComponent } from './log/log.component';
import { EditorComponent } from '../editor/editor.component';
import { DataService } from '../data.service';


@Component({
  selector: 'app-gswb-vis',
  templateUrl: './gswb-vis.component.html',
  styleUrls: ['./gswb-vis.component.css']
})


export class GswbVisComponent {
  @ViewChild('edit1') editor1: EditorComponent;
  @ViewChild('edit2') editor2: EditorComponent;
  @ViewChild('sem1') sem: SemComponent;
  @ViewChild('log1') log: LogComponent;

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
    const editorContent = this.editor1.getContent(); // or this.editor2 depending on which one you want.
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

        if (data.hasOwnProperty('derivation')) {
          console.log(data.derivation)
          this.editor2.updateContent(data.derivation)

          this.log.setContent(data.derivation)
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


