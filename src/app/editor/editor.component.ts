import { Component, ViewChild, ElementRef, AfterViewInit, Input, ViewEncapsulation } from '@angular/core';
import * as CodeMirror from 'codemirror';


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

const DEFAULT_TEST_SUITE = "John loves Mary.\n\n" +
                            "Every man loved a woman.\n\n" +
                            "Mary said that Susan was sick.\n\n" +
                            "If Mary was sick, she would be sleeping.\n\n" +
                            "Mary married a man who smiled.\n\n" +
                            "Mary was dancing.\n\n" +
                            "Mary seems to smile.\n\n" +
                            "If Mary trained, she is sleeping.\n\n" +
                            "A man saw the monkey with the telescope.\n\n" +
                            "A woman will visit the cinema.\n\n" +
                            "Peter had visited the cinema.\n\n" +
                            "Peter wanted to visit Mary.\n\n" +
                            "Mary gave Peter a letter.\n\n";




const LIGER_DEFAULT_RULES = "--replace(true);\n" +
  "\n" +
  "#a TNS-ASP #b & #a s:: #c SIT #d & #c TEMP-REF #e ==> & #e T-REF 'undefined'.\n" +
  "\n" +
  "//Tier 1 rules\n" +
  "#a TNS-ASP #b TENSE 'past' & #a s:: #c TEMP-REF #d & #d T-REF 'undefined' ==>  #d T-REF 'past'.\n" +
  "#a TNS-ASP #b TENSE 'pres' & #a :: #c TEMP-REF #d & #d T-REF 'undefined' ==>  #d T-REF 'pres'.\n" +
  "#a TNS-ASP #b TENSE 'fut' & #a s:: #c TEMP-REF #d & #d T-REF 'undefined' ==>  #d T-REF 'fut'.\n" +
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
  "#b !(>TEMP-REF) #c T-REF 'pres' \n" +
  "==> #a T-REF 'non-past'.\n" +
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
  " ==>  #c GLUE lam(M,lam(P,lam(S,drs([],[imp(merge(drs([Z],[]),app(app(M,S),Z)),app(P,Z))])))) : ((#d_s -o (#e_s -o #c_t)) -o ((#g_s -o #b_t) -o (#f_s -o #b_t))).\n" +
  "\n" +
  "//prv closure -- fixed \n" +
  "#a s:: #b VIEWPOINT #c ASPECT 'prv' &\n" +
  "#c VAR #d & #c RESTR #e &\n" +
  "#b TEMP-REF #f &\n" +
  "#b SIT #g\n" +
  " ==>  #c GLUE lam(M,lam(P,lam(S,merge(drs([Z],[]),merge(app(app(M,S),Z),app(P,Z)))))) : ((#d_s -o (#e_s -o #c_t)) -o ((#g_s -o #b_t) -o (#f_s -o #b_t))).\n" +
  "\n" +
  "#a s:: #b VIEWPOINT #c ASPECT 'undefined' &\n" +
  "#b TEMP-REF #f &\n" +
  "#b SIT #g\n" +
  " ==>  #c GLUE lam(P,lam(S,merge(drs([],[]),app(P,S)))) : ((#g_s -o #b_t) -o (#f_s -o #b_t)).\n" +
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
  "//absolute tense closure -- fixed \n" +
  "#a s:: #b TEMP-REF #c T-REF %a & %a != 'undefined' & #c EVAL #d \n" +
  "==> #c GLUE lam(T,lam(P,lam(S,merge(drs([R],[]),merge(app(app(T,R),S),app(P,R)))))) : ((#c_s -o (#d_s -o #c_t)) -o ((#c_s -o #b_t) -o (#d_s -o #b_t))).\n" +
  "\n" +
  "//aspectual tense closure\n" +
  "#a s:: #b ASP-TENSE #c A-REF %a &\n" +
  "#b TEMP-REF #e &\n" +
  " %a != 'undefined'\n" +
  "==> #c GLUE lam(T,lam(P,lam(S,merge(drs([R],[]),merge(app(app(T,R),S),app(P,R)))))) : ((#c_s -o (#e_s -o #c_t)) -o ((#e_s -o #b_t) -o (#e_s -o #b_t))).\n" +
  "\n" +
  "//unspec absolute closure\n" +
  "#a s:: #b TEMP-REF #c T-REF %a & %a == 'undefined' & #c EVAL #d\n" +
  "==> #c GLUE lam(P,lam(S,merge(app(P,S),drs([],[])))) : ((#c_s -o #b_t) -o (#d_s -o #b_t)).\n" +
  "\n" +
  "\n" +
  "\n" +
  "//#a s:: #b TEMP-REF #c T-REF 'pres' & #c EVAL #d ==> #c GLUE [/P_<s,t>.[/s_s.Er_s[equals(r,s) \\& P(r)]]] : ((#c -o #b) -o (#d -o #b)).\n" +
  "\n" +
  "// #a s:: #b ASP-TENSE #c A-REF 'past' & #b TEMP-REF #d ==>  #c GLUE [/P_<s,t>.[/s_s.Er_s[before(r,s) \\& P(r)]]] : ((#d -o #b) -o (#d -o #b)).\n" +
  "\n" +
  "//#a s:: #b ASP-TENSE #c A-REF 'undefined' & #b TEMP-REF #d ==>  #c GLUE [/P_<s,t>.[/s_s.P(s)]] : ((#d -o #b) -o (#d -o #b)).\n" +
  "#a s:: #b ASP-TENSE #c A-REF 'undefined' & #b TEMP-REF #d ==>  #c GLUE lam(P,lam(S,merge(app(P,S),drs([],[])))) : ((#d_s -o #b_t) -o (#d_s -o #b_t)).\n";

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
      viewPortMargin: Infinity
    });

    if (this.mode == "liger" ) {
      this.codeMirror.setValue(LIGER_DEFAULT_RULES);

    }

    if (this.mode == "text")  {
      this.codeMirror.setValue(DEFAULT_TEST_SUITE);
    }


      this.codeMirror.setOption("lineNumbers", true);



  }


  updateContent(value: string): void {
    if (this.codeMirror) {
      this.codeMirror.setValue("");
      this.codeMirror.clearHistory();
      this.codeMirror.setValue(value);
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

