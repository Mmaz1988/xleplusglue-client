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

const DEFAULT_TEST_SUITE = "#transitive\n" +
  "\n" +
  "a dog appeared.\n" +
  "\n" +
  "#optional transitives\n" +
  "\n" +
  "a dog escaped.\n" +
  "\n" +
  "a dog escaped the cage.\n" +
  "\n" +
  "#transitive\n" +
  "\n" +
  "every dog devoured a bone.\n" +
  "\n" +
  "#di-transitive\n" +
  "\n" +
  "Mary gave a student every grade.\n" +
  "\n" +
  "Mary gave a grade to a student.\n" +
  "\n";


const LIGER_DEFAULT_RULES = "--replace(true);\n" +
  "\n" +
  "#e UPOS VERB & #e LEMMA %l ==> #e SEM #s & \n" +
  "\t\t\t\t\t\t\t   \t#s CLOSURE #c &\n" +
  "\t\t\t\t\t\t\t\t#s GLUE [/e_v.%l(e)] : (#s_v -o #s_t) &\n" +
  "                                #c GLUE [/P_<v,t>.Ee_v[P(v)]] : ((#s_v -o #s_t) -o #s_t) || noscope.\n" +
  "\n" +
  "#e NSUBJ #a & #e SEM #v ==> #a SEM #s & #v ARG1 #b & \n" +
  "\t\t\t\t\t\t\t\t#b GLUE [/P_<v,t>.[/x_e.[/e_v.(arg1(e,x) \\& P(e))]]] : \n" +
  "\t\t\t\t\t\t\t\t((#v_v -o #v_t) -o (#s_e -o (#v_v -o #v_t))) || noscope.\n" +
  "                                  \n" +
  "#e OBJ #a & #e SEM #v ==> #a SEM #s & #v ARG2 #b &\n" +
  "\t\t\t\t\t\t\t\t#b GLUE [/P_<v,t>.[/x_e.[/e_v.(arg2(e,x) \\& P(e))]]] : \n" +
  "\t\t\t\t\t\t\t\t((#v_v -o #v_t) -o (#s_e -o (#v_v -o #v_t))) || noscope.\n" +
  "                                \n" +
  " #e OBL:UNMARKED #a & #e SEM #v ==> #a SEM #s & #v ARG3 #b &\n" +
  "\t\t\t\t\t\t\t\t#b GLUE [/P_<v,t>.[/x_e.[/e_v.(arg3(e,x) \\& P(e))]]] : \n" +
  "\t\t\t\t\t\t\t\t((#v_v -o #v_t) -o (#s_e -o (#v_v -o #v_t))) || noscope.\n" +
  "\n" +
  " #e OBL #a & #e SEM #v ==> #a SEM #s & #v ARG3 #b &\n" +
  "\t\t\t\t\t\t\t\t#b GLUE [/P_<v,t>.[/x_e.[/e_v.(arg3(e,x) \\& P(e))]]] : \n" +
  "\t\t\t\t\t\t\t\t((#v_v -o #v_t) -o (#s_e -o (#v_v -o #v_t))) || noscope.\n" +
  "\n" +
  "#n UPOS PROPN & #n LEMMA %l & #n SEM #s ==> #s GLUE %l : #s_e.\n" +
  "\n" +
  "#n UPOS NOUN & #n LEMMA %l & #n SEM #s ==> #s GLUE [/x_e.%l(x)] : (#s_e -o #s_t).\n" +
  "\n" +
  "#d DEFINITE Ind & #d ^(DET) #n SEM #s & #n ^(%) #p SEM #q  ==>  \n" +
  "#d SEM #t & #t GLUE [/P_<e,t>.[/Q_<e,t>.Ex_e[P(x) \\& Q(x)]]] : \n" +
  "\t\t\t\t\t\t((#s_e -o #s_t) -o ((#s_e -o #q_t) -o #q_t)).\n" +
  "                        \n" +
  "#d UPOS 'DET' & #d LEMMA every & #d ^(DET) #n SEM #s & #n ^(%) #p SEM #q  ==>  \n" +
  "#d SEM #t & #t GLUE [/P_<e,t>.[/Q_<e,t>.Ax_e[P(x) -> Q(x)]]] : \n" +
  "\t\t\t\t\t\t((#s_e -o #s_t) -o ((#s_e -o #q_t) -o #q_t)).";

const VAMPIRE_DEFAULT_AXIOMS = "";

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

