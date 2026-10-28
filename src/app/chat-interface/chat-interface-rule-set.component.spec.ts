import { ChatInterfaceComponent } from './chat-interface.component';
import { APP_DEFAULTS } from '../app-defaults';
import { SyntaxSourceService } from '../syntax-source/syntax-source.service';

/**
 * Where the chat view gets its rule set: the shared LiGER workspace. The component is built
 * by hand rather than through TestBed: none of this needs a template, and the component's
 * ngAfterViewInit wants view children a TestBed fixture would have to stub out.
 */
describe('ChatInterfaceComponent, its rule set', () => {
  function build() {
    const documentBuilder = { newDocument: () => ({ id: 'doc', semanticType: 'lfgxdrt', sentences: [], sequences: [], elements: [] }) };
    const workspace = jasmine.createSpyObj('LigerWorkspaceService', ['ensureOpen']);
    const host = new ChatInterfaceComponent({ detectChanges: () => {} } as any, {} as any, documentBuilder as any, workspace,
      new SyntaxSourceService());
    return { host, workspace };
  }

  it('opens the startup config unless the workspace has one open already', () => {
    const { host, workspace } = build();

    host.ngOnInit();

    // ensureOpen is a no-op while a rule set is open or opening, so a config opened on the
    // analysis page, with its edits, is what chat runs on.
    expect(workspace.ensureOpen).toHaveBeenCalledWith(APP_DEFAULTS.grammar.ligerRulesPath);
  });

});
