import { Component, NO_ERRORS_SCHEMA } from '@angular/core';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { FormsModule } from '@angular/forms';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ChatInterfaceComponent } from './chat-interface.component';

/** Chat writes its defaults into both settings forms after view init. */
@Component({ selector: 'app-gswb-settings', template: '' })
class GswbSettingsStubComponent {
  gswbPreferences: any;
  updateFormFromPreferences(_: any) {}
}

@Component({ selector: 'app-inference-settings', template: '' })
class InferenceSettingsStubComponent {
  vampirePreferences: any;
  updateFormFromPreferences(_: any) {}
}

describe('ChatInterfaceComponent', () => {
  let component: ChatInterfaceComponent;
  let fixture: ComponentFixture<ChatInterfaceComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule, FormsModule],
      declarations: [ChatInterfaceComponent, GswbSettingsStubComponent, InferenceSettingsStubComponent],
      // Shallow: the child components are not under test here.
      schemas: [NO_ERRORS_SCHEMA],
    });
    fixture = TestBed.createComponent(ChatInterfaceComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
