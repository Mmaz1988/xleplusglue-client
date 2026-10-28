import { NO_ERRORS_SCHEMA } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import * as CodeMirror from 'codemirror';

import { EditorComponent } from './editor.component';

describe('EditorComponent', () => {
  let component: EditorComponent;
  let fixture: ComponentFixture<EditorComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [FormsModule],
      declarations: [EditorComponent],
      // Shallow: the child components are not under test here.
      schemas: [NO_ERRORS_SCHEMA],
    });
    fixture = TestBed.createComponent(EditorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('highlights every rule arrow as one token', () => {
    const mode = CodeMirror.getMode({}, 'liger');
    const arrows = (line: string): string[] => {
      const stream = new CodeMirror.StringStream(line, 2);
      const state = CodeMirror.startState(mode);
      const found: string[] = [];
      while (!stream.eol()) {
        const style = mode.token!(stream, state);
        if (style === 'rule_separator') {
          found.push(stream.current());
        }
        stream.start = stream.pos;
      }
      return found;
    };

    for (const arrow of ['==>', '=->', '?+=>', '?*=>', '?=>', '?->']) {
      expect(arrows(`#a X #b ${arrow} #a Y #b.`)).withContext(arrow).toEqual([arrow]);
    }
  });
});
