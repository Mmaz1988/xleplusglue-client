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
  "//Nounmodifiers\n" +
  "#n MOD #m in_set #p PRED %p & #p TYPE %k & #n s:: #s ==>\n" +
  "#p GLUE lam(P,lam(X,merge(drs([],[rel(%k,'strip(%p)',X)]),app(P,X)))) : ((#s_e -o #s_t) -o (#s_e -o #s_t)) || noscope.\n" +
  "\n" +
  "\n" +
  "//Degree (gradable) adjectives\n" +
  "#x PREDLINK #a & #x s:: #y EV #z &\n" +
  "#a ATYPE 'predicative' & #a SEMTYPE 'degree' &\n" +
  "#a SUBJ #b s:: #c &\n" +
  "#a PRED %a &  #a s:: #s\n" +
  "==> & #s DEGREE #d & #s DEGREE-HOLDER #z & #s DEGREE-PRED #p &\n" +
  "#p GLUE lam(P,lam(D,lam(X,drs([],[rel(strip(%a),X,D)])))) : ((#s_v -o #s_t) -o (#d_d -o (#s_v -o #s_t))).\n" +
  "\n" +
  "//This works\n" +
  "#x ADJUNCT #n in_set #a & #x s:: #y &\n" +
  "#a ATYPE 'attributive' & #a SEMTYPE 'degree' &\n" +
  "#a PRED %a & #a s:: #s\n" +
  "==> #s DEGREE #d & #s DEGREE-HOLDER #y & #s DEGREE-PRED #p &\n" +
  "#p GLUE lam(P,lam(D,lam(X,drs([],[rel(strip(%a),X,D)])))) : ((#s_e -o #s_t) -o (#d_d -o (#s_e -o #s_t))).\n" +
  "\n" +
  "\n" +
  "// Rules for positive uses\n" +
  "// attributive\n" +
  "#x ADJUNCT #n in_set #a & #x PRED %x &\n" +
  "#a ATYPE 'attributive' &\n" +
  "#a PRED %a & #a s:: #b DEGREE #d & #b DEGREE-HOLDER #e\n" +
  "==> #d GLUE lam(P,merge(drs([D],[]),merge(drs([],[eq(th_strip(%a)('strip(%x)'),D)]),app(P,D)))) : ((#d_d -o #e_t) -o #e_t) || noscope.\n" +
  "\n" +
  "// predicative\n" +
  "#x PREDLINK #a & #x SUBJ #y PRED %x &\n" +
  "#a ATYPE 'predicative' &\n" +
  "#a PRED %a & #a s:: #b DEGREE #d & #b DEGREE-HOLDER #e\n" +
  "==> #d GLUE lam(P,merge(drs([D],[]),merge(drs([],[eq(th_strip(%a)('strip(%x)'),D)]),app(P,D)))) : ((#d_d -o #e_t) -o #e_t) || noscope.\n" +
  "\n" +
  "//Rules for comparative uses\n" +
  "#a ATYPE %u & #a DEGREE 'comparative' & #a PRED %p &\n" +
  "#a s:: #b DEGREE #d & #b DEGREE-HOLDER #e & #b DEGREE-PRED #p &\n" +
  "#a ADJUNCT #f in_set #c OBL-COMP #m OBJ #n s:: #o\n" +
  "==>\n" +
  "#o DEGREE #x & #o DEGREE-HOLDER #y &\n" +
  "#d GLUE lam(P,lam(Q,lam(E,\n" +
  "\t\tmerge(drs([D:d],[]),merge(app(app(P,D),E),drs([],[not(merge(drs([V],[]),app(app(Q,D),V)))])))))) :\n" +
  "\t\t((#d_d -o (#b_v -o #b_t)) -o ((#x_d -o (#y_v -o #m_t)) -o (#b_v -o #b_t))) || noscope &\n" +
  "#m GLUE lam(D,lam(E,drs([],[rel(strip(%p),E,D)]))) : (#x_d -o (#y_v -o #m_t)) &\n" +
  "#n GLUE lam(V,lam(X,lam(E,merge(app(V,E),drs([],[rel(arg1,E,X)]))))) :\n" +
  "\t\t((#y_v -o #m_t) -o (#o_e -o (#y_v -o #m_t))).\n" +
  "\n" +
  "//Axioms\n" +
  "\n" +
  "//Be equality axiom\n" +
  "#p PRED %p & strip(%p) == 'be' & #p PREDLINK #c s:: #s TYPE 'entity' ==>\n" +
  "#p AXIOM all(X,all(Y,all(Z,imp(and(be(X),and(arg1(X,Y),arg2(X,Z))),eq(Y,Z))))).\n" +
  "\n" +
  "//Comparative axioms\n" +
  "#a ATYPE %u & #a DEGREE 'comparative' & #a PRED %p ==>\n" +
  "#a AXIOM all(X, all(Y, all(D:d, imp(and(arg1(X, Y), fast(X, D)), fast(Y, D))))).\n" +
  "\n" +
  "#a ATYPE %u & #a DEGREE 'comparative' & #a PRED %p &\n" +
  "#a s:: #b DEGREE #d & #b DEGREE-HOLDER #e & #b DEGREE-PRED #p &\n" +
  "#a ADJUNCT #f in_set #c OBL-COMP #m OBJ #n s:: #o ==>\n" +
  "#a MONO #q & #q AXIOM all(X, all(Delta1:d, iff(strip(%p)(X, Delta1), all(Delta2:d, imp(lessEq(Delta2, Delta1), strip(%p)(X, Delta2)))))) &\n" +
  "#a CP #r & #r AXIOM all(X, all(Y, imp(some(D:d, and(strip(%p)(X, D), not(strip(%p)(Y, D)))), all(D2:d, imp(strip(%p)(Y, D2), strip(%p)(X, D2)))))) &\n" +
  "#a MAX #s & #s AXIOM all(X, some(Delta1:d, and(strip(%p)(X, Delta1), not(some(Delta2:d, and(greater(Delta2, Delta1), strip(%p)(X, Delta2))))))).\n" +
  "\n";

const VAMPIRE_DEFAULT_AXIOMS = "tff(fast_type, type, fast: ($i * $int) > $o).\n" +
  "tff(kind_type, type, kind: ($i * $i) > $o).\n" +
  "tff(arg1_type, type, arg1: ($i * $i) > $o).\n" +
  "tff(arg2_type, type, arg2: ($i * $i) > $o).\n" +
  "tff(computer_type, type, computer: $i > $o).\n" +
  "tff(be_type, type, be: $i > $o).\n" +
  "\n" +
  "tff(pn_type1, type, 'pc-6082': $i).\n" +
  "tff(pn_type2, type, 'itel-zx': $i).\n"

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


  }

