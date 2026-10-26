import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { of, Subject, throwError } from 'rxjs';

import { ChatComponent } from './chat.component';
import { DataService } from '../../data.service';
import { POST_PROCESSING_SKIPPED_NOTICE } from '../../models/models';
import { ReasoningPipelineService } from '../../reasoning/reasoning-pipeline.service';

describe('ChatComponent', () => {
  let component: ChatComponent;
  let fixture: ComponentFixture<ChatComponent>;
  let dataServiceSpy: jasmine.SpyObj<{
    ligerAnnotate: any; ligerSequence: any; gswbDeduce: any; gswbMergeSequenceSemantics: any;
    callVampire: any; lmRankAnaphora: any;
  }>;
  let reasoningPipelineSpy: jasmine.SpyObj<{
    prepareReasoningChecks: any; prepareReasoningChecksSequentially: any;
    generateDiscourseMappings: any;
  }>;

  beforeEach(() => {
    dataServiceSpy = jasmine.createSpyObj('DataService', [
      'ligerAnnotate',
      'ligerSequence',
      'gswbDeduce',
      'gswbMergeSequenceSemantics',
      'callVampire',
      'lmRankAnaphora'
    ]);
    reasoningPipelineSpy = jasmine.createSpyObj('ReasoningPipelineService', [
      'prepareReasoningChecks',
      'prepareReasoningChecksSequentially',
      'generateDiscourseMappings'
    ]);

    TestBed.configureTestingModule({
      declarations: [ChatComponent],
      // The template binds ngModel; without FormsModule even `should create` fails.
      imports: [FormsModule],
      providers: [
        { provide: DataService, useValue: dataServiceSpy },
        { provide: ReasoningPipelineService, useValue: reasoningPipelineSpy }
      ],
      schemas: [CUSTOM_ELEMENTS_SCHEMA]
    });
    fixture = TestBed.createComponent(ChatComponent);
    component = fixture.componentInstance;
    component.pragmaticsRuleString = 'pragmatics rules';
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('axioms', () => {
    const grammar = (prolog: string[], tptp: string[] = [], tffTypes: string[] = []) =>
      ({ prolog, tptp, tffTypes });

    it('keeps the rules\' axioms untranslated, apart from the rule set\'s', () => {
      component.axioms = 'tff(a, type, a: $o).';
      (component as any).addDerivedAxioms(grammar(['all(X,p(X))'], ['![X]: q(X)']));

      expect(component.derivedGrammarAxioms).toEqual(grammar(['all(X,p(X))'], ['![X]: q(X)']));
      // The rule set's axioms are the workspace's: the conversation never writes into them.
      expect(component.axioms).toBe('tff(a, type, a: $o).');
    });

    it('adds each axiom once across turns', () => {
      (component as any).addDerivedAxioms(grammar(['all(X,p(X))']));
      (component as any).addDerivedAxioms(grammar(['all(X,p(X))', 'all(X,r(X))']));
      (component as any).addDerivedAxioms(undefined);

      expect(component.derivedGrammarAxioms).toEqual(grammar(['all(X,p(X))', 'all(X,r(X))']));
    });

    it('declares each tff type once across turns, and shows it as a type', () => {
      const emitted: string[] = [];
      component.derivedAxiomsChange.subscribe(value => emitted.push(value));
      (component as any).addDerivedAxioms(grammar([], [], ['big: ($i * $int) > $o']));
      (component as any).addDerivedAxioms(grammar([], [], ['big: ($i * $int) > $o', 'th_big: $i > $int']));
      // A parse stored before types existed has no tffTypes at all.
      (component as any).addDerivedAxioms({ prolog: [], tptp: [] });

      expect(component.derivedGrammarAxioms)
        .toEqual(grammar([], [], ['big: ($i * $int) > $o', 'th_big: $i > $int']));
      expect(component.derivedAxiomCount).toBe(2);
      expect(emitted.length).toBe(2);
      expect(emitted[1]).toContain('th_big: $i > $int   (tff type; dropped in fof)');
    });

    it('drops the conversation\'s axioms on a new conversation, and says so', () => {
      const emitted: string[] = [];
      component.derivedAxiomsChange.subscribe(value => emitted.push(value));
      (component as any).addDerivedAxioms(grammar([], ['![X]: q(X)']));

      component.resetConversationState();

      expect(component.derivedGrammarAxioms).toEqual(grammar([]));
      expect(component.derivedAxioms).toBe('');
      expect(emitted).toEqual(['![X]: q(X)', '']);
    });
  });

  it('derives an LFGxDRT sentence once on its own, through the shared deriveSentence', () => {
    component.vampirePreferences = { vampirePreferences: { logic_type: 0 } } as any;
    component.gswbPreferences = { gswbPreferences: { outputstyle: 5 } } as any;
    component.ruleString = 'rules';
    component.pragmaticsRuleString = 'rules ==> x.';
    component.userInput = 'Kim arrived';
    const structure = { constraints: [], annotations: [], choiceSpace: {} };
    dataServiceSpy.ligerAnnotate.and.returnValue(of({ solutions: [
      { solutionKey: 'S0', structureJson: structure, graph: { graphElements: [{}] }, meaningConstructors: 'mc' },
    ] }));
    const derive = spyOn((component as any).documentBuilder, 'deriveSentence').and.returnValue(new Subject());

    component.sendMessage();

    expect(derive).toHaveBeenCalledTimes(1);
    const [sentence, parses] = derive.calls.mostRecent().args as any[];
    expect(sentence.text).toBe('Kim arrived');
    expect(parses.map((parse: any) => parse.solutionKey)).toEqual(['S0']);
    expect(dataServiceSpy.gswbDeduce).not.toHaveBeenCalled();
    expect(dataServiceSpy.ligerSequence).not.toHaveBeenCalled();
  });

  it('runs a turn without post-processing rules and says so in the side panel, not the chat', () => {
    component.vampirePreferences = { vampirePreferences: { logic_type: 0 } } as any;
    component.ruleString = 'rules';
    component.pragmaticsRuleString = null;
    component.userInput = 'Kim arrived';
    dataServiceSpy.ligerAnnotate.and.returnValue(new Subject());

    component.sendMessage();
    fixture.detectChanges();

    expect(dataServiceSpy.ligerAnnotate).toHaveBeenCalled();
    expect(component.chatHistory.map(message => message.text))
      .not.toContain(POST_PROCESSING_SKIPPED_NOTICE);
    expect(component.lastTurn?.pragmatics).toBeFalse();
    const panel: HTMLElement = fixture.nativeElement.querySelector('.turn-panel');
    expect(panel.textContent).toContain(POST_PROCESSING_SKIPPED_NOTICE);
    expect(panel.textContent).toContain('Kim arrived');
    expect(panel.textContent).toContain('running');
  });

  it('closes the side panel\'s turn when the reply is in', () => {
    component.vampirePreferences = { vampirePreferences: { logic_type: 1 } } as any;
    component.userInput = 'Kim arrived';
    dataServiceSpy.ligerAnnotate.and.returnValue(new Subject());

    component.sendMessage();
    expect(component.lastTurn?.durationMs).toBeNull();
    component.loading = false;

    expect(component.lastTurn?.durationMs).toEqual(jasmine.any(Number));
    expect(component.nextTurnSettings[0]).toEqual(['Logic', 'tff']);
  });

  it('keeps the pruning checkbox readable while the side panel is hidden', () => {
    component.sidePanelOpen = false;
    fixture.detectChanges();
    expect(component.contextPruning.nativeElement.checked).toBeFalse();
  });

  /** One reasoning assignment: a rule branch x PCDRS mapping of `merged`. Every assignment
   *  of one pair carries the identical `merged` -- chat builds them as `{ ...item, checks }`
   *  -- which is exactly why they must not each become a prior. */
  const assignment = (
    semId: string,
    ruleBranch: number,
    mappingIndex: number,
    overrides: { syntacticOrigin?: string; sequenceTptp?: string; solution?: string } = {}
  ) => ({
    contextIndex: 0,
    priorElementId: 'sentence-1',
    newSentenceId: 'sentence-2',
    merged: {
      id: semId,
      semanticAnalysis: {
        semId,
        syntacticOrigin: overrides.syntacticOrigin ?? 'syn-1',
        semString: `drs([x${ruleBranch}],[])`,
        graph: { nodes: [] },
        semType: 'lfgxdrt',
      },
    },
    syntax: { id: overrides.syntacticOrigin ?? 'syn-1' },
    checks: {
      assignmentId: `${semId}/r${ruleBranch}/pcdrs-${mappingIndex}`,
      ruleBranchIndex: ruleBranch,
      sequenceTptp: overrides.sequenceTptp !== undefined
        ? overrides.sequenceTptp
        : `fof(seq_${ruleBranch}_${mappingIndex}, axiom, $true).`,
      mappingId: `${semId}-rule-${ruleBranch}-pcdrs-${mappingIndex}`,
      mapping: {
        id: `${semId}-rule-${ruleBranch}-pcdrs-${mappingIndex}`,
        solution: overrides.solution !== undefined ? overrides.solution : '<svg></svg>',
        semantic: `drs([x${ruleBranch}],[collapsed(${mappingIndex})])`,
        anaphoraRelations: [{ pronoun: 'x5', antecedent: 'x2' }],
      },
    },
  });

  const accepted = { consistent: true, informative: true, relevant: true };

  /** Two readings of the accumulated discourse, each with 12 rule branches -- the shape
   *  turn 2 of `a man saw a man` / `he saw him` actually produced. */
  const twoReadingsTwelveBranches = () => {
    const items: any[] = [];
    ['sem-1+sem-3', 'sem-2+sem-3'].forEach(semId => {
      for (let rule = 1; rule <= 12; rule++) {
        items.push(assignment(semId, rule, 1));
      }
    });
    return items;
  };

  /** The two sentences the merged sequence is built from. Registered so the document stays
   *  valid through the upserts -- validateAnalysisDocument rejects a sequence whose
   *  sentenceIds are unknown, and it runs on every emit. */
  beforeEach(() => {
    const sentence = (id: string, text: string) => ({
      id,
      text,
      syntax: [{ synId: `${id}-syn`, structure: {}, graph: {} }],
      semantics: [{
        syntacticOrigin: `${id}-syn`,
        semId: `${id}-sem`,
        semString: 'drs([],[])',
        semType: 'lfgxdrt',
      }],
      synSemMapping: { [`${id}-syn`]: [`${id}-sem`] },
    });
    component.chatDocument.sentences = [
      sentence('sentence-1', 'a man saw a man'),
      sentence('sentence-2', 'he saw him'),
    ] as any;
  });

  describe('contextFromLfgxdrtChecks', () => {
    it('carries one context per distinct reading, not one per reasoning assignment', () => {
      const prepared = twoReadingsTwelveBranches();
      const checks = prepared.map(() => accepted);

      const result = (component as any).contextFromLfgxdrtChecks(
        prepared, checks, 'he saw him', false);

      // 24 accepted assignments, 2 readings. The next turn multiplies its own branch
      // count by this list, so 24 here is what turned 72 bundles into 864.
      expect(result.length).toBe(2);
      expect(result.map((entry: any) => entry.semanticAnalysis.semId))
        .toEqual(['sem-1+sem-3', 'sem-2+sem-3']);
      expect(new Set(result.map((entry: any) => entry.elementId)).size).toBe(1);
    });

    it('keeps two readings that share semantics but differ syntactically', () => {
      const prepared = [
        assignment('sem-1+sem-3', 1, 1, { syntacticOrigin: 'syn-1' }),
        assignment('sem-1+sem-3', 2, 1, { syntacticOrigin: 'syn-2' }),
      ];
      const checks = prepared.map(() => accepted);

      const result = (component as any).contextFromLfgxdrtChecks(
        prepared, checks, 'he saw him', false);

      expect(result.length).toBe(2);
    });

    it('keeps every anaphora branch in the turn\'s DiscourseUpdate', () => {
      const prepared = twoReadingsTwelveBranches();
      const checks = prepared.map(() => accepted);

      (component as any).contextFromLfgxdrtChecks(prepared, checks, 'he saw him', false);

      const updates = component.chatDocument.discourseUpdates ?? [];
      expect(updates.length).toBe(1);
      // The fold reduces work, not analysis: all 24 branches stay recorded.
      expect(updates[0].discourse.length).toBe(24);
      expect(Object.keys(updates[0].semDiscourseMapping).sort())
        .toEqual(['sem-1+sem-3', 'sem-2+sem-3']);
      // 24 branches used to mean 24 stored tier-B joins plus their tier-A unions, on the
      // surface with the highest tier-B ratio of the three. The analyses stay; the joins
      // behind them are recomputable from the sequence's own syntax and semantics.
      expect((updates[0] as any).structures).toBeUndefined();
      expect((updates[0] as any).mergedGraphs).toBeUndefined();
      expect(updates[0].discourse.every(entry => entry.ruleBranch >= 1)).toBeTrue();
    });

    it('drops a reading whose assignments were all rejected', () => {
      const prepared = twoReadingsTwelveBranches();
      const checks = prepared.map((item: any) =>
        item.merged.id === 'sem-1+sem-3' ? { consistent: false, informative: true } : accepted);

      const result = (component as any).contextFromLfgxdrtChecks(
        prepared, checks, 'he saw him', false);

      expect(result.length).toBe(1);
      expect(result[0].semanticAnalysis.semId).toBe('sem-2+sem-3');
    });

    it('keeps a reading when only one of its branches was accepted', () => {
      const prepared = twoReadingsTwelveBranches();
      const checks = prepared.map((_item: any, index: number) =>
        index === 5 ? accepted : { consistent: false, informative: false });

      const result = (component as any).contextFromLfgxdrtChecks(
        prepared, checks, 'he saw him', false);

      expect(result.length).toBe(1);
      expect(result[0].tptp).toBe('fof(seq_6_1, axiom, $true).');
    });
  });

  describe('finishLfgxdrtPreparation (appending the sentence derived on its own)', () => {
    const structure = { constraints: [], annotations: [], choiceSpace: {} };
    const variantStructure = { id: 'variant-structure' };

    /** LiGER over the supplied sentences: sentence-1's one parse (S0 in the call) and the new
     *  sentence's one parse (S1), the new part offset by sentence-1's constructors. */
    const ligerResponse = () => ({
      solutions: [{
        solutionKey: 'sequence-1-S0+S1',
        structureJson: variantStructure,
        sequenceParts: [
          { sourceIndex: 0, syntaxVariantId: 'S0', sourceIndexOffset: 0 },
          { sourceIndex: 1, syntaxVariantId: 'S1', sourceIndexOffset: 7 },
        ],
        sequenceAnalysis: { id: 'x', text: 'x', sentences: [], syntax: [{ synId: 'x', structure: variantStructure, graph: { graphElements: [] } }] },
      }],
    });

    /** The new sentence as deriveSentence registers it: one parse, `readings` readings. */
    const newSentence = (readings: number) => ({
      id: 'sentence-3', text: 'he saw him',
      syntax: [{ synId: 'S0', structure, graph: { graphElements: [] } }],
      semantics: Array.from({ length: readings }, (_, r) => ({
        syntacticOrigin: 'S0', semId: `sentence-3-S0-s${r}`, semString: `Q${r}`, graph: structure, semType: 'lfgxdrt',
      })),
      synSemMapping: { S0: Array.from({ length: readings }, (_, r) => `sentence-3-S0-s${r}`) },
    });

    const priorReading = (semId: string, semantic: string) => ({
      original: 'a man saw a man', prolog_drs: '', prolog_fol: '', tptp: '', box: '',
      semantic, semanticGraph: structure, syntax: structure,
      semanticAnalysis: { syntacticOrigin: 'sentence-1-syn', semId, semString: semantic, semType: 'lfgxdrt', graph: structure },
      elementId: 'sentence-1',
    });

    beforeEach(() => {
      component.gswbPreferences = { gswbPreferences: { resolveDrs: true } } as any;
      component.vampirePreferences = { vampirePreferences: { logic_type: 0 } } as any;
      component.ruleString = 'rules';
      component.pragmaticsRuleString = 'pragmatics rules';
      component.activeIndices = [];
      dataServiceSpy.ligerSequence.and.returnValue(of(ligerResponse()));
      dataServiceSpy.gswbMergeSequenceSemantics.and.callFake((request: any) => {
        const id = request.parts.map((part: any) => part.id).join('+');
        return of({ id, solutionKey: request.solutionKey, semanticAnalysis: {
          syntacticOrigin: request.solutionKey, semId: id, semString: 'merged', graph: structure, semType: 'lfgxdrt', svg: 'merged',
        } });
      });
      reasoningPipelineSpy.prepareReasoningChecks.and.callFake((request: any) =>
        of({ scopeId: request.scopeId, assignments: [], failures: [], degradations: [] }));
    });

    it('merges the new reading onto every accepted reading, moved by its offset, deriving nothing', () => {
      // Two accepted READINGS of the SAME prior element (an ambiguous premise): two
      // discourse states over one parse, so one LiGER call and one merge each.
      component.context = [priorReading('sem-1a', 'P1'), priorReading('sem-1b', 'P2')] as any;
      const sentence = newSentence(1);
      component.chatDocument.sentences.push(sentence as any);

      (component as any).finishLfgxdrtPreparation('he saw him', false, sentence);

      expect(dataServiceSpy.gswbDeduce).not.toHaveBeenCalled();
      expect(dataServiceSpy.ligerSequence).toHaveBeenCalledTimes(1);
      const request = dataServiceSpy.ligerSequence.calls.mostRecent().args[0];
      expect(request.sentenceIds).toEqual(['sentence-1', 'sentence-3']);
      expect(request.parsedSentences.length).toBe(2);
      const merges = dataServiceSpy.gswbMergeSequenceSemantics.calls.allArgs().map(([merge]: any[]) => merge);
      expect(merges.map((merge: any) => merge.parts.map((part: any) => part.id))).toEqual([
        ['sem-1a', 'sentence-3-S0-s0'], ['sem-1b', 'sentence-3-S0-s0'],
      ]);
      expect(merges.map((merge: any) => merge.parts[1].sourceIndexOffset)).toEqual([7, 7]);

      // The scope id names the PRIOR'S READING, not just its element id: GSWB derives
      // every PCDRS id from it, and two pairs differing only in the prior's reading
      // produced identical pragmatic ids when it did not (chat-document-pronoun-bug3.json).
      const prepared = reasoningPipelineSpy.prepareReasoningChecks.calls.allArgs().map(([r]: any[]) => r);
      expect(new Set(prepared.map((r: any) => r.scopeId)).size).toBe(2);
      expect(prepared.map((r: any) => r.premiseSemantic).sort()).toEqual(['P1', 'P2']);
      prepared.forEach((r: any) => {
        expect(r.prune).toBeFalse();
        expect(r.sequenceStructure).toEqual(variantStructure);
        expect(r.scope.hypothesisSemanticIds).toEqual(['sentence-3-S0-s0']);
      });
    });

    it('gives exactly one pair per reading of the new sentence for one accepted reading', () => {
      component.context = [priorReading('sem-1a', 'P1')] as any;
      const sentence = newSentence(2);
      component.chatDocument.sentences.push(sentence as any);

      (component as any).finishLfgxdrtPreparation('every swede is a scandinavian', false, sentence);

      expect(dataServiceSpy.ligerSequence).toHaveBeenCalledTimes(1);
      expect(dataServiceSpy.gswbDeduce).not.toHaveBeenCalled();
      expect(dataServiceSpy.gswbMergeSequenceSemantics).toHaveBeenCalledTimes(2);
      expect(reasoningPipelineSpy.prepareReasoningChecks).toHaveBeenCalledTimes(2);
    });
  });

  describe('the pills on a reasoning turn', () => {
    /** Vampire's response: one verdict per bundle, echoing the assignment id back. */
    const vampireResponse = (prepared: any[], verdicts: any[]) => ({
      context_checks_mapping: Object.fromEntries(prepared.map((item, index) => [
        index,
        { ...verdicts[index], assignment_id: item.checks.assignmentId, glyph: '<svg/>' },
      ])),
    });

    const lastMessage = () => component.chatHistory[component.chatHistory.length - 1];

    it('shows one TPTP block per branch, rejected branches included', () => {
      const prepared = twoReadingsTwelveBranches();
      const verdicts = prepared.map((_item, index) =>
        index % 2 === 0 ? accepted : { consistent: false, informative: true, relevant: false });

      (component as any).handleVampireResponse(
        vampireResponse(prepared, verdicts), 'he saw him', prepared, false);

      const blocks = (lastMessage().detailText ?? '').split('\n\n').filter(Boolean);
      // The pill's entry count must match the number of checks run -- a pill that silently
      // shows fewer is how a fan-out bug stays invisible.
      expect(blocks.length).toBe(24);
      expect(blocks[0]).toContain('consistent, informative, relevant');
      expect(blocks[1]).toContain('inconsistent, informative, irrelevant');
      expect(blocks[0]).toContain('fof(seq_1_1, axiom, $true).');
    });

    it('reports a branch that produced no TPTP instead of dropping it', () => {
      const prepared = [
        assignment('sem-1+sem-3', 1, 1),
        assignment('sem-1+sem-3', 2, 1, { sequenceTptp: '' }),
      ];
      const verdicts = prepared.map(() => accepted);

      (component as any).handleVampireResponse(
        vampireResponse(prepared, verdicts), 'he saw him', prepared, false);

      const blocks = (lastMessage().detailText ?? '').split('\n\n').filter(Boolean);
      expect(blocks.length).toBe(2);
      expect(blocks[1]).toContain('(no TPTP produced for this branch)');
    });

    it('hands the DRS pill one PCDRS per branch, labelled with id and verdict', () => {
      const prepared = twoReadingsTwelveBranches();
      const verdicts = prepared.map(() => accepted);

      (component as any).handleVampireResponse(
        vampireResponse(prepared, verdicts), 'he saw him', prepared, false);

      const message = lastMessage();
      expect(message.branchSolutions?.length).toBe(24);
      expect(message.branchLabels?.length).toBe(24);
      expect(message.branchLabels?.[0])
        .toBe('sem-1+sem-3-rule-1-pcdrs-1 — consistent, informative, relevant');
      // The paged viewer replaces the concatenated-text pill on this path.
      expect(message.semanticText).toBe('');
    });

    it('skips branches with no rendered PCDRS rather than paging past blanks', () => {
      const prepared = [
        assignment('sem-1+sem-3', 1, 1),
        assignment('sem-1+sem-3', 2, 1, { solution: '' }),
      ];
      const verdicts = prepared.map(() => accepted);

      (component as any).handleVampireResponse(
        vampireResponse(prepared, verdicts), 'he saw him', prepared, false);

      const message = lastMessage();
      expect(message.branchSolutions?.length).toBe(1);
      // ... but the branch still has its TPTP block, so nothing disappears silently.
      expect((message.detailText ?? '').split('\n\n').filter(Boolean).length).toBe(2);
    });
  });

  describe('turn 1 post-processing (PCDRS on the first sentence)', () => {
    const structure = { constraints: [], annotations: [], choiceSpace: {} } as any;

    /** Turn 1 after its sentence was derived on its own and registered (what
     *  prepareLfgxdrtSolutions does): every reading of parse S0, whose structure is `structure`. */
    const acceptFirst = (message: string, solutions: any[]) => {
      const analysis = {
        id: 'sentence-1', text: message,
        syntax: [{ synId: 'S0', structure, graph: { graphElements: [] } }],
        semantics: solutions.map(solution => solution.semanticAnalysis),
        synSemMapping: { S0: solutions.map(solution => solution.semanticAnalysis.semId) },
      };
      (component as any).documentBuilder.upsertSentenceAnalyses(component.chatDocument, [analysis]);
      (component as any).acceptInitialLfgxdrtContext(message, { analysis, solutions, discriminants: [] });
    };

    beforeEach(() => {
      component.gswbPreferences = { gswbPreferences: { resolveDrs: true } } as any;
      component.vampirePreferences = { vampirePreferences: { logic_type: 0 } } as any;
      component.ruleString = 'rules';
      component.pragmaticsRuleString = 'pragmatics rules';
      component.chatDocument = {
        id: 'doc', semanticType: 'lfgxdrt', sentences: [], sequences: [], elements: [],
      } as any;
    });

    it('derives the first sentence from its own /apply_rules_xle parses, without parsing again', () => {
      reasoningPipelineSpy.generateDiscourseMappings.and.returnValue(of([]));
      dataServiceSpy.gswbDeduce.and.returnValue(of({ solutions: [
        { id: 'sentence-1-S1-s0', solutionKey: 'S1', semanticAnalysis: {
          syntacticOrigin: 'S1', semId: 'sentence-1-S1-s0', semString: 'P', graph: structure, semType: 'lfgxdrt' } },
      ] }));
      const ligerSolutions = [
        { solutionKey: 'S0', structureJson: { id: 'standalone-S0' }, graph: structure, meaningConstructors: '[1] a' },
        { solutionKey: 'S1', structureJson: { id: 'standalone-S1' }, graph: structure, meaningConstructors: '[1] b' },
      ];

      (component as any).prepareLfgxdrtSolutions('a man appeared', ligerSolutions[0], ligerSolutions, false);

      expect(dataServiceSpy.ligerSequence).not.toHaveBeenCalled();
      expect(dataServiceSpy.gswbDeduce).toHaveBeenCalledTimes(1);
      expect(dataServiceSpy.gswbDeduce.calls.mostRecent().args[0].proofs.map((proof: any) => proof.proofId)).toEqual(['S0', 'S1']);
      const registered = component.chatDocument.sentences[0];
      expect(registered.syntax.map(syntax => (syntax.structure as any).id)).toEqual(['standalone-S0', 'standalone-S1']);
      expect(registered.semantics.map(semantic => semantic.syntacticOrigin)).toEqual(['S1']);
      // Turn 1 post-processes each reading over its own parse.
      expect(reasoningPipelineSpy.generateDiscourseMappings.calls.mostRecent().args[0].sequenceStructure)
        .toEqual({ id: 'standalone-S1' });
    });

    /** A first sentence has no premise/hypothesis pair, so nothing is reasoned about --
     *  but a reflexive or pronoun in it still has to be shown as bound or unbound for
     *  that turn, which is what the PCDRS mappings carry. Chat used to skip this
     *  entirely, leaving sentence-1 as the only document element with no pragmatic
     *  layer at all. */
    it('generates PCDRS for the first sentence and records it as a DiscourseUpdate', () => {
      reasoningPipelineSpy.generateDiscourseMappings.and.returnValue(of([{
        mapping: {
          id: 'pcdrs-1', semantic: 'drs-with-binding', graph: { id: 'pcdrs-graph' },
          solution: '<svg>pcdrs-1</svg>',
          anaphoraRelations: [{ pronoun: 'x2', antecedent: 'x1' }],
        },
        ruleBranchIndex: 1,
      }] as any));

      acceptFirst('a man saw himself', [{
        id: 'sol-1',
        syntax: structure, solutionKey: 'S0',
        semanticAnalysis: {
          syntacticOrigin: 'S0', semId: 'sem-1', semString: 'P(x)',
          graph: structure, semType: 'lfgxdrt',
        },
      }]);

      expect(reasoningPipelineSpy.generateDiscourseMappings).toHaveBeenCalledTimes(1);
      const [request] = reasoningPipelineSpy.generateDiscourseMappings.calls.mostRecent().args;
      expect(request.sequenceStructure).toBe(structure);
      // The post-processing rules, not `component.ruleString` ('rules' above) -- that
      // input is the LiGER *parse* rule set. Sending it applied no post-processing rules,
      // so there was no SYNSEM, no POSSIBLE-ANT, and turn 1 bound no pronoun however many
      // it had.
      expect(request.ruleString).toBe('pragmatics rules');

      const update = component.chatDocument.discourseUpdates?.[0] as any;
      expect(update).toBeTruthy();
      expect(update.sourceElementId).toBe('sentence-1');
      expect(update.sourceElementKind).toBe('sentence');
      expect(update.discourse.length).toBe(1);
      expect(update.discourse[0].collapsed).toBe(true);
      expect(update.discourse[0].anaphoraMapping.relations.length).toBe(1);
      expect(update.semDiscourseMapping['sem-1']).toEqual(['pcdrs-1']);
      // Rule-branch provenance is kept; the tier-A/tier-B joins it was read off are not.
      expect(update.discourse[0].ruleBranch).toBe(1);
      // GSWB renders every branch to SVG and returns it as `solution`; chat never read
      // it, so its branches were text-only while analysis showed the rendered DRS.
      expect(update.discourse[0].svg).toBe('<svg>pcdrs-1</svg>');
      // Recorded now that the joins are not stored -- this is what makes them recomputable.
      expect(update.ruleString).toBe('pragmatics rules');
      expect(update.structures).toBeUndefined();
      expect(update.mergedGraphs).toBeUndefined();
      expect(component.loading).toBe(false);
    });

    it('renders turn 1\'s DRS as branches, not as a bare string', () => {
      reasoningPipelineSpy.generateDiscourseMappings.and.returnValue(of([
        {
          mapping: {
            id: 'pcdrs-1', semantic: 'drs-1', solution: '<svg>one</svg>',
            anaphoraRelations: [{ pronoun: 'x2', antecedent: 'x1' }],
          },
          ruleBranchIndex: 1,
        },
        {
          mapping: { id: 'pcdrs-2', semantic: 'drs-2', solution: '<svg>two</svg>', anaphoraRelations: [] },
          ruleBranchIndex: 2,
        },
      ] as any));

      acceptFirst('a man saw himself', [{
        id: 'sol-1',
        syntax: structure, solutionKey: 'S0',
        semanticAnalysis: {
          syntacticOrigin: 'S0', semId: 'sem-1', semString: 'P(x)',
          graph: structure, semType: 'lfgxdrt',
        },
      }]);

      // The template picks the DRS pill over the text pill on `branchSolutions`, so turn 1
      // showed a bare string purely because nothing ever filled this in: the reply is
      // pushed before post-processing runs, and the result was never written back.
      const reply = component.chatHistory.find(m => m.sender === 'Bot')!;
      expect(reply.branchSolutions?.map(s => s.solution)).toEqual(['<svg>one</svg>', '<svg>two</svg>']);
      expect(reply.branchLabels?.length).toBe(2);
      expect(reply.branchLabels?.[0]).toContain('1 binding(s)');
      expect(reply.branchLabels?.[1]).toContain('no binding');
      // Cleared for the same reason every later turn clears it -- otherwise the same DRS
      // appears twice, once rendered and once as text.
      expect(reply.semanticText).toBe('');
    });

    describe('anaphora ranking', () => {
      const acceptTwoBindings = () => {
        reasoningPipelineSpy.generateDiscourseMappings.and.returnValue(of([
          {
            mapping: {
              id: 'pcdrs-1', semantic: 'drs-1', solution: '<svg>dog</svg>',
              anaphoraRelations: [{ pronounReferentId: 's1:4', pronounDisplay: 'x4', antecedent: 'x2' }],
            },
            ruleBranchIndex: 1,
          },
          {
            mapping: {
              id: 'pcdrs-2', semantic: 'drs-2', solution: '<svg>cat</svg>',
              anaphoraRelations: [{ pronounReferentId: 's1:4', pronounDisplay: 'x4', antecedent: 'x1' }],
            },
            ruleBranchIndex: 2,
          },
        ] as any));
        acceptFirst('the cat saw the dog it barked', [{
          id: 'sol-1',
          syntax: structure, solutionKey: 'S0',
          semanticAnalysis: {
            syntacticOrigin: 'S0', semId: 'sem-1', semString: 'P(x)',
            graph: structure, semType: 'lfgxdrt',
          },
        }]);
      };
      const reply = () => component.chatHistory.find(m => m.sender === 'Bot')!;
      const ranking = {
        method: 'cosine-description', model: 'test-model', layers: [-1], pooling: 'mean', createdAt: 'now',
        relations: [
          { semanticOrigin: 'sem-1', pronoun: 'x4', antecedent: 'x2', pronounText: 'it', antecedentText: 'the dog', score: 0.85, cosine: 0.7, recencyRank: 1 },
          { semanticOrigin: 'sem-1', pronoun: 'x4', antecedent: 'x1', pronounText: 'it', antecedentText: 'the cat', score: 0.95, cosine: 0.9, recencyRank: 2 },
        ],
        branches: [{ discourseId: 'pcdrs-1', score: 0.85, rank: 2 }, { discourseId: 'pcdrs-2', score: 0.95, rank: 1 }],
        warnings: [],
      };

      it('orders turn 1\'s DRS branches by rank once lm answers, and stores the ranking', () => {
        const lm = new Subject<any>();
        dataServiceSpy.lmRankAnaphora.and.returnValue(lm);

        acceptTwoBindings();
        expect(reply().branchSolutions?.map(s => s.solution)).toEqual(['<svg>dog</svg>', '<svg>cat</svg>']);
        expect(component.chatDocument.discourseUpdates?.[0].anaphoraRanking).toBeUndefined();
        expect(dataServiceSpy.lmRankAnaphora).toHaveBeenCalledTimes(1);

        lm.next(ranking);
        lm.complete();

        expect(component.chatDocument.discourseUpdates?.[0].anaphoraRanking).toEqual(ranking as any);
        expect(reply().branchSolutions?.map(s => s.solution)).toEqual(['<svg>cat</svg>', '<svg>dog</svg>']);
        expect(reply().branchLabels?.[0]).toBe('pcdrs-2 — 1 binding(s) · rank 1 · mean score 0.950');
        expect(reply().branchRankings?.[0]?.rows).toEqual([['it', 'the cat', '0.950', 'cos 0.90', '', '2']]);
        expect(dataServiceSpy.lmRankAnaphora).toHaveBeenCalledTimes(1);
      });

      it('leaves turn 1 as it was when lm is down', () => {
        dataServiceSpy.lmRankAnaphora.and.returnValue(throwError(() => ({ status: 0 })));

        acceptTwoBindings();

        expect(component.chatDocument.discourseUpdates?.[0].discourse.length).toBe(2);
        expect(component.chatDocument.discourseUpdates?.[0].anaphoraRanking).toBeUndefined();
        expect(reply().branchSolutions?.map(s => s.solution)).toEqual(['<svg>dog</svg>', '<svg>cat</svg>']);
        expect(component.loading).toBe(false);
      });
    });

    it('leaves turn 1\'s text pill alone when no branch was rendered', () => {
      reasoningPipelineSpy.generateDiscourseMappings.and.returnValue(of([
        { mapping: { id: 'pcdrs-1', semantic: 'drs-1', anaphoraRelations: [] }, ruleBranchIndex: 1 },
      ] as any));

      acceptFirst('a man appeared', [{
        id: 'sol-1',
        syntax: structure, solutionKey: 'S0',
        semanticAnalysis: {
          syntacticOrigin: 'S0', semId: 'sem-1', semString: 'P(x)',
          graph: structure, semType: 'lfgxdrt',
        },
      }]);

      // GSWB returned no rendering for this branch, so the text pill is all there is --
      // clearing it would leave the turn showing nothing at all.
      const reply = component.chatHistory.find(m => m.sender === 'Bot')!;
      expect(reply.branchSolutions?.length ?? 0).toBe(0);
      expect(reply.semanticText).toBeTruthy();
    });

    it('still answers the turn when post-processing fails', () => {
      reasoningPipelineSpy.generateDiscourseMappings.and.returnValue(
        throwError(() => new Error('rules blew up')));

      acceptFirst('a man appeared', [{
        id: 'sol-1',
        syntax: structure, solutionKey: 'S0',
        semanticAnalysis: {
          syntacticOrigin: 'S0', semId: 'sem-1', semString: 'P(x)',
          graph: structure, semType: 'lfgxdrt',
        },
      }]);

      // The reply is already on screen; a post-processing failure costs the anaphora
      // view for this turn, not the turn.
      expect(component.chatHistory.some(m => m.text === 'Okay ...')).toBe(true);
      expect(component.chatDocument.discourseUpdates ?? []).toEqual([]);
      expect(component.loading).toBe(false);
    });
  });
});
