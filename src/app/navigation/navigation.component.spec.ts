import { NO_ERRORS_SCHEMA } from '@angular/core';
import { RouterTestingModule } from '@angular/router/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { NavigationComponent } from './navigation.component';
import { DataService } from '../data.service';
import { LigerUdModelList, XLE_SOURCE } from '../models/models';
import { SyntaxSourceService } from '../syntax-source/syntax-source.service';
import { LigerWorkspaceService } from '../liger-workspace/liger-workspace.service';

describe('NavigationComponent', () => {
  let component: NavigationComponent;
  let fixture: ComponentFixture<NavigationComponent>;
  let syntaxSource: SyntaxSourceService;
  let models: LigerUdModelList;
  let workspace: { hasEdits: boolean };

  const toggle = (): HTMLInputElement => fixture.nativeElement.querySelector('input.ud-toggle');

  beforeEach(() => {
    models = { models: [], error: 'The Stanza service is not reachable' };
    workspace = { hasEdits: false };
    TestBed.configureTestingModule({
      imports: [RouterTestingModule],
      declarations: [NavigationComponent],
      providers: [
        { provide: DataService, useValue: { listUdModels: () => of(models) } },
        { provide: LigerWorkspaceService, useValue: workspace },
      ],
      // Shallow: the child components are not under test here.
      schemas: [NO_ERRORS_SCHEMA],
    });
    syntaxSource = TestBed.inject(SyntaxSourceService);
    fixture = TestBed.createComponent(NavigationComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('keeps the UD toggle disabled while no Stanza model answers, and says why', () => {
    expect(toggle().disabled).toBeTrue();
    expect(component.toggleTitle).toContain('not reachable');
  });

  it('enables it once Stanza answers, when the navigation opens', () => {
    models = { models: [{ id: 'en', language: 'English', package: 'combined' }], error: null };

    component.showNavigation();
    fixture.detectChanges();

    expect(toggle().disabled).toBeFalse();
  });

  it('switching it on parses with the first model; off goes back to XLE', () => {
    models = { models: [{ id: 'en', language: 'English', package: 'combined' }], error: null };
    component.showNavigation();
    fixture.detectChanges();

    toggle().click();
    fixture.detectChanges();
    expect(syntaxSource.source).toEqual({ kind: 'ud', model: 'en' });
    expect(toggle().checked).toBeTrue();

    // Stanza gone: a UD session can still be switched off.
    models = { models: [], error: 'gone' };
    component.showNavigation();
    fixture.detectChanges();
    expect(toggle().disabled).toBeFalse();
    toggle().click();
    fixture.detectChanges();
    expect(syntaxSource.source).toEqual(XLE_SOURCE);
  });

  it('refuses a switch while the LiGER rule set has unsaved edits: the other config would drop them', () => {
    models = { models: [{ id: 'en', language: 'English', package: null }], error: null };
    workspace.hasEdits = true;
    component.showNavigation();
    fixture.detectChanges();

    toggle().click();
    fixture.detectChanges();

    expect(syntaxSource.isUd).toBeFalse();
    expect(component.notice).toContain('unsaved edits');
  });

  it('a refused switch leaves the toggle as it was and shows why', () => {
    models = { models: [{ id: 'en', language: 'English', package: null }], error: null };
    syntaxSource.addSwitchGuard(() => 'run in progress');
    component.showNavigation();
    fixture.detectChanges();

    toggle().click();
    fixture.detectChanges();

    expect(syntaxSource.source).toEqual(XLE_SOURCE);
    expect(toggle().checked).toBeFalse();
    expect(fixture.nativeElement.querySelector('.parser-notice').textContent).toContain('run in progress');
  });
});
