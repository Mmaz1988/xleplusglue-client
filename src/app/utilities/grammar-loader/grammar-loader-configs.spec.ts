import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { GrammarLoaderComponent } from './grammar-loader.component';
import { sameFile, serverRelative } from '../../liger-workspace/liger-paths';
import { LigerFileSource } from '../../liger-workspace/liger-file-source.service';
import { LigerWorkspaceService } from '../../liger-workspace/liger-workspace.service';
import { FILES, RULE_SET, TREE, fileSourceSpy } from '../../liger-workspace/liger-workspace.testing';
import { SyntaxSourceService } from '../../syntax-source/syntax-source.service';
import { XLE_SOURCE } from '../../models/models';

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
  let syntaxSource: SyntaxSourceService;
  let dataService: { getFileTree: jasmine.Spy; changeGrammar: jasmine.Spy };

  beforeEach(() => {
    files = fileSourceSpy();
    files.listConfigsForGrammar.and.returnValue(of([PREFIXED]));
    TestBed.configureTestingModule({ providers: [{ provide: LigerFileSource, useValue: files }] });
    workspace = TestBed.inject(LigerWorkspaceService);
    spyOn(workspace, 'open').and.callThrough();
    syntaxSource = TestBed.inject(SyntaxSourceService);
    dataService = {
      getFileTree: jasmine.createSpy('getFileTree').and.returnValue(of({ children: [] })),
      changeGrammar: jasmine.createSpy('changeGrammar').and.returnValue(of({ grammar: 'success' })),
    };
    loader = new GrammarLoaderComponent(dataService as any, { detectChanges: () => {} } as any, files, workspace,
      syntaxSource);
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

  it('reads the grammar\'s config from disk again when it is already open, keeping edits', () => {
    files.listConfigsForGrammar.and.returnValue(of([RULE_SET.source]));
    workspace.ensureOpen(RULE_SET.source);
    workspace.edit('/res/rules/a.liger', 'A EDITED');
    workspace.setIncluded('/res/axioms/x.p', false);
    (workspace.open as jasmine.Spy).calls.reset();

    loader.openGrammarConfig('./grammars/dev/g/g.lfg');

    expect(workspace.open).toHaveBeenCalledWith(RULE_SET.source, { '/res/rules/a.liger': 'A EDITED' },
      'grammar', ['/res/axioms/x.p']);
    expect(workspace.state.origin).toBe('grammar');
    expect(workspace.hasEdits).toBeTrue();
    expect(workspace.isIncluded('/res/axioms/x.p')).toBeFalse();
  });

  it('shows a file added to the config when the grammar is loaded again', () => {
    files.listConfigsForGrammar.and.returnValue(of([RULE_SET.source]));
    workspace.ensureOpen(RULE_SET.source);
    const withNewFile = JSON.parse(JSON.stringify(TREE));
    withNewFile.sections[1].files.push({ path: '/res/rules/q.liger', name: 'q.liger', inScope: true, count: 1 });
    files.listConfig.and.returnValue(of(withNewFile));
    files.read.and.callFake((path: string) => of(path === '/res/rules/q.liger' ? 'Q RULES\n' : FILES[path]));

    loader.openGrammarConfig('./grammars/dev/g/g.lfg');

    expect(workspace.state.documents['/res/rules/q.liger']?.loadedText).toBe('Q RULES\n');
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

  describe('in a UD session', () => {
    const UD_CONFIG = '/Users/me/liger/./grammars/ud/en/liger/ud-lfgxdrt.liger.yaml';
    let loaded: string[];

    beforeEach(() => {
      files.listConfigsForGrammar.and.callFake((path: string) =>
        of(path === './grammars/ud/en' ? [UD_CONFIG] : [PREFIXED]));
      syntaxSource.setUdModels([{ id: 'en', language: 'English', package: 'combined' }]);
      loaded = [];
      loader.grammarLoaded.subscribe(path => loaded.push(path));
      loader.ngOnInit();
    });

    afterEach(() => loader.ngOnDestroy());

    it('switching to UD opens the model\'s config and reports its folder as the grammar', () => {
      syntaxSource.select({ kind: 'ud', model: 'en' });

      expect(loaded).toEqual(['./grammars/ud/en']);
      expect(workspace.open).toHaveBeenCalledWith('./grammars/ud/en/liger/ud-lfgxdrt.liger.yaml', undefined, 'grammar');
      expect(loader.currentStatusMessage).toContain('Stanza model en');
      expect(dataService.changeGrammar).not.toHaveBeenCalled();
    });

    it('picking a model from the list makes the session UD', () => {
      loader.selectUdModel('en');

      expect(syntaxSource.source).toEqual({ kind: 'ud', model: 'en' });
      expect(loader.isLoadedUdModel('en')).toBeTrue();
      expect(loaded).toEqual(['./grammars/ud/en']);
    });

    it('switching back to XLE loads the XLE grammar it had before', () => {
      syntaxSource.select({ kind: 'ud', model: 'en' });
      syntaxSource.select(XLE_SOURCE);

      expect(dataService.changeGrammar).toHaveBeenCalledWith({ grammar: './grammars/dev/g/g.lfg' });
      expect(loaded).toEqual(['./grammars/ud/en', './grammars/dev/g/g.lfg']);
    });

    it('a restored UD session changes nothing on the grammar side', () => {
      syntaxSource.restore({ kind: 'ud', model: 'en' });

      expect(loaded).toEqual([]);
      expect(workspace.open).not.toHaveBeenCalled();
    });
  });
});
