import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EditorComponent } from '../editor/editor.component';
import { LigerFileSource } from './liger-file-source.service';
import { LigerWorkspaceComponent } from './liger-workspace.component';
import { LigerWorkspaceService } from './liger-workspace.service';
import { FILES, fileSourceSpy } from './liger-workspace.testing';

/** Driven through TestBed with the real app-editor, so change detection and the editor's
 *  own contentChange emissions are part of what is tested. */
describe('LigerWorkspaceComponent', () => {
  let fixture: ComponentFixture<LigerWorkspaceComponent>;
  let component: LigerWorkspaceComponent;
  let workspace: LigerWorkspaceService;
  let files: jasmine.SpyObj<LigerFileSource>;
  let root: HTMLElement;

  const codeMirror = (): any => (component.editor as any).codeMirror;
  /** What the user sees in the pane. */
  const editorText = () => component.editor!.getContent();
  /** Typing, as far as app-editor can tell: a change CodeMirror reports. */
  const type = (text: string) => { codeMirror().setValue(text); fixture.detectChanges(); };
  const fileButton = (name: string) => Array.from(root.querySelectorAll<HTMLButtonElement>('.ws-file'))
    .find(button => button.textContent!.trim().startsWith(name))!;
  const click = (element: HTMLElement) => { element.click(); fixture.detectChanges(); };
  const button = (label: string) => Array.from(root.querySelectorAll<HTMLButtonElement>('.ws-toolbar button'))
    .find(b => b.textContent!.trim() === label)!;

  beforeEach(() => {
    files = fileSourceSpy();
    TestBed.configureTestingModule({
      declarations: [LigerWorkspaceComponent, EditorComponent],
      imports: [FormsModule],
      providers: [{ provide: LigerFileSource, useValue: files }],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    });
    fixture = TestBed.createComponent(LigerWorkspaceComponent);
    component = fixture.componentInstance;
    workspace = TestBed.inject(LigerWorkspaceService);
    root = fixture.nativeElement;
    fixture.detectChanges();
  });

  it('opens the default rule set and shows the first file', () => {
    expect(files.loadRuleSet).toHaveBeenCalledWith(component.defaultPath);
    expect(editorText()).toBe(FILES['/res/rules/a.liger']);
  });

  it('does not count the editor filling itself as an edit', () => {
    expect(workspace.hasEdits).toBeFalse();
    expect(root.querySelector('.ws-edited')).toBeNull();
  });

  it('lists the sections in field order and marks the inherited ones', () => {
    const summaries = Array.from(root.querySelectorAll('.ws-section summary')).map(s => s.textContent!.trim());

    expect(summaries.map(s => s.split(/\s+/)[0])).toEqual(['semantics', 'pragmatics', 'lexica', 'axioms']);
    expect(summaries[0]).not.toContain('from');
    expect(summaries[1]).toContain('from default.liger.yaml');
    expect(fileButton('d.txt').textContent).toContain('read-only');
  });

  it('keeps each file\'s edits when switching between files', () => {
    type('A EDITED');
    click(fileButton('p.liger'));
    expect(editorText()).toBe(FILES['/res/rules/p.liger']);

    click(fileButton('a.liger'));

    expect(editorText()).toBe('A EDITED');
    expect(fileButton('a.liger').querySelector('.ws-edited')).not.toBeNull();
    expect(fileButton('p.liger').querySelector('.ws-edited')).toBeNull();
    expect(workspace.semantics).toContain('A EDITED');
  });

  it('does not change the rule text by switching files', () => {
    type('A EDITED');  // semantics is now assembled client-side
    const seen: (string | null)[] = [];
    const subscriptions = [workspace.semantics$, workspace.pragmatics$]
      .map(text$ => text$.subscribe(text => seen.push(text)));

    click(fileButton('p.liger'));
    click(fileButton('a.liger'));
    subscriptions.forEach(s => s.unsubscribe());

    expect(seen.length).toBe(2);  // each stream's current value, nothing after
    expect(editorText()).toBe('A EDITED');
  });

  it('reverts the active file', () => {
    type('A EDITED');
    expect(button('Revert').disabled).toBeFalse();

    click(button('Revert'));

    expect(editorText()).toBe(FILES['/res/rules/a.liger']);
    expect(workspace.hasEdits).toBeFalse();
    expect(button('Revert').disabled).toBeTrue();
  });

  it('shows a lexicon read-only, and says why', () => {
    click(fileButton('d.txt'));

    expect(editorText()).toBe(FILES['/res/dicts/d.txt']);
    expect(codeMirror().getOption('readOnly')).toBeTrue();
    expect(root.querySelector('.ws-note')?.textContent).toContain('read from disk');

    click(fileButton('a.liger'));
    expect(codeMirror().getOption('readOnly')).toBeFalse();
  });

  it('follows an edit made through the service, as another view\'s workspace would', () => {
    workspace.edit('/res/rules/a.liger', 'EDITED ELSEWHERE');
    fixture.detectChanges();

    expect(editorText()).toBe('EDITED ELSEWHERE');
  });
});
