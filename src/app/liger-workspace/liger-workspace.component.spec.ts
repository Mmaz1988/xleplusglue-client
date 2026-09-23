import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { of } from 'rxjs';
import { EditorComponent } from '../editor/editor.component';
import { LigerFileSource } from './liger-file-source.service';
import { LigerWorkspaceComponent } from './liger-workspace.component';
import { LigerWorkspaceService } from './liger-workspace.service';
import { FILES, RULE_SET, TREE, fileSourceSpy } from './liger-workspace.testing';

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
  const fileButton = (name: string) => Array.from(root.querySelectorAll<HTMLButtonElement>('.row.file'))
    .find(button => button.querySelector('.label')!.textContent!.trim() === name)!;
  const click = (element: HTMLElement) => { element.click(); fixture.detectChanges(); };
  const button = (label: string) => Array.from(root.querySelectorAll<HTMLButtonElement>('.pane-toolbar button'))
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
    click(root.querySelector<HTMLButtonElement>('.tree-toggle')!);  // the tree starts hidden
  });

  it('starts with the tree hidden, and the toggle between tree and editor shows and hides it', () => {
    const fresh = TestBed.createComponent(LigerWorkspaceComponent);
    fresh.detectChanges();
    const el: HTMLElement = fresh.nativeElement;
    expect(el.querySelector('.pane.left')).toBeNull();
    expect(el.querySelector('app-editor')).not.toBeNull();

    el.querySelector<HTMLButtonElement>('.divider .tree-toggle')!.click();
    fresh.detectChanges();
    expect(el.querySelector('.pane.left')).not.toBeNull();

    el.querySelector<HTMLButtonElement>('.divider .tree-toggle')!.click();
    fresh.detectChanges();
    expect(el.querySelector('.pane.left')).toBeNull();
  });

  it('opens the default rule set and shows the first file', () => {
    expect(files.loadRuleSet).toHaveBeenCalledWith(component.defaultPath);
    expect(editorText()).toBe(FILES['/res/rules/a.liger']);
  });

  it('does not count the editor filling itself as an edit', () => {
    expect(workspace.hasEdits).toBeFalse();
    expect(root.querySelector('.edited')).toBeNull();
  });

  it('lists the sections in field order with their file counts, and marks what needs a look', () => {
    const fields = Array.from(root.querySelectorAll('.row.field'));
    const text = (row: Element, selector: string) => row.querySelector(selector)?.textContent?.trim();

    expect(fields.map(row => text(row, '.label'))).toEqual(['semantics', 'pragmatics', 'lexica', 'axioms']);
    expect(fields.map(row => text(row, '.badge'))).toEqual(['2', '1', '1', '1']);
    expect(text(fileButton('d.txt'), '.kind')).toBe('lock');
    expect(fileButton('x.p').querySelector('.outside')).not.toBeNull();
    expect(fileButton('a.liger').querySelector('.outside')).toBeNull();
    expect(root.querySelector('.warning')).toBeNull();
  });

  it('warns that post-processing is blocked when the rule set has no pragmatics', () => {
    files.loadRuleSet.and.returnValue(of({ ...RULE_SET, pragmatics: null }));
    files.listConfig.and.returnValue(of({
      ...TREE, sections: TREE.sections.map(s => s.field === 'pragmatics' ? { ...s, present: false, files: [] } : s),
    }));
    workspace.open('no-pragmatics.liger.yaml');
    fixture.detectChanges();

    expect(root.querySelector('.warning')?.textContent).toContain('post-processing is blocked');
    expect(Array.from(root.querySelectorAll('.row.field'))[1].classList).toContain('absent');
  });

  it('browses from the open config\'s scope, and ".." goes up from any folder', () => {
    click(root.querySelector<HTMLButtonElement>('.toolbar .primary')!);
    expect(files.browse).toHaveBeenCalledWith('/res/rules');

    const up = () => Array.from(root.querySelectorAll<HTMLButtonElement>('.row.field'))
      .find(row => row.querySelector('.label')!.textContent!.trim() === '..')!;
    click(up());
    expect(files.browse).toHaveBeenCalledWith('/res');
    click(up());
    expect(files.browse).toHaveBeenCalledWith('/');
  });

  it('opens only configs: a rule file is one stage, not a rule set', () => {
    files.browse.and.returnValue(of([
      { name: 'c.liger.yaml', path: '/r/c.liger.yaml', isDirectory: false, children: [] },
      { name: 'rules.liger', path: '/r/rules.liger', isDirectory: false, children: [] },
    ]));
    click(root.querySelector<HTMLButtonElement>('.toolbar .primary')!);
    files.loadRuleSet.calls.reset();

    const ruleFile = fileButton('rules.liger');
    expect(ruleFile.disabled).toBeTrue();
    component.openBrowsed('/r/rules.liger');
    expect(files.loadRuleSet).not.toHaveBeenCalled();

    click(fileButton('c.liger.yaml'));
    expect(files.loadRuleSet).toHaveBeenCalledWith('/r/c.liger.yaml');
  });

  it('collapses and expands a section', () => {
    const pragmatics = Array.from(root.querySelectorAll<HTMLButtonElement>('.row.field'))[1];

    click(pragmatics);
    expect(fileButton('p.liger')).toBeUndefined();

    click(pragmatics);
    expect(fileButton('p.liger')).toBeDefined();
  });

  it('keeps each file\'s edits when switching between files', () => {
    type('A EDITED');
    click(fileButton('p.liger'));
    expect(editorText()).toBe(FILES['/res/rules/p.liger']);

    click(fileButton('a.liger'));

    expect(editorText()).toBe('A EDITED');
    expect(fileButton('a.liger').querySelector('.edited')).not.toBeNull();
    expect(fileButton('p.liger').querySelector('.edited')).toBeNull();
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
    expect(root.querySelector('.notice')?.textContent).toContain('read from disk');

    click(fileButton('a.liger'));
    expect(codeMirror().getOption('readOnly')).toBeFalse();
  });

  it('opens a browsed file from the compact tree', () => {
    files.browse.and.returnValue(of([
      { name: 'sub', path: '/r/sub', isDirectory: true, children: [
        { name: 'x.liger.yaml', path: '/r/sub/x.liger.yaml', isDirectory: false, children: [] },
      ] },
    ]));
    click(root.querySelector<HTMLButtonElement>('.toolbar .primary')!);
    click(Array.from(root.querySelectorAll<HTMLButtonElement>('.row.field'))
      .find(row => row.textContent!.includes('sub'))!);

    click(fileButton('x.liger.yaml'));

    expect(files.loadRuleSet).toHaveBeenCalledWith('/r/sub/x.liger.yaml');
    expect(component.browsing).toBeFalse();
  });

  it('follows an edit made through the service, as another view\'s workspace would', () => {
    workspace.edit('/res/rules/a.liger', 'EDITED ELSEWHERE');
    fixture.detectChanges();

    expect(editorText()).toBe('EDITED ELSEWHERE');
  });
});
