import { NO_ERRORS_SCHEMA } from '@angular/core';
import { RouterTestingModule } from '@angular/router/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { NavigationComponent } from './navigation.component';
import { DataService } from '../data.service';
import { LigerUdModelList, XLE_SOURCE } from '../models/models';
import { SyntaxSourceService } from '../syntax-source/syntax-source.service';

describe('NavigationComponent', () => {
  let component: NavigationComponent;
  let fixture: ComponentFixture<NavigationComponent>;
  let syntaxSource: SyntaxSourceService;
  let models: LigerUdModelList;

  const toggle = (): HTMLInputElement => fixture.nativeElement.querySelector('input.ud-toggle');

  beforeEach(() => {
    models = { models: [], error: 'The Stanza service is not reachable' };
    TestBed.configureTestingModule({
      imports: [RouterTestingModule],
      declarations: [NavigationComponent],
      providers: [{ provide: DataService, useValue: { listUdModels: () => of(models) } }],
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
