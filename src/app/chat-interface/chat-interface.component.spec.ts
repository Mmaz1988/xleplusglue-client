import { Component, NO_ERRORS_SCHEMA } from '@angular/core';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { FormsModule } from '@angular/forms';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ChatInterfaceComponent } from './chat-interface.component';
import { SyntaxSourceService } from '../syntax-source/syntax-source.service';

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

  it('switching between XLE and UD starts a new conversation whose document records the parser', () => {
    const before = component.chatDocumentSessionKey;
    // Shallow: the template refs are elements, not the child components.
    component.chatComponent = jasmine.createSpyObj('ChatComponent', ['resetConversationState']);
    component.historyComponent = jasmine.createSpyObj('HistoryComponent', ['clearSelection']);
    spyOn(component, 'startNewConversation').and.callThrough();

    TestBed.inject(SyntaxSourceService).select({ kind: 'ud', model: 'en' });

    expect(component.startNewConversation).toHaveBeenCalledTimes(1);
    expect(component.chatDocumentSessionKey).not.toBe(before);
    expect(component.chatDocument.parser).toEqual({ kind: 'ud', model: 'en' });
    expect(component.chatComponent.resetConversationState).toHaveBeenCalled();
  });
});
