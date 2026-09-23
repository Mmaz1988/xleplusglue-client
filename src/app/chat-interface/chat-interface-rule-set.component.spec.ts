import { ChatInterfaceComponent } from './chat-interface.component';
import { LigerRuleSet } from '../models/models';

/**
 * What the chat view does with a rule set loaded by the rule picker. The component is built
 * by hand rather than through TestBed: none of this needs a template, and the component's
 * ngAfterViewInit wants view children a TestBed fixture would have to stub out.
 */
describe('ChatInterfaceComponent, a loaded rule set', () => {
  const ruleSet = (axioms: string | null): LigerRuleSet => ({
    kind: 'config', source: 'c.liger.yaml', semantics: 'sem', pragmatics: 'prag',
    lexica: [], axioms,
  });

  function build() {
    const documentBuilder = { newDocument: () => ({ id: 'doc', semanticType: 'lfgxdrt', sentences: [], sequences: [], elements: [] }) };
    const host = new ChatInterfaceComponent({ detectChanges: () => {} } as any, {} as any, documentBuilder as any);
    host.editor = jasmine.createSpyObj('EditorComponent', ['updateContent']);
    return host;
  }

  it('takes the semantics and post-processing rules from the rule set', () => {
    const host = build();

    host.updateData(ruleSet(null));

    expect(host.ruleFile).toBe('sem');
    expect(host.pragmaticsRules).toBe('prag');
  });

  it('fills the axioms editor from a config that lists axiom files', () => {
    const host = build();

    host.updateData(ruleSet('fof(a, axiom, p).'));

    expect(host.axioms).toBe('fof(a, axiom, p).');
    expect(host.editor.updateContent).toHaveBeenCalledWith('fof(a, axiom, p).');
  });

  it('leaves the axioms editor alone when the config lists none', () => {
    const host = build();
    host.axioms = 'hand-written axioms';

    host.updateData(ruleSet(null));

    expect(host.axioms).toBe('hand-written axioms');
    expect(host.editor.updateContent).not.toHaveBeenCalled();
  });
});
