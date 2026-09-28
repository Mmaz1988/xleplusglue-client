import { of, Subject } from 'rxjs';
import { GrammarLoaderComponent, sameFile, serverRelative } from './grammar-loader.component';

/**
 * The grammar loader offers the loaded grammar's LiGER configs; it never opens one itself.
 * Built by hand: GrammarLoaderComponent's TestBed spec needs HttpClient it is not given.
 */
describe('GrammarLoaderComponent, the grammar\'s LiGER configs', () => {
  const PREFIXED = '/Users/me/liger/./grammars/dev/g/liger/g.liger.yaml';
  const RELATIVE = './grammars/dev/g/liger/g.liger.yaml';

  function build(configs: string[] = [PREFIXED]) {
    const files = jasmine.createSpyObj('LigerFileSource', ['listConfigsForGrammar']);
    files.listConfigsForGrammar.and.returnValue(of(configs));
    const workspace: any = jasmine.createSpyObj('LigerWorkspaceService', ['open']);
    workspace.state = { ruleSet: null, openFailed: null };
    workspace.hasEdits = false;
    const loader = new GrammarLoaderComponent({} as any, { detectChanges: () => {} } as any, files, workspace);
    return { loader, files, workspace };
  }

  it('reads LiGER\'s prefixed paths back as the relative ones sessions store', () => {
    expect(serverRelative(PREFIXED)).toBe(RELATIVE);
    expect(serverRelative(RELATIVE)).toBe(RELATIVE);
    expect(sameFile(PREFIXED, 'grammars/dev/g/liger/g.liger.yaml')).toBeTrue();
    expect(sameFile(RELATIVE, './grammars/dev/other.liger.yaml')).toBeFalse();
  });

  it('lists the configs beside the grammar, without opening any', () => {
    const { loader, files, workspace } = build();

    loader.listGrammarConfigs('./grammars/dev/g/g.lfg');

    expect(files.listConfigsForGrammar).toHaveBeenCalledWith('./grammars/dev/g/g.lfg');
    expect(loader.grammarConfigs).toEqual([RELATIVE]);
    expect(workspace.open).not.toHaveBeenCalled();
  });

  it('drops a late answer for a grammar that is no longer the loaded one', () => {
    const { loader, files } = build();
    const late = new Subject<string[]>();
    files.listConfigsForGrammar.and.returnValues(late, of([]));

    loader.listGrammarConfigs('./grammars/a.lfg');
    loader.listGrammarConfigs('./grammars/b.lfg');
    late.next([PREFIXED]);

    expect(loader.grammarConfigs).toEqual([]);
  });

  it('opens a config in the shared rule set on request, and marks the open one', () => {
    const { loader, workspace } = build();

    loader.loadConfig(RELATIVE);
    expect(workspace.open).toHaveBeenCalledWith(RELATIVE);

    workspace.state = { ruleSet: { source: RELATIVE }, openFailed: null };
    expect(loader.isOpenConfig(RELATIVE)).toBeTrue();
    // A failed reopen of it leaves the old one showing: not "loaded".
    workspace.state = { ruleSet: { source: RELATIVE }, openFailed: RELATIVE };
    expect(loader.isOpenConfig(RELATIVE)).toBeFalse();
  });

  it('asks before replacing a rule set with edits', () => {
    const { loader, workspace } = build();
    workspace.hasEdits = true;
    spyOn(window, 'confirm').and.returnValue(false);

    loader.loadConfig(RELATIVE);

    expect(window.confirm).toHaveBeenCalled();
    expect(workspace.open).not.toHaveBeenCalled();
  });
});
