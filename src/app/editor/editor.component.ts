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
  "a big black dog appeared.\n" +
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
  "\n" +
  "#COMP-verb\n" +
  "\n" +
  "Mary thinks that a cat meowed.\n" +
  "\n" +
  "#XCOMPs\n" +
  "\n" +
  "a cat seemed to meow.\n" +
  "\n" +
  "a dog tried to meow.\n" +
  "\n" +
  "#passives\n" +
  "\n" +
  "a bone was devoured by a dog.\n" +
  "\n" +
  "a program was implemented by a developer.\n" +
  "\n" +
  "a solution was implemented.\n" +
  "\n" +
  "# The following two sentences need fixing in the basic grammar (clash with OT mark and unwanted semantics)\n" +
  "\n" +
  "a grade was given to every student by Mary.\n" +
  "\n" +
  "a student was given every grade by Mary.\n" +
  "\n" +
  "#PP-attachment\n" +
  "\n" +
  "a big black dog appeared on the table.\n" +
  "\n" +
  "Peter saw the monkey with the telescope."




const LIGER_DEFAULT_RULES = "--replace(true);\n" +
  "\n" +
  "//Injection\n" +
  "#a TNS-ASP #b & #a s:: #c SIT #d & #c EV #v  ==>\n" +
  "#c TEMP-REF #e &\n" +
  "#e T-REF 'undefined' &\n" +
  "#d GLUE lam(V,lam(S,lam(E,merge(drs([],[rel(partOf,E,S)]),app(V,E))))) : ((#v_v -o #v_t) -o (#d_s -o (#v_v -o #v_t))).\n" +
  "\n" +
  "//Consumption\n" +
  "\n" +
  "//Tier 1 rules\n" +
  "#a TNS-ASP #b TENSE 'past' & #a s:: #c TEMP-REF #d & #d T-REF 'undefined' ==>  #d T-REF 'past' & #d CHECK '-'.\n" +
  "#a TNS-ASP #b TENSE 'pres' & #a s:: #c TEMP-REF #d & #d T-REF 'undefined' ==>  #d T-REF 'pres' & #d CHECK '-'.\n" +
  "#a TNS-ASP #b TENSE 'fut' & #a s:: #c TEMP-REF #d & #d T-REF 'undefined' ==>  #d T-REF 'fut' & #d CHECK '-'.\n" +
  "\n" +
  "//#a TNS-ASP #b TENSE 'pres' & #a s:: #c ==> #c TEMP-REF #d & #d T-REF 'pres' & #d EVAL #e & #e TIME 'now'.\n" +
  "//#a TNS-ASP #b TENSE 'fut' & #a s:: #c ==> #c TEMP-REF #d & #d T-REF 'fut' & #d EVAL #e & #e TIME 'now'.\n" +
  "\n" +
  "//Tier 2 rules\n" +
  "//SOT rule\n" +
  "#a T-REF 'past' &\n" +
  "#a ^(TEMP-REF>s::>COMP) #b & #b !(s::>TEMP-REF) #c T-REF 'past' ==> #a T-REF 'non-future'.\n" +
  "\n" +
  "//Present counterfactual\n" +
  "#a T-REF 'past' &\n" +
  "#a ^(TEMP-REF>s::>OBJ>in_set>ADJUNCT) #b & #b VTYPE 'modal' &\n" +
  "#b !(s::>TEMP-REF) #c T-REF 'pres' &\n" +
  "#c CHECK '-'\n" +
  "==> #a T-REF 'non-past' & #c CHECK '+' & #c EVAL #a.\n" +
  "\n" +
  "\n" +
  "//Adding evals\n" +
  "#a T-REF %a ==> #a EVAL #b.\n" +
  "\n" +
  "//COMP and XCOMP INJECTION\n" +
  "#m COMP #a TNS-ASP #b & #a s:: #c TEMP-REF #e EVAL #f &\n" +
  "#m s:: #n EV #v & #n SIT #d\n" +
  "==> #d GLUE lam(V,lam(S,lam(E,merge(drs([],[rel(partOf,E,S)]),app(app(V,S),E))))) : ((#f_s -o (#v_v -o #v_t)) -o (#d_s -o (#v_v -o #v_t))).\n" +
  "\n" +
  "#m XCOMP #a TNS-ASP #b & #a s:: #c TEMP-REF #e EVAL #f &\n" +
  "#m s:: #n EV #v & #n SIT #d\n" +
  "==> #d GLUE lam(V,lam(S,lam(E,merge(drs([],[rel(partOf,E,S)]),app(app(V,S),E))))) : ((#f_s -o (#v_v -o #v_t)) -o (#d_s -o (#v_v -o #v_t))).\n" +
  "\n" +
  "//Aspect rules\n" +
  "#a TNS-ASP #b PROG '+_' & #a s:: #c ==> #c VIEWPOINT #d & #d ASPECT 'impv' & #d A-RESTR 'ongoing'.\n" +
  "#a TNS-ASP #b PROG '-_' & #a s:: #c ==> #c VIEWPOINT #d & #d ASPECT 'undefined'.\n" +
  "#a TNS-ASP #b TENSE %x & #b PROG '-_' & #a s:: #c VIEWPOINT #d ASPECT 'undefined' ==> #d ASPECT 'prv' & #d A-RESTR 'bounded'.\n" +
  "#a TNS-ASP #b PERF '+_' & #a s:: #c ==> #c ASP-TENSE #d & #d A-REF 'past'.\n" +
  "\n" +
  "//Tier 2 aspect example\n" +
  "#a T-REF 'undefined' &\n" +
  "#a ^(TEMP-REF) #b ^(s::>XCOMP) #c & #c !(s::>TEMP-REF) #d EVAL #e &\n" +
  "#b VIEWPOINT #f ASPECT 'prv'\n" +
  "==>  #a T-REF 'future' & #a EVAL #d.\n" +
  "\n" +
  "//Semantic interpretation\n" +
  "\n" +
  "//Rules for interpreting grammatical aspect\n" +
  "#a s:: #b VIEWPOINT #c ==>\n" +
  "#c VAR #d & #c RESTR #e &\n" +
  "#c ASP-RESTR' #f.\n" +
  "\n" +
  "#a s:: #b VIEWPOINT #c A-RESTR 'ongoing' &\n" +
  "#c VAR #d & #c RESTR #e &\n" +
  "#c ASP-RESTR' #f ==>\n" +
  "#f GLUE lam(S,lam(T,drs([],[rel(ongoing,T,S)]))) : (#d_s -o (#e_s -o #c_t)).\n" +
  "\n" +
  "#a s:: #b VIEWPOINT #c A-RESTR 'bounded' &\n" +
  "#c VAR #d & #c RESTR #e &\n" +
  "#c ASP-RESTR' #f ==>\n" +
  "#f GLUE lam(S,lam(T,drs([],[rel(bounded,T,S)]))) : (#d_s -o (#e_s -o #c_t)).\n" +
  "\n" +
  "\n" +
  "#a s:: #b VIEWPOINT #c ASPECT 'impv' &\n" +
  "#c VAR #d & #c RESTR #e &\n" +
  "#b TEMP-REF #f &\n" +
  "#b SIT #g\n" +
  " ==>  #c GLUE lam(M,lam(P,lam(S,drs([],[imp(merge(drs([Z],[]),app(app(M,S),Z)),app(P,Z))])))) : ((#d_s -o (#e_s -o #c_t)) -o ((#g_s -o #g_t) -o (#f_s -o #f_t))).\n" +
  "\n" +
  "//prv closure -- fixed\n" +
  "#a s:: #b VIEWPOINT #c ASPECT 'prv' &\n" +
  "#c VAR #d & #c RESTR #e &\n" +
  "#b TEMP-REF #f &\n" +
  "#b SIT #g\n" +
  " ==>  #c GLUE lam(M,lam(P,lam(S,merge(drs([Z],[]),merge(app(app(M,S),Z),app(P,Z)))))) : ((#d_s -o (#e_s -o #c_t)) -o ((#g_s -o #g_t) -o (#f_s -o #f_t))).\n" +
  "\n" +
  "#a s:: #b VIEWPOINT #c ASPECT 'undefined' &\n" +
  "#b TEMP-REF #f &\n" +
  "#b SIT #g\n" +
  " ==>  #c GLUE lam(P,lam(S,merge(drs([],[]),app(P,S)))) : ((#g_s -o #g_t) -o (#f_s -o #f_t)).\n" +
  "\n" +
  "//Tense values\n" +
  "\n" +
  "//Past reference\n" +
  "#a s:: #b TEMP-REF #c T-REF 'past' & #c EVAL #d ==>\n" +
  "#c T-REF' #e & #e GLUE lam(T,lam(T2,drs([],[rel(before,T,T2)]))) : (#c_s -o (#d_s -o #c_t)).\n" +
  "\n" +
  "//Aspectual tense\n" +
  "#a s:: #b TEMP-REF #c EVAL #d &\n" +
  "#b ASP-TENSE #e A-REF 'past' &\n" +
  " ==>\n" +
  "#e A-REF' #f & #f GLUE lam(T,lam(T2,drs([],[rel(before,T,T2)]))) :(#e_s -o (#c_s -o #e_t)) .\n" +
  "\n" +
  "//Present reference\n" +
  "#a s:: #b TEMP-REF #c T-REF 'pres' & #c EVAL #d ==>\n" +
  "#c T-REF' #e & #e GLUE lam(T,lam(T2,drs([],[rel(overlap,T,T2)]))) : (#c_s -o (#d_s -o #c_t)).\n" +
  "\n" +
  "//Non-future\n" +
  "#a s:: #b TEMP-REF #c T-REF 'non-future' & #c EVAL #d ==>\n" +
  "#c T-REF' #e & #e GLUE lam(T,lam(T2,drs([],[rel(nonfut,T,T2)]))) : (#c_s -o (#d_s -o #c_t)).\n" +
  "\n" +
  "\n" +
  "//Non-past\n" +
  "#a s:: #b TEMP-REF #c T-REF 'non-past' & #c EVAL #d ==>\n" +
  "#c T-REF' #e & #e GLUE lam(T,lam(T2,drs([],[rel(nonpast,T,T2)]))) : (#c_s -o (#d_s -o #c_t)).\n" +
  "\n" +
  "//Future reference\n" +
  "#a s:: #b TEMP-REF #c T-REF 'future' & #c EVAL #d ==>\n" +
  "#c T-REF' #e & #e GLUE lam(T,lam(T2,drs([],[rel(after,T,T2)]))) : (#c_s -o (#d_s -o #c_t)).\n" +
  "\n" +
  "\n" +
  "//absolute tense closure -- fixed\n" +
  "#a s:: #b TEMP-REF #c T-REF %a & %a != 'undefined' & #c EVAL #d\n" +
  "==> #c GLUE lam(T,lam(P,lam(S,merge(drs([R],[]),merge(app(app(T,R),S),app(P,R)))))) : ((#c_s -o (#d_s -o #c_t)) -o ((#c_s -o #c_t) -o (#d_s -o #d_t))).\n" +
  "\n" +
  "//aspectual tense closure\n" +
  "#a s:: #b ASP-TENSE #c A-REF %a &\n" +
  "#b TEMP-REF #e &\n" +
  " %a != 'undefined'\n" +
  "==> #c GLUE lam(T,lam(P,lam(S,merge(drs([R],[]),merge(app(app(T,R),S),app(P,R)))))) : ((#c_s -o (#e_s -o #c_t)) -o ((#e_s -o #b_t) -o (#e_s -o #b_t))).\n" +
  "\n" +
  "//unspec absolute closure\n" +
  "#a s:: #b TEMP-REF #c T-REF %a & %a == 'undefined' & #c EVAL #d\n" +
  "==> #c GLUE lam(P,lam(S,merge(app(P,S),drs([],[])))) : ((#c_s -o #c_t) -o (#d_s -o #d_t)).\n" +
  "\n" +
  "#a EVAL #b\n" +
  "==> #b GLUE lam(P,merge(drs([T],[eq(T,now)]),app(P,T))) : ((#b_s -o #b_t) -o #b_t).\n" +
  "\n" +
  "#m COMP #n s:: #o TEMP-REF #a EVAL #b & #o SIT #s\n" +
  "==> #b GLUE lam(P,P) : ((#b_s -o #b_t) -o (#b_s -o #s_t)).\n" +
  "\n" +
  "#m XCOMP #n s:: #o TEMP-REF #a EVAL #b & #o SIT #s\n" +
  "==> #b GLUE lam(P,P) : ((#b_s -o #b_t) -o (#b_s -o #s_t)).";

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


  }

