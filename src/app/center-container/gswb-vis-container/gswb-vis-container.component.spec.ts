import { Component, NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';

import { GswbVisContainerComponent } from './gswb-vis-container.component';
import { GswbVisComponent } from '../../gswb-vis/gswb-vis.component';
import { EditorComponent } from '../../editor/editor.component';
import { DataService } from '../../data.service';
import { DocumentBuilderService } from '../../document-builder/document-builder.service';
import { APP_DEFAULTS } from '../../app-defaults';

/** gswb-vis writes the default preferences into its settings form after view init. */
@Component({ selector: 'app-gswb-settings', template: '' })
class GswbSettingsStubComponent {
  gswbPreferences: any;
  updateFormFromPreferences(_: any) {}
}

describe('GswbVisContainerComponent', () => {
  let fixture: ComponentFixture<GswbVisContainerComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [FormsModule],
      // The real view and editor: the demo premises go from the container through gswb-vis
      // into the editor, and the editor reports them back as an edit.
      declarations: [GswbVisContainerComponent, GswbVisComponent, EditorComponent, GswbSettingsStubComponent],
      providers: [
        { provide: DataService, useValue: {} },
        { provide: DocumentBuilderService, useValue: {} },
      ],
      // The rest of gswb-vis's children are not under test here.
      schemas: [NO_ERRORS_SCHEMA],
    });
    fixture = TestBed.createComponent(GswbVisContainerComponent);
  });

  // In zone with dev-mode checks on, so a binding changed after its check throws here.
  it('opens the standalone view with the demo premises, without a change-detection error', () => {
    expect(() => fixture.detectChanges()).not.toThrow();

    const vis = fixture.debugElement.children[0].query(c => c.componentInstance instanceof GswbVisComponent)
      .componentInstance as GswbVisComponent;
    expect(vis.editor1.getContent()).toBe(APP_DEFAULTS.gswb.demoPremises);
    expect(vis.meaningConstructors).toBe(APP_DEFAULTS.gswb.demoPremises);
  });
});
