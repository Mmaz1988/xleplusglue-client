import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { of, throwError } from 'rxjs';

import { LigerConfigLoaderComponent } from './liger-config-loader.component';
import { LigerFileSource } from './liger-file-source.service';
import { LigerWorkspaceService } from './liger-workspace.service';
import { RULE_SET, fileSourceSpy } from './liger-workspace.testing';

describe('LigerConfigLoaderComponent', () => {
  let fixture: ComponentFixture<LigerConfigLoaderComponent>;
  let loader: LigerConfigLoaderComponent;
  let files: jasmine.SpyObj<LigerFileSource>;
  let workspace: LigerWorkspaceService;

  const file = (path: string) => ({ name: path.substring(path.lastIndexOf('/') + 1), path, isDirectory: false, children: [] });
  const dir = (path: string, children: any[]) => ({ name: path.substring(path.lastIndexOf('/') + 1), path, isDirectory: true, children });

  beforeEach(() => {
    files = fileSourceSpy();
    files.browse.and.callFake((directory: string) => of(directory === './grammars'
      ? [dir('./grammars/dev', [
          dir('./grammars/dev/g', [file('./grammars/dev/g/g.lfg'), dir('./grammars/dev/g/liger', [
            file('./grammars/dev/g/liger/g.liger.yaml'), file('./grammars/dev/g/liger/semantics.liger')])]),
          dir('./grammars/dev/plain', [file('./grammars/dev/plain/p.lfg')]),
        ])]
      : [file('./liger_resources/rules/degree_rules.txt')]));
    TestBed.configureTestingModule({
      declarations: [LigerConfigLoaderComponent],
      providers: [{ provide: LigerFileSource, useValue: files }],
      schemas: [NO_ERRORS_SCHEMA],
    });
    workspace = TestBed.inject(LigerWorkspaceService);
    spyOn(workspace, 'open').and.callThrough();
    fixture = TestBed.createComponent(LigerConfigLoaderComponent);
    loader = fixture.componentInstance;
    fixture.detectChanges();
  });

  const paths = (nodes: any[]): string[] => nodes.flatMap(node => [node.path, ...paths(node.children ?? [])]);

  it('lists the configs under grammars/ and the rule files in liger_resources/rules, nothing else', () => {
    const listed = paths(loader.fileTree);

    expect(listed).toContain('./grammars/dev/g/liger/g.liger.yaml');
    expect(listed).toContain('./liger_resources/rules/degree_rules.txt');
    expect(listed).not.toContain('./grammars/dev/g/g.lfg');
    expect(listed).not.toContain('./grammars/dev/g/liger/semantics.liger');
    // A folder without a config is not offered.
    expect(listed).not.toContain('./grammars/dev/plain');
  });

  it('opens the picked config in the shared rule set, whatever grammar is loaded', () => {
    loader.onFileSelected('./grammars/dev/g/liger/g.liger.yaml');
    loader.load();

    expect(workspace.open).toHaveBeenCalledWith('./grammars/dev/g/liger/g.liger.yaml');
  });

  it('does not try to open a folder', () => {
    loader.onFileSelected('./grammars/dev/g/liger');

    expect(loader.canLoad).toBeFalse();
    loader.load();
    expect(workspace.open).not.toHaveBeenCalled();
  });

  it('says what is loaded, and when loading failed', () => {
    expect(loader.statusMessage).toBe('No LiGER config loaded.');

    workspace.open(RULE_SET.source);
    expect(loader.statusMessage).toBe(`Currently loaded LiGER config: ${RULE_SET.source}`);

    files.loadRuleSet.and.returnValue(throwError(() => ({ error: { error: 'No such file' } })));
    workspace.open('./grammars/gone.liger.yaml');
    expect(loader.statusMessage).toBe('Failed to load LiGER config: ./grammars/gone.liger.yaml');
  });
});
