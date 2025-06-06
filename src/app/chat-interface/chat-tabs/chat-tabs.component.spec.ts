import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ChatTabsComponent } from './chat-tabs.component';

describe('ChatTabsComponent', () => {
  let component: ChatTabsComponent;
  let fixture: ComponentFixture<ChatTabsComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [ChatTabsComponent]
    });
    fixture = TestBed.createComponent(ChatTabsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
