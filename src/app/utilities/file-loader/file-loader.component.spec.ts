import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { of } from 'rxjs';

import { FileLoaderComponent } from './file-loader.component';
import { DataService } from '../../data.service';

describe('FileLoaderComponent', () => {
  let component: FileLoaderComponent;
  let fixture: ComponentFixture<FileLoaderComponent>;

  beforeEach(() => {
    const dataServiceSpy = jasmine.createSpyObj('DataService', ['loadRules', 'getFileTree']);
    dataServiceSpy.loadRules.and.returnValue(of({ grammar: 'default file content' }));
    dataServiceSpy.getFileTree.and.returnValue(of({ children: [] }));

    TestBed.configureTestingModule({
      declarations: [FileLoaderComponent],
      providers: [{ provide: DataService, useValue: dataServiceSpy }],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    });
    fixture = TestBed.createComponent(FileLoaderComponent);
    component = fixture.componentInstance;
    component.defaultFilePath = './testsuites/inference/inference-basic.lfg';
    component.filesDirectory = './testsuites/';
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('clears the status message when the parent resets loadedPath to empty', () => {
    // Simulates a real load having populated the status message, without depending on
    // ngOnInit's own async defaultFilePath flow (which exercises unrelated ViewChild/
    // toggleDisplayComponent wiring not relevant to this fix).
    component.loadedPath = './testsuites/inference/inference-basic.lfg';
    component.loadedContent = 'loaded text';
    component.currentContent = 'loaded text';
    (component as any).refreshStatusMessage();
    expect(component.currentStatusMessage).toContain('Currently loaded');

    // A parent reset (new session, or hydrating a session with no file loaded) sets the
    // loadedPath @Input back to '' -- simulated here the same way the actual
    // ngOnChanges-triggered call does, by invoking the private handler directly.
    component.loadedPath = '';
    (component as any).refreshStatusMessage();

    // Before the fix, this silently returned and left the stale "Currently loaded ...: ..."
    // message on screen, even though the file backing it had been cleared -- the same bug
    // as RuleLoaderComponent's, which is what surfaced this (see REGRESSION_ALIGNMENT_PLAN.md).
    expect(component.currentStatusMessage).toBe('');
  });
});
