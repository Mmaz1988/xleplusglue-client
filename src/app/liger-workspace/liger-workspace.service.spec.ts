import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { LigerFileSource } from './liger-file-source.service';
import { LigerWorkspaceService } from './liger-workspace.service';
import { FILES, RULE_SET, fileSourceSpy } from './liger-workspace.testing';

describe('LigerWorkspaceService', () => {
  let files: jasmine.SpyObj<LigerFileSource>;
  let workspace: LigerWorkspaceService;

  beforeEach(() => {
    files = fileSourceSpy();
    TestBed.configureTestingModule({ providers: [{ provide: LigerFileSource, useValue: files }] });
    workspace = TestBed.inject(LigerWorkspaceService);
    workspace.open(RULE_SET.source);
  });

  it('reads every rule and axiom file up front, in order, but not the lexica', () => {
    expect(files.read.calls.allArgs().map(args => args[0]))
      .toEqual(['/res/rules/a.liger', '/res/rules/b.liger', '/res/rules/p.liger', '/res/axioms/x.p']);
    expect(workspace.state.documents['/res/dicts/d.txt'].loadedText).toBeNull();
    expect(workspace.state.documents['/res/dicts/d.txt'].readOnly).toBeTrue();
  });

  it('sends LiGER\'s own text while nothing is edited', () => {
    expect(workspace.semantics).toBe('SERVER SEMANTICS');
    expect(workspace.pragmatics).toBe('SERVER PRAGMATICS');
    expect(workspace.axioms).toBe('SERVER AXIOMS');
    expect(workspace.hasEdits).toBeFalse();
  });

  it('assembles only an edited section, from all its files, the way LiGER does', () => {
    workspace.edit('/res/rules/a.liger', 'A EDITED');

    expect(workspace.semantics).toBe(
      '// ===== /res/rules/a.liger =====\nA EDITED\n\n' +
      '// ===== /res/rules/b.liger =====\n--lexicon(/res/rules/../dicts/e.txt)\nB RULES\n\n');
    expect(workspace.pragmatics).toBe('SERVER PRAGMATICS');
    expect(workspace.hasEdits).toBeTrue();
  });

  it('assembles edited axioms with TPTP markers', () => {
    workspace.edit('/res/axioms/x.p', 'fof(y, axiom, q).\n');

    expect(workspace.axioms).toBe('% ===== /res/axioms/x.p =====\nfof(y, axiom, q).\n\n');
  });

  it('goes back to LiGER\'s text on revert', () => {
    workspace.edit('/res/rules/a.liger', 'A EDITED');
    workspace.revert('/res/rules/a.liger');

    expect(workspace.semantics).toBe('SERVER SEMANTICS');
    expect(workspace.hasEdits).toBeFalse();
  });

  it('emits semantics$ when an edit changes it, and only then', () => {
    const seen: (string | null)[] = [];
    const subscription = workspace.semantics$.subscribe(text => seen.push(text));

    workspace.edit('/res/rules/p.liger', 'P EDITED');
    workspace.edit('/res/rules/a.liger', 'A EDITED');
    subscription.unsubscribe();

    expect(seen.length).toBe(2);
    expect(seen[0]).toBe('SERVER SEMANTICS');
    expect(seen[1]).toContain('A EDITED');
  });

  it('refuses edits to a lexicon and reads it when it is first selected', () => {
    workspace.load('/res/dicts/d.txt');
    expect(workspace.state.documents['/res/dicts/d.txt'].loadedText).toBe(FILES['/res/dicts/d.txt']);

    workspace.edit('/res/dicts/d.txt', 'changed');
    expect(workspace.state.documents['/res/dicts/d.txt'].currentText).toBe(FILES['/res/dicts/d.txt']);
    expect(workspace.hasEdits).toBeFalse();
  });

  it('sends a single rule file\'s text alone, without a marker', () => {
    files.loadRuleSet.and.returnValue(of({ ...RULE_SET, kind: 'rules', source: 'r.liger' }));
    files.listConfig.and.returnValue(of({
      kind: 'rules', source: 'r.liger', scope: '/res/rules', projectRoot: '/res',
      sections: [{ field: 'semantics', present: true,
        files: [{ path: '/res/rules/b.liger', name: 'b.liger', inScope: true, count: 2 }] }],
    }));
    workspace.open('r.liger');

    workspace.edit('/res/rules/b.liger', '--lexicon(x.txt)\nEDITED\n');

    expect(workspace.semantics).toBe('--lexicon(/res/rules/x.txt)\nEDITED\n');
  });

  it('keeps what was open when opening fails, and says why in LiGER\'s words', () => {
    workspace.edit('/res/rules/a.liger', 'A EDITED');
    files.loadRuleSet.and.returnValue(throwError(() => ({ error: { error: "Unknown field 'semantic'" } })));

    workspace.open('./broken.liger.yaml');

    expect(workspace.state.error).toContain("Unknown field 'semantic'");
    expect(workspace.state.loading).toBeNull();
    expect(workspace.state.ruleSet).toBe(RULE_SET);
    expect(workspace.semantics).toContain('A EDITED');
  });

  describe('restoring saved text', () => {
    it('snapshots every rule and axiom file, edits included, but no lexicon', () => {
      workspace.edit('/res/rules/p.liger', 'P EDITED');

      expect(workspace.fileTexts()).toEqual({
        '/res/rules/a.liger': 'A RULES\n',
        '/res/rules/b.liger': '--lexicon(../dicts/e.txt)\nB RULES\n',
        '/res/rules/p.liger': 'P EDITED',
        '/res/axioms/x.p': 'fof(x, axiom, p).\n',
      });
    });

    it('opens saved text that differs from disk as an edit, the rest as read', () => {
      const saved = { ...FILES, '/res/rules/p.liger': 'P SAVED' };
      delete saved['/res/dicts/d.txt'];

      workspace.open(RULE_SET.source, saved);

      expect(workspace.state.documents['/res/rules/p.liger'].currentText).toBe('P SAVED');
      expect(workspace.state.documents['/res/rules/p.liger'].loadedText).toBe('P RULES\n');
      expect(workspace.hasEdits).toBeTrue();
      expect(workspace.pragmatics).toContain('P SAVED');
      // Unchanged files are not edits, so their sections are LiGER's own text.
      expect(workspace.semantics).toBe('SERVER SEMANTICS');
      expect(workspace.state.error).toBeNull();
      expect(workspace.fileTexts()).toEqual(saved);
    });

    it('never shows the disk text of a restored file in between', () => {
      const settled: (string | null)[] = [];
      let watching = false;
      const sub = workspace.state$.subscribe(state => {
        // A caller that syncs on settled states (nothing loading) is what could autosave it.
        if (watching && state.loading === null) {
          settled.push(state.documents['/res/rules/p.liger']?.currentText ?? null);
        }
      });

      watching = true;
      workspace.open(RULE_SET.source, { '/res/rules/p.liger': 'P SAVED' });
      sub.unsubscribe();

      expect(settled).toEqual(['P SAVED']);
    });

    it('says which saved files it could not apply', () => {
      workspace.open(RULE_SET.source, { '/res/rules/gone.liger': 'GONE', '/res/dicts/d.txt': 'x' });

      expect(workspace.state.error).toContain('/res/rules/gone.liger');
      expect(workspace.state.error).toContain('/res/dicts/d.txt');
      expect(workspace.hasEdits).toBeFalse();
    });
  });

  describe('leaving files out of runs', () => {
    it('assembles the section from the included files only', () => {
      workspace.setIncluded('/res/rules/a.liger', false);

      expect(workspace.semantics).toBe(
        '// ===== /res/rules/b.liger =====\n--lexicon(/res/rules/../dicts/e.txt)\nB RULES\n\n');
      expect(workspace.pragmatics).toBe('SERVER PRAGMATICS');
      expect(workspace.hasEdits).toBeFalse();
    });

    it('sends LiGER\'s own text again once the file is back in', () => {
      workspace.setIncluded('/res/rules/a.liger', false);
      workspace.setIncluded('/res/rules/a.liger', true);

      expect(workspace.semantics).toBe('SERVER SEMANTICS');
    });

    it('sends an empty section, not null, with every file left out', () => {
      workspace.setAllIncluded(['/res/rules/p.liger', '/res/axioms/x.p'], false);

      expect(workspace.pragmatics).toBe('');
      expect(workspace.axioms).toBe('');
    });

    it('leaves an edited file out too, and keeps its edit', () => {
      workspace.edit('/res/rules/b.liger', 'B EDITED');
      workspace.setIncluded('/res/rules/b.liger', false);

      expect(workspace.semantics).toBe('// ===== /res/rules/a.liger =====\nA RULES\n\n');
      expect(workspace.state.documents['/res/rules/b.liger'].currentText).toBe('B EDITED');
    });

    it('ignores paths the rule set does not list', () => {
      workspace.setIncluded('/res/rules/gone.liger', false);

      expect(workspace.state.excluded).toEqual([]);
    });

    it('keeps them left out on reload, but not when another rule set is opened', () => {
      workspace.setIncluded('/res/rules/a.liger', false);
      workspace.reload();
      expect(workspace.isIncluded('/res/rules/a.liger')).toBeFalse();

      workspace.open(RULE_SET.source);
      expect(workspace.isIncluded('/res/rules/a.liger')).toBeTrue();
    });

    it('restores them on open, dropping lexica and files no longer listed', () => {
      workspace.open(RULE_SET.source, undefined, 'selected',
        ['/res/axioms/x.p', '/res/dicts/d.txt', '/res/rules/gone.liger']);

      expect(workspace.state.excluded).toEqual(['/res/axioms/x.p']);
      expect(workspace.axioms).toBe('');
    });
  });

  it('does not reopen what another view already opened', () => {
    workspace.ensureOpen('./other.liger.yaml');

    expect(files.loadRuleSet).toHaveBeenCalledTimes(1);
  });
});
