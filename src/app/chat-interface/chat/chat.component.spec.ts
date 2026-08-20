import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { of } from 'rxjs';

import { ChatComponent } from './chat.component';
import { DataService } from '../../data.service';
import { ReasoningPipelineService } from '../../reasoning/reasoning-pipeline.service';

describe('ChatComponent', () => {
  let component: ChatComponent;
  let fixture: ComponentFixture<ChatComponent>;
  let dataServiceSpy: jasmine.SpyObj<{
    ligerSequence: any; gswbDeduce: any; gswbMergeSequenceSemantics: any; callVampire: any;
  }>;
  let reasoningPipelineSpy: jasmine.SpyObj<{
    prepareReasoningChecks: any; prepareReasoningChecksSequentially: any;
  }>;

  beforeEach(() => {
    dataServiceSpy = jasmine.createSpyObj('DataService', [
      'ligerSequence',
      'gswbDeduce',
      'gswbMergeSequenceSemantics',
      'callVampire'
    ]);
    reasoningPipelineSpy = jasmine.createSpyObj('ReasoningPipelineService', [
      'prepareReasoningChecks',
      'prepareReasoningChecksSequentially'
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
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
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
      semantic: `drs([x${ruleBranch}],[])`,
      graph: { nodes: [] },
      semanticAnalysis: {
        semId,
        syntacticOrigin: overrides.syntacticOrigin ?? 'syn-1',
        semType: 'lfgxdrt',
      },
    },
    syntax: { id: overrides.syntacticOrigin ?? 'syn-1' },
    checks: {
      assignmentId: `${semId}/r${ruleBranch}/pcdrs-${mappingIndex}`,
      structureId: `${semId}-rule-${ruleBranch}`,
      baseStructureId: `${semId}-base`,
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

  describe('finishLfgxdrtPreparation (Stage B: chat on DocumentBuilderService)', () => {
    const structure = { constraints: [], annotations: [], choiceSpace: {} };

    /** LiGER's merged-sequence response for the syntax merge -- the same shape
     *  glue-vis's own document-builder path uses, now that chat no longer re-derives
     *  semantics from the merged structure. */
    const ligerSequenceResponse = () => ({
      solutions: [{
        structureJson: structure,
        sequenceAnalysis: {
          id: 'seq-1', text: 'a man saw a man he saw him',
          sentences: [{ id: 'sentence-1' }, { id: 'sentence-3' }],
          syntax: [{ synId: 'seq-1', structure, graph: { graphElements: [] } }],
          semantics: [], synSemMapping: {},
        },
      }],
    });

    beforeEach(() => {
      component.gswbPreferences = { gswbPreferences: { resolveDrs: true } } as any;
      component.vampirePreferences = { vampirePreferences: { logic_type: 0 } } as any;
      component.ruleString = 'rules';
      component.activeIndices = [];
    });

    it('merges syntax once per distinct prior element, not once per (prior x reading) pairing, and never re-derives semantics', () => {
      // Two accepted READINGS of the SAME prior element (an ambiguous premise) --
      // this is exactly the shape that used to trigger a second, redundant
      // ligerSequence/gswbDeduce round trip per reading before Stage B. Now the new
      // sentence's own reading is never re-derived at all: mergeSequence reuses it
      // verbatim, the same call glue-vis's own document-builder path uses.
      component.context = [
        {
          original: 'a man saw a man', prolog_drs: '', prolog_fol: '', tptp: '', box: '',
          semantic: 'P1', semanticGraph: { constraints: [], annotations: [], choiceSpace: {} },
          syntax: structure,
          semanticAnalysis: { syntacticOrigin: 'syn-1a', semId: 'sem-1a', semString: 'P1', semType: 'lfgxdrt' },
          elementId: 'sentence-1',
        },
        {
          original: 'a man saw a man', prolog_drs: '', prolog_fol: '', tptp: '', box: '',
          semantic: 'P2', semanticGraph: { constraints: [], annotations: [], choiceSpace: {} },
          syntax: structure,
          semanticAnalysis: { syntacticOrigin: 'syn-1b', semId: 'sem-1b', semString: 'P2', semType: 'lfgxdrt' },
          elementId: 'sentence-1',
        },
      ] as any;

      dataServiceSpy.ligerSequence.and.returnValue(of(ligerSequenceResponse()));
      dataServiceSpy.gswbMergeSequenceSemantics.and.callFake((request: any) => of({
        id: request.parentSolutionId, solution: 'merged', solutionKey: request.parentSolutionId,
        graph: structure, semantic: 'merged',
      }));
      let preparedCallCount = 0;
      reasoningPipelineSpy.prepareReasoningChecks.and.callFake((request: any) => {
        preparedCallCount++;
        return of({ scopeId: request.scopeId, assignments: [], failures: [], degradations: [] });
      });

      (component as any).finishLfgxdrtPreparation('he saw him', [
        { id: 'cand-1', semantic: 'Q', solution: 'Q', graph: structure, solutionKey: 'part-1' },
      ], false, []);

      // One prior element (both readings share one syntax variant), one syntax variant
      // of the new sentence -> one group -> one syntax merge, no re-derivation.
      expect(dataServiceSpy.ligerSequence).toHaveBeenCalledTimes(1);
      expect(dataServiceSpy.gswbDeduce).not.toHaveBeenCalled();
      // But every (prior-reading x current-reading) pair still gets its own semantic
      // merge and its own reasoning-check preparation -- nothing is discarded just
      // because the syntax-merge group was shared.
      expect(dataServiceSpy.gswbMergeSequenceSemantics).toHaveBeenCalledTimes(2);
      expect(preparedCallCount).toBe(2);

      const premiseSemantics = reasoningPipelineSpy.prepareReasoningChecks.calls.allArgs()
        .map(([request]: any[]) => request.premiseSemantic).sort();
      expect(premiseSemantics).toEqual(['P1', 'P2']);
      reasoningPipelineSpy.prepareReasoningChecks.calls.allArgs().forEach(([request]: any[]) => {
        expect(request.prune).toBeFalse();
        expect(request.sequenceStructure).toEqual(structure);
      });
    });

    it('a sentence with two readings sharing one syntax variant produces exactly one pair per reading, not a duplicated cross product', () => {
      // The confirmed regression (misc/current/chat-document-plan-b-test.json): turn 2
      // had 8 solutions instead of 4, because the old rebase path cross-produced a
      // redundant "group" of pairSpecs against freshly re-derived readings. Routed
      // through the shared mergeSequence, one previous reading x two current readings
      // (sharing one syntax variant, e.g. "Every Swede is a Scandinavian") must yield
      // exactly two pairs, with the syntax merge still deduplicated to one call.
      component.context = [{
        original: 'a man saw a man', prolog_drs: '', prolog_fol: '', tptp: '', box: '',
        semantic: 'P1', semanticGraph: { constraints: [], annotations: [], choiceSpace: {} },
        syntax: structure,
        semanticAnalysis: { syntacticOrigin: 'syn-1a', semId: 'sem-1a', semString: 'P1', semType: 'lfgxdrt' },
        elementId: 'sentence-1',
      }] as any;

      dataServiceSpy.ligerSequence.and.returnValue(of(ligerSequenceResponse()));
      dataServiceSpy.gswbMergeSequenceSemantics.and.callFake((request: any) => of({
        id: request.parentSolutionId, solution: 'merged', solutionKey: request.parentSolutionId,
        graph: structure, semantic: 'merged',
      }));
      let preparedCallCount = 0;
      reasoningPipelineSpy.prepareReasoningChecks.and.callFake((request: any) => {
        preparedCallCount++;
        return of({ scopeId: request.scopeId, assignments: [], failures: [], degradations: [] });
      });

      (component as any).finishLfgxdrtPreparation('every swede is a scandinavian', [
        { id: 'cand-1', semantic: 'Q1', solution: 'Q1', graph: structure, solutionKey: 'part-1' },
        { id: 'cand-2', semantic: 'Q2', solution: 'Q2', graph: structure, solutionKey: 'part-1' },
      ], false, []);

      expect(dataServiceSpy.ligerSequence).toHaveBeenCalledTimes(1);
      expect(dataServiceSpy.gswbDeduce).not.toHaveBeenCalled();
      expect(dataServiceSpy.gswbMergeSequenceSemantics).toHaveBeenCalledTimes(2);
      expect(preparedCallCount).toBe(2);
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
});
