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

    // The bar between tree and editor stays, inside the workspace's frame, with the toggle on it.
    expect(el.querySelector('.liger-workspace > .divider .tree-toggle')).not.toBeNull();
    el.querySelector<HTMLButtonElement>('.divider .tree-toggle')!.click();
    fresh.detectChanges();
    expect(el.querySelector('.pane.left')).not.toBeNull();

    el.querySelector<HTMLButtonElement>('.divider .tree-toggle')!.click();
    fresh.detectChanges();
    expect(el.querySelector('.pane.left')).toBeNull();
    expect(el.querySelector('.divider .tree-toggle')).not.toBeNull();
  });

  it('is an editor\'s height plus its toolbar, from the shared --editor-height', () => {
    root.style.setProperty('--editor-height', '200px');

    expect(getComputedStyle(root.querySelector('.liger-workspace')!).height).toBe('230px');
  });

  it('splits its own box when the tree opens: the box keeps its width', () => {
    root.style.width = '600px';
    const box = root.querySelector<HTMLElement>('.liger-workspace')!;
    const width = box.getBoundingClientRect().width;
    const editorPane = root.querySelector<HTMLElement>('.pane.right')!;
    const editorOpen = editorPane.getBoundingClientRect().width;

    click(root.querySelector<HTMLButtonElement>('.divider .tree-toggle')!);  // hide the tree
    expect(box.getBoundingClientRect().width).toBe(width);
    expect(editorPane.getBoundingClientRect().right).toBe(box.getBoundingClientRect().right - 3);
    expect(editorPane.getBoundingClientRect().width).toBeGreaterThan(editorOpen);
  });

  it('shows its own file: two views of one rule set open on different sections and share edits', () => {
    const post = TestBed.createComponent(LigerWorkspaceComponent);
    post.componentInstance.preferField = 'pragmatics';
    post.detectChanges();
    const postEditor = () => post.componentInstance.editor!.getContent();

    expect(editorText()).toBe(FILES['/res/rules/a.liger']);
    expect(postEditor()).toBe(FILES['/res/rules/p.liger']);

    // Editing pragmatics in post-processing reaches the parse view's copy of that file.
    post.componentInstance.onEditorChange('P EDITED');
    click(fileButton('p.liger'));
    expect(editorText()).toBe('P EDITED');
    // Selecting a file in one view does not switch the other.
    expect(postEditor()).toBe('P EDITED');
    click(fileButton('a.liger'));
    post.detectChanges();
    expect(postEditor()).toBe('P EDITED');
    expect(workspace.pragmatics).toContain('P EDITED');
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
    // Rules per stage, labels in the lexica, formulas in the axioms: totals of the files' counts.
    expect(fields.map(row => text(row, '.badge'))).toEqual(['5', '13', '40', '5']);
    expect(text(fileButton('a.liger'), '.badge')).toBe('3');
    expect(fileButton('a.liger').querySelector('.badge')!.getAttribute('title')).toBe('3 rules');
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

  it('browses from the open config\'s scope, and ".." stops at the project\'s grammars folder', () => {
    click(root.querySelector<HTMLButtonElement>('.toolbar .primary')!);
    expect(files.browse).toHaveBeenCalledWith('/res/rules');

    const up = () => Array.from(root.querySelectorAll<HTMLButtonElement>('.row.field'))
      .find(row => row.querySelector('.label')!.textContent!.trim() === '..');
    click(up()!);
    expect(files.browse).toHaveBeenCalledWith('/res');

    expect(up()).toBeUndefined();
    component.browseUp();
    expect(files.browse).not.toHaveBeenCalledWith('/');
  });

  it('starts browsing at the grammars folder when the open rule set lies outside it', () => {
    files.listConfig.and.returnValue(of({ ...TREE, scope: '/elsewhere/rules' }));
    workspace.open('/elsewhere/rules/c.liger.yaml');
    fixture.detectChanges();

    click(root.querySelector<HTMLButtonElement>('.toolbar .primary')!);

    expect(files.browse).toHaveBeenCalledWith('/res');
  });

  it('shows an opened rule file as the one file it is, not as a config with empty sections', () => {
    files.loadRuleSet.and.returnValue(of({ ...RULE_SET, kind: 'rules', source: '/r/rules.liger',
      pragmatics: null, lexica: [], axioms: null }));
    files.listConfig.and.returnValue(of({
      kind: 'rules', source: '/r/rules.liger', scope: '/r', projectRoot: null,
      sections: [
        { field: 'semantics', present: true, files: [{ path: '/r/rules.liger', name: 'rules.liger', inScope: true, count: 7 }] },
        { field: 'pragmatics', present: false, files: [] },
        { field: 'lexica', present: false, files: [] },
        { field: 'axioms', present: false, files: [] },
      ],
    }));
    files.read.and.returnValue(of('RULES\n'));
    files.browse.and.returnValue(of([
      { name: 'rules.liger', path: '/r/rules.liger', isDirectory: false, children: [] },
    ]));
    click(root.querySelector<HTMLButtonElement>('.toolbar .primary')!);

    click(fileButton('rules.liger'));

    expect(files.loadRuleSet).toHaveBeenCalledWith('/r/rules.liger');
    expect(root.querySelectorAll('.row.field').length).toBe(0);
    expect(fileButton('rules.liger').querySelector('.badge')?.textContent).toContain('rule file');
    expect(fileButton('rules.liger').textContent).toContain('7');
    expect(root.querySelector('.warning')?.textContent).toContain('semantics rules only');
    expect(editorText()).toBe('RULES\n');
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

  it('marks a count as from disk while its file is edited in memory', () => {
    type('A EDITED');

    expect(fileButton('a.liger').querySelector('.badge')!.textContent!.trim()).toBe('3*');
    expect(fileButton('a.liger').querySelector('.badge')!.getAttribute('title')).toContain('on disk');
    expect(Array.from(root.querySelectorAll('.row.field'))[0].querySelector('.badge')!.textContent!.trim()).toBe('5*');
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
