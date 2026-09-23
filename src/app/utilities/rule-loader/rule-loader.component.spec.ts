import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { of, throwError } from 'rxjs';

import { RuleLoaderComponent } from './rule-loader.component';
import { DataService } from '../../data.service';
import { LigerRuleSet } from '../../models/models';

const CONFIG: LigerRuleSet = {
  kind: 'config',
  source: './liger_resources/rules/default.liger.yaml',
  semantics: 'semantics rules',
  pragmatics: 'pragmatics rules',
  lexica: ['/liger_resources/dicts/ling_dict_eng.txt'],
  axioms: 'fof(a, axiom, p).',
};

describe('RuleLoaderComponent', () => {
  let component: RuleLoaderComponent;
  let fixture: ComponentFixture<RuleLoaderComponent>;
  let dataServiceSpy: jasmine.SpyObj<DataService>;

  beforeEach(() => {
    dataServiceSpy = jasmine.createSpyObj('DataService', ['loadRules', 'getFileTree']);
    dataServiceSpy.loadRules.and.returnValue(of(CONFIG));
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

  it('emits the whole rule set, so hosts get the pragmatics rules with the semantics', () => {
    const emitted: LigerRuleSet[] = [];
    const loaded: { content: string; ruleSet: LigerRuleSet }[] = [];
    component.dataEmitter.subscribe(set => emitted.push(set));
    component.ruleLoaded.subscribe(event => loaded.push(event));

    component.selectedPath = CONFIG.source;
    component.updateRules();

    expect(dataServiceSpy.loadRules).toHaveBeenCalledWith({ grammar: CONFIG.source });
    expect(emitted).toEqual([CONFIG]);
    expect(loaded[0].content).toBe('semantics rules');
    expect(loaded[0].ruleSet.pragmatics).toBe('pragmatics rules');
    expect(component.currentStatusMessage).toContain('(config)');
  });

  it('shows why LiGER rejected a config', () => {
    dataServiceSpy.loadRules.and.returnValue(throwError(() => ({
      error: { error: "Unknown field 'semantic' in LiGER config x.yaml" },
    })));
    const emitted: LigerRuleSet[] = [];
    component.dataEmitter.subscribe(set => emitted.push(set));

    component.selectedPath = 'x.yaml';
    component.updateRules();

    expect(component.currentStatusMessage).toContain("Unknown field 'semantic'");
    expect(emitted).toEqual([]);
  });
});
