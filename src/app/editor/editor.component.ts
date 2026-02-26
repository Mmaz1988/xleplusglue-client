import { Component, ViewChild, ElementRef, AfterViewInit, Input, ViewEncapsulation } from '@angular/core';
import * as CodeMirror from 'codemirror';
import 'codemirror/addon/edit/matchbrackets.js';

CodeMirror.defineMode("liger", function() {
  return {
    token: function(stream,state) {
      if (stream.match("==>") ) {
        return "rule_separator";
      }

      else if (stream.match(/#[A-Za-z0-9]+/))
      {
        return "liger_node_var";
      }

      else if (stream.match(/%[A-Za-z0-9]+/)) {
        return "liger_val_var";
      }
      else if (stream.match(/(\&|\.)/)) {

        return "liger_conjunction";
      } else if (stream.match("//")) {
        stream.skipToEnd();
        return "comment"; // Use the "comment" CSS class for the comment token
      }
      else {
        stream.next();
        return null;
      }
    }

  };
});

CodeMirror.defineMode("glue", function() {
  return {
    token: function(stream,state) {
      if (stream.match(":") ) {
        return "rule_separator";
      }

      else if (stream.match(/-o/))
      {
        return "liger_node_var";
      }

      else if (stream.match(/(\[|\])/)) {
        return "liger_conjunction";

      }
      else if (stream.match(/(\(|\))/)) {
        return "liger_val_var";

      }
      else if (stream.match(/(<|>)/)) {
        return "angular_brackets";

      }
      else if (stream.match("//")) {
        stream.skipToEnd();
        return "comment"; // Use the "comment" CSS class for the comment token
      }
      else {
        stream.next();
        return null;
      }
    }

  };
});

const DEFAULT_TEST_SUITE = "{\n" +
  "A Swede won a Nobel prize.\n" +
  "Every Swede is a Scandinavian.  \n" +
  "====\n" +
  "A Scandinavian won a Nobel prize.\n" +
  ">>> 1\n" +
  "}\n" +
  "{\n" +
  "A dog appeared.\n" +
  "====\n" +
  "No dog appeared.\n" +
  ">>> -1\n" +
  "}\n" +
  "{\n" +
  "A dog appeared.\n" +
  "====\n" +
  "No cat appeared.\n" +
  ">>> 0\n" +
  "}\n" +
  "{\n" +
  "Vincent knows every boxer.\n" +
  "Butch is a boxer.\n" +
  "====\n" +
  "Vincent knows Butch.\n" +
  ">>> 1\n" +
  "}\n" +
  "\n" +
  "{\n" +
  "If Mia snorts, then Vincent smokes.\n" +
  "Vincent smokes.\n" +
  "====\n" +
  "Mia snorts.\n" +
  ">>> 0\n" +
  "}\n" +
  "\n" +
  "{\n" +
  "A woman loves every man.\n" +
  "Every boxer is a man.\n" +
  "====\n" +
  "A woman loves every boxer.\n" +
  ">>> 1\n" +
  "}\n" +
  "\n" +
  "{\n" +
  "All boxers are crazy.\n" +
  "Butch is a boxer.\n" +
  "====\n" +
  "Butch is crazy.\n" +
  ">>> 1\n" +
  "}\n" +
  "\n" +
  "{\n" +
  "All boxers are slow.\n" +
  "Butch is a boxer.\n" +
  "====\n" +
  "Butch is not slow.\n" +
  ">>> -1\n" +
  "}\n" +
  "\n" +
  "{\n" +
  "All boxers are slow.\n" +
  "Butch is a boxer.\n" +
  "====\n" +
  "Mia likes Butch.\n" +
  ">>> 0\n" +
  "}\n" +
  "\n" +
  "{\n" +
  "All boxers are crazy.\n" +
  "Butch is a boxer.\n" +
  "====\n" +
  "Butch is crazy.\n" +
  ">>> 1\n" +
  "}\n" +
  "\n" +
  "{\n" +
  "All boxers are crazy.\n" +
  "Butch is a boxer.\n" +
  "====\n" +
  "Butch loves Fabian.\n" +
  ">>> 0\n" +
  "}\n" +
  "\n" +
  "{\n" +
  "All boxers are slow.\n" +
  "Butch is a boxer.\n" +
  "====\n" +
  "Mia likes Butch.\n" +
  ">>> 0\n" +
  "}"




const LIGER_DEFAULT_RULES = "--replace(true);\n" +
  "\n" +
  "//Be equality axiom\n" +
  "#p PRED %p & strip(%p) == 'be' & #p PREDLINK #c s:: #s TYPE 'entity' ==>\n" +
  "#p AXIOM all(X,all(Y,all(Z,imp(and(be(X),and(arg1(X,Y),arg2(X,Z))),eq(Y,Z))))).\n"

const VAMPIRE_DEFAULT_AXIOMS = ""

@Component({
  selector: 'app-editor',
  templateUrl: './editor.component.html',
  styleUrls: [
    '../../../node_modules/codemirror/lib/codemirror.css',
    './editor.component.css'
    ],
  encapsulation: ViewEncapsulation.None
})
export class EditorComponent implements AfterViewInit {
  @ViewChild('host') host: ElementRef;

  @Input() id: string;
  @Input() mode: string;

  defaultWidth = '800px';
  defaultHeight = '300px';

  private codeMirror: CodeMirror.EditorFromTextArea;

  filename: string; // to hold the input filename


  ngAfterViewInit() {
    console.log("mode is " + this.mode);

    this.codeMirror = CodeMirror.fromTextArea(this.host.nativeElement, {
      mode: this.mode,
      viewportMargin: Infinity,
      lineNumbers: true,
      matchBrackets: true,  // Enables bracket matching
      autoCloseBrackets: true  // Auto-closes brackets
    });

    if (this.mode === "liger") {
      this.codeMirror.setValue(LIGER_DEFAULT_RULES);
    } else if (this.mode === "text") {
      this.codeMirror.setValue(DEFAULT_TEST_SUITE);
    } else if (this.mode === "vampire") {
      this.codeMirror.setValue(VAMPIRE_DEFAULT_AXIOMS);
    }
  }


  updateContent(value: string): void {
    if (this.codeMirror) {
      this.codeMirror.setValue("");        // optional: clear first
      this.codeMirror.clearHistory();      // optional: reset undo stack
      this.codeMirror.setValue(value);     // set new content
      this.codeMirror.refresh();
    }
  }


  public getContent(): string {
    return this.codeMirror.getValue();
  }

  resizeToDefault(): void {
    this.codeMirror.setSize(this.defaultWidth, this.defaultHeight);
  }

  downloadFile(filename: string) {
    let content = this.codeMirror.getValue();
    let blob = new Blob([content], { type: 'text/plain' });
    let url = window.URL.createObjectURL(blob);

    // Create a link and programmatically click it:
    let link = document.createElement('a');
    link.href = url;
    link.download = filename || 'default.txt'; // If filename is not provided, use 'default.txt'
    link.click();

    // Remember to revoke the blob URL after a while to save memory:
    setTimeout(() => window.URL.revokeObjectURL(url), 10000);
  }

  //Getter function for codemirror
  get codeMirrorInstance(): CodeMirror.EditorFromTextArea {
    return this.codeMirror;
  }
  }

