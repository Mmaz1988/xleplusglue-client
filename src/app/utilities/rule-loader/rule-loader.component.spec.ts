import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { of } from 'rxjs';

import { RuleLoaderComponent } from './rule-loader.component';
import { DataService } from '../../data.service';

describe('RuleLoaderComponent', () => {
  let component: RuleLoaderComponent;
  let fixture: ComponentFixture<RuleLoaderComponent>;

  beforeEach(() => {
    const dataServiceSpy = jasmine.createSpyObj('DataService', ['loadRules', 'getFileTree']);
    dataServiceSpy.loadRules.and.returnValue(of({ grammar: 'default rule content' }));
    dataServiceSpy.getFileTree.and.returnValue(of({ children: [] }));

    TestBed.configureTestingModule({
      declarations: [RuleLoaderComponent],
      providers: [{ provide: DataService, useValue: dataServiceSpy }],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    });
    fixture = TestBed.createComponent(RuleLoaderComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('clears the status message when the parent resets loadedPath to empty', () => {
    // Simulates a real load having populated the status message, without depending on
    // ngOnInit's own async default-rules flow (which exercises unrelated ViewChild/
    // toggleDisplayComponent wiring not relevant to this fix).
    component.loadedPath = './liger_resources/rules/degree_rules_lfgxdrt.liger';
    component.loadedContent = 'loaded text';
    component.currentContent = 'loaded text';
    (component as any).refreshStatusMessage();
    expect(component.currentStatusMessage).toContain('Currently loaded rules');

    // A parent reset (new session, or hydrating a session with no rules file loaded) sets
    // the loadedPath @Input back to '' -- simulated here the same way the actual
    // ngOnChanges-triggered call does, by invoking the private handler directly.
    component.loadedPath = '';
    (component as any).refreshStatusMessage();

    // Before the fix, this silently returned and left the stale "Currently loaded rules:
    // ..." message on screen, even though the rules file backing it had been cleared --
    // exactly what made a missing-axioms failure look like a working setup.
    expect(component.currentStatusMessage).toBe('');
  });
});
