import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { GrammarLoaderComponent } from './grammar-loader.component';
import { sameFile, serverRelative } from '../../liger-workspace/liger-paths';
import { LigerFileSource } from '../../liger-workspace/liger-file-source.service';
import { LigerWorkspaceService } from '../../liger-workspace/liger-workspace.service';
import { RULE_SET, fileSourceSpy } from '../../liger-workspace/liger-workspace.testing';

/**
 * Loading a grammar opens its LiGER config, unless one was picked by hand or a session's is
 * being restored. Built by hand: GrammarLoaderComponent's TestBed spec needs HttpClient it
 * is not given. The workspace is the real one, over a fake file source.
 */
describe('GrammarLoaderComponent, the grammar\'s LiGER config', () => {
  const PREFIXED = '/Users/me/liger/./grammars/dev/g/liger/g.liger.yaml';
  const RELATIVE = './grammars/dev/g/liger/g.liger.yaml';
  let files: jasmine.SpyObj<LigerFileSource>;
  let workspace: LigerWorkspaceService;
  let loader: GrammarLoaderComponent;

  beforeEach(() => {
    files = fileSourceSpy();
    files.listConfigsForGrammar.and.returnValue(of([PREFIXED]));
    TestBed.configureTestingModule({ providers: [{ provide: LigerFileSource, useValue: files }] });
    workspace = TestBed.inject(LigerWorkspaceService);
    spyOn(workspace, 'open').and.callThrough();
    loader = new GrammarLoaderComponent({} as any, { detectChanges: () => {} } as any, files, workspace);
    loader.loadedPath = './grammars/dev/g/g.lfg';
  });

  it('reads LiGER\'s prefixed paths back as the relative ones sessions store', () => {
    expect(serverRelative(PREFIXED)).toBe(RELATIVE);
    expect(serverRelative(RELATIVE)).toBe(RELATIVE);
    expect(sameFile(PREFIXED, 'grammars/dev/g/liger/g.liger.yaml')).toBeTrue();
    expect(sameFile(RELATIVE, './grammars/dev/other.liger.yaml')).toBeFalse();
  });

  it('opens the grammar\'s config over the startup default, as from the grammar', () => {
    workspace.ensureOpen(RULE_SET.source);
    expect(workspace.state.origin).toBe('default');

    loader.openGrammarConfig('./grammars/dev/g/g.lfg');

    expect(workspace.open).toHaveBeenCalledWith(RELATIVE, undefined, 'grammar');
  });

  it('keeps a config picked by hand, and says so', () => {
    workspace.open(RULE_SET.source);  // LiGER config selection / Open…
    (workspace.open as jasmine.Spy).calls.reset();

    loader.openGrammarConfig('./grammars/dev/g/g.lfg');

    expect(workspace.open).not.toHaveBeenCalled();
    expect(loader.configNote).toContain('selected by hand');
    expect(loader.currentStatusMessage).toContain('selected by hand');
  });

  it('never replaces a session\'s rule set while it is being restored', () => {
    const tree = new Subject<any>();
    files.listConfig.and.returnValue(tree);
    workspace.open(RULE_SET.source, { '/res/rules/p.liger': 'P SAVED' }, 'grammar');
    (workspace.open as jasmine.Spy).calls.reset();

    loader.openGrammarConfig('./grammars/dev/g/g.lfg');

    expect(workspace.open).not.toHaveBeenCalled();
  });

  it('marks the grammar\'s config as from the grammar when it is already open, keeping edits', () => {
    files.listConfigsForGrammar.and.returnValue(of([RULE_SET.source]));
    workspace.ensureOpen(RULE_SET.source);
    workspace.edit('/res/rules/a.liger', 'A EDITED');
    (workspace.open as jasmine.Spy).calls.reset();

    loader.openGrammarConfig('./grammars/dev/g/g.lfg');

    expect(workspace.open).not.toHaveBeenCalled();
    expect(workspace.state.origin).toBe('grammar');
    expect(workspace.hasEdits).toBeTrue();
  });

  it('opens nothing when the grammar has no config, or several, and says so', () => {
    files.listConfigsForGrammar.and.returnValue(of([]));
    loader.openGrammarConfig('./grammars/dev/g/g.lfg');
    expect(loader.configNote).toBe('no LiGER config beside it');

    files.listConfigsForGrammar.and.returnValue(of([PREFIXED, '/x/./grammars/dev/g/other.liger.yaml']));
    loader.openGrammarConfig('./grammars/dev/g/g.lfg');
    expect(loader.configNote).toContain('2 LiGER configs');

    expect(workspace.open).not.toHaveBeenCalled();
  });

  it('drops a late answer for a grammar that is no longer the loaded one', () => {
    const late = new Subject<string[]>();
    files.listConfigsForGrammar.and.returnValues(late, of([]));

    loader.openGrammarConfig('./grammars/a.lfg');
    loader.openGrammarConfig('./grammars/b.lfg');
    late.next([PREFIXED]);

    expect(workspace.open).not.toHaveBeenCalled();
  });
});
