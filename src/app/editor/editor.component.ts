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

const DEFAULT_TEST_SUITE = "A big black dog appeared.\n\n" +
                            "Mary gave a student every grade.\n\n";




const LIGER_DEFAULT_RULES = "";

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

