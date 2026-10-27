import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { of, Subject, throwError } from 'rxjs';

import { ChatComponent } from './chat.component';
import { DataService } from '../../data.service';
import { POST_PROCESSING_SKIPPED_NOTICE } from '../../models/models';
import { ReasoningPipelineService } from '../../reasoning/reasoning-pipeline.service';
import { reasoningAssignmentId } from '../../analysis-model';

describe('ChatComponent', () => {
  let component: ChatComponent;
  let fixture: ComponentFixture<ChatComponent>;
  let dataServiceSpy: jasmine.SpyObj<{
    ligerAnnotate: any; ligerSequence: any; gswbDeduce: any; gswbMergeSequenceSemantics: any;
    callVampire: any; lmRankAnaphora: any;
  }>;
  let reasoningPipelineSpy: jasmine.SpyObj<{
    generateDiscourseMappings: any; prepareStoredReadingChecks: any;
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
      'generateDiscourseMappings',
      'prepareStoredReadingChecks',
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

  /** The sentence the first turn registered. Registered so the document stays valid through
   *  the upserts -- validateAnalysisDocument rejects a sequence whose sentenceIds are
   *  unknown, and it runs on every emit. */
  beforeEach(() => {
    component.chatDocument.sentences = [{
      id: 'sentence-1',
      text: 'a man saw a man',
      syntax: [{ synId: 'sentence-1-syn', structure: {}, graph: {} }],
      semantics: [{
        syntacticOrigin: 'sentence-1-syn', semId: 'sem-1a', semString: 'P1', semType: 'lfgxdrt',
      }, {
        syntacticOrigin: 'sentence-1-syn', semId: 'sem-1b', semString: 'P2', semType: 'lfgxdrt',
      }],
      synSemMapping: { 'sentence-1-syn': ['sem-1a', 'sem-1b'] },
    }] as any;
  });

  /** A later turn (N4 6d): step 1 stores every reading, step 2 reasons over the selected
   *  ones, the latest message narrows what the next turn builds on. */
  describe('a later turn', () => {
    const structure = { constraints: [], annotations: [], choiceSpace: {} };
    const variantStructure = { id: 'variant-structure' };
    const unbound = { pronouns: [0, 0, 1], binding: [0, 0, 0], accommodation: [0, 0, 0] };
    const bound = { pronouns: [1, 0, 0], binding: [0, 0, 0], accommodation: [0, 0, 0] };

    /** LiGER over the supplied sentences: the prior's one parse (S0 in the call) and the new
     *  sentence's one parse (S1), the new part offset by the prior's constructors. */
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

    /** A new sentence as deriveSentence registers it: one parse, `readings` readings. */
    const newSentence = (id: string, readings: number, discriminants: any[] = []) => ({
      id, text: 'he saw him',
      syntax: [{ synId: 'S0', structure, graph: { graphElements: [] } }],
      semantics: Array.from({ length: readings }, (_, r) => ({
        syntacticOrigin: 'S0', semId: `${id}-S0-s${r}`, semString: `Q${r}`, graph: structure, semType: 'lfgxdrt',
      })),
      synSemMapping: { S0: Array.from({ length: readings }, (_, r) => `${id}-S0-s${r}`) },
      discriminants,
    });

    const priorReading = (semId: string, semantic: string, elementId = 'sentence-1') => ({
      original: 'a man saw a man', prolog_drs: '', prolog_fol: '', tptp: '', box: '',
      semantic, semanticGraph: structure, syntax: structure,
      semanticAnalysis: { syntacticOrigin: 'sentence-1-syn', semId, semString: semantic, semType: 'lfgxdrt', graph: structure },
      elementId,
    });

    /** Each pair yields two readings: `-pcdrs-1` binds its pronoun, `-pcdrs-2` leaves it unbound. */
    const readingsOf = (scopeId: string, semanticOrigin: string) => [1, 2].map(n => ({
      mapping: {
        id: `${scopeId}-pcdrs-${n}`, semantic: `drs-${n}`, solution: `<svg>${scopeId}-${n}</svg>`,
        anaphoraRelations: n === 1 ? [{ pronounReferentId: 's1:4', pronounDisplay: 'x4', antecedent: 'x1' }] : [],
        pragmaticProfile: n === 1 ? bound : unbound,
      },
      ruleBranchIndex: 1,
      semanticOrigin,
    }));

    /** Which readings Vampire accepts; every other is consistent but uninformative. */
    let accepts: (readingId: string) => boolean;

    const startTurn = (sentence: any, selection: any = { criteria: [], filters: [], k: null }) => {
      component.chatDocument.sentences.push(JSON.parse(JSON.stringify(sentence)));
      (component as any).turnSelection = selection;
      (component as any).finishLfgxdrtPreparation('he saw him', sentence);
    };
    const sentReadings = () => (dataServiceSpy.callVampire.calls.mostRecent().args[0].tptp_checks ?? [])
      .map((bundle: any) => bundle.mappingId);
    const lastMessage = () => component.chatHistory[component.chatHistory.length - 1];

    beforeEach(() => {
      component.gswbPreferences = { gswbPreferences: { resolveDrs: true } } as any;
      component.vampirePreferences = { vampirePreferences: { logic_type: 0 } } as any;
      component.ruleString = 'rules';
      component.pragmaticsRuleString = 'pragmatics rules';
      component.activeIndices = [];
      component.context = [priorReading('sem-1a', 'P1'), priorReading('sem-1b', 'P2')] as any;
      accepts = () => true;
      dataServiceSpy.lmRankAnaphora.and.returnValue(throwError(() => ({ status: 0 })));
      // One parse per sentence supplied, S<n> positionally, each part offset by 7 constructors.
      dataServiceSpy.ligerSequence.and.callFake((request: any) => {
        const ids = request.sentenceIds.map((_: string, index: number) => `S${index}`);
        return of({ solutions: [{
          ...ligerResponse().solutions[0],
          solutionKey: `sequence-1-${ids.join('+')}`,
          sequenceParts: ids.map((syntaxVariantId: string, sourceIndex: number) =>
            ({ sourceIndex, syntaxVariantId, sourceIndexOffset: sourceIndex * 7 })),
        }] });
      });
      dataServiceSpy.gswbMergeSequenceSemantics.and.callFake((request: any) => {
        const id = request.parts.map((part: any) => part.id).join('+');
        return of({ id, solutionKey: request.solutionKey, semanticAnalysis: {
          syntacticOrigin: request.solutionKey, semId: id, semString: `merged ${id}`, graph: structure, semType: 'lfgxdrt', svg: 'merged',
        } });
      });
      reasoningPipelineSpy.generateDiscourseMappings.and.callFake((request: any) =>
        of(readingsOf(request.scopeId, request.merged.semId)));
      reasoningPipelineSpy.prepareStoredReadingChecks.and.callFake((request: any) => of({
        scopeId: request.scopeId,
        assignments: request.readings.map((reading: any) => ({
          pairId: request.scopeId, assignmentId: reasoningAssignmentId({ ...request.scope, ruleBranchIndex: reading.ruleBranch, anaphoraBranchId: reading.id }), mappingId: reading.id,
          ruleBranchIndex: reading.ruleBranch,
          checks: Object.fromEntries(['info_pos_check', 'info_neg_check', 'cons_pos_check', 'cons_neg_check']
            .map(name => [name, { name, semantic: 's', tptp: 't' }])),
          contextTptp: 'ctx', sequenceTptp: `fof(${reading.id}).`, degradations: [],
        })),
        failures: [], degradations: [],
      }));
      dataServiceSpy.callVampire.and.callFake((request: any) => of({
        context_checks_mapping: Object.fromEntries((request.tptp_checks ?? []).map((bundle: any, index: number) => [index, {
          assignment_id: bundle.assignmentId, consistent: true, informative: accepts(bundle.mappingId), relevant: false, glyph: '<svg/>',
        }])),
      }));
    });

    it('stores the turn\'s sequence and every reading before Vampire', () => {
      dataServiceSpy.callVampire.and.returnValue(new Subject());

      startTurn(newSentence('sentence-3', 1));

      expect(dataServiceSpy.gswbDeduce).not.toHaveBeenCalled();
      expect(dataServiceSpy.callVampire).toHaveBeenCalledTimes(1);
      const update = component.chatDocument.discourseUpdates?.find(du => du.id === 'du-sentence-1+sentence-3');
      expect(update?.discourse.length).toBe(4);
      expect(Object.keys(update!.semDiscourseMapping).sort())
        .toEqual(['sem-1a+sentence-3-S0-s0', 'sem-1b+sentence-3-S0-s0']);
      const sequence = component.chatDocument.sequences.find(candidate => candidate.id === 'sentence-1+sentence-3');
      expect(sequence?.semantics.map(semantic => semantic.semId).sort())
        .toEqual(['sem-1a+sentence-3-S0-s0', 'sem-1b+sentence-3-S0-s0']);
      // The reasoning half reads the stored readings: no rules, no PCDRS again.
      const requests = reasoningPipelineSpy.prepareStoredReadingChecks.calls.allArgs().map(([request]: any[]) => request);
      expect(requests.map((request: any) => request.premiseSemantic).sort()).toEqual(['P1', 'P2']);
      // The scope id names the PRIOR'S READING, not just its element id: GSWB derives every
      // PCDRS id from it (misc/current/chat-document-pronoun-bug3.json).
      expect(new Set(requests.map((request: any) => request.scopeId)).size).toBe(2);
      requests.forEach((request: any) => expect(request.scope.hypothesisSemanticIds).toEqual(['sentence-3-S0-s0']));
    });

    it('reasons over every reading when the default keeps all of them: nothing is pruned', () => {
      startTurn(newSentence('sentence-3', 1));

      expect(sentReadings().length).toBe(4);
      expect(lastMessage().branchSolutions?.length).toBe(4);
    });

    it('sends only the readings the default the turn started with keeps, and records it', () => {
      startTurn(newSentence('sentence-3', 1), { criteria: [], filters: ['unbound'], k: null });

      expect(sentReadings().every((id: string) => id.endsWith('-pcdrs-1'))).toBeTrue();
      expect(sentReadings().length).toBe(2);
      // Every reading is stored all the same; the message shows only the ones sent.
      expect(component.chatDocument.discourseUpdates?.find(du => du.id === 'du-sentence-1+sentence-3')?.discourse.length).toBe(4);
      expect(lastMessage().branchSolutions?.length).toBe(2);
      const reasoning = component.chatDocument.reasoningUpdates?.[0];
      expect(reasoning?.readingSelection).toEqual({ criteria: [], filters: ['unbound'], k: null, applied: true });
      expect(reasoning?.assignments.every(assignment => assignment.discourseUpdateId === 'du-sentence-1+sentence-3'
        && !!assignment.discourseId)).toBeTrue();
    });

    it('says so when the selection keeps no reading, and asks Vampire nothing', () => {
      reasoningPipelineSpy.generateDiscourseMappings.and.callFake((request: any) =>
        of(readingsOf(request.scopeId, request.merged.semId).slice(1)));

      startTurn(newSentence('sentence-3', 1), { criteria: [], filters: ['unbound'], k: null });

      expect(dataServiceSpy.callVampire).not.toHaveBeenCalled();
      expect(lastMessage().text).toContain('No reading was selected');
      expect(component.loading).toBeFalse();
    });

    it('carries one context entry per merged reading with an accepted reading', () => {
      accepts = id => id.includes('sem-1a') && id.endsWith('-pcdrs-2');

      startTurn(newSentence('sentence-3', 1));

      expect(component.context.map(entry => entry.semanticAnalysis?.semId)).toEqual(['sem-1a+sentence-3-S0-s0']);
      expect(component.context[0].elementId).toBe('sentence-1+sentence-3');
      expect(component.context[0].tptp).toContain('-pcdrs-2');
    });

    it('lets the latest message pick among the accepted readings only', () => {
      accepts = id => id.endsWith('-pcdrs-2');

      startTurn(newSentence('sentence-3', 1));

      const view = component.messageViews.get(lastMessage())!;
      expect(view.orderOnly).toBeFalse();
      expect(view.readingSelection).toEqual({ selection: { criteria: [], filters: [], k: null }, own: false });
      expect([...view.selectableIds!].sort()).toEqual(sentReadings().filter((id: string) => id.endsWith('-pcdrs-2')).sort());
    });

    it('builds the next turn on what survives the latest message', () => {
      startTurn(newSentence('sentence-3', 1));
      expect(component.priorContextIndices()).toEqual([0, 1]);

      // Without unbound pronouns, top 1: both merged readings keep their bound reading, tied.
      component.onReadingSelectionChange(lastMessage(), { criteria: ['pronouns'], filters: ['unbound'], k: 1 });
      expect(component.chatDocument.discourseUpdates?.find(du => du.id === 'du-sentence-1+sentence-3')?.readingSelection)
        .toEqual({ criteria: ['pronouns'], filters: ['unbound'], k: 1 });
      expect(component.priorContextIndices()).toEqual([0, 1]);

      // The history's selection narrows on top of it.
      component.activeIndices = [1];
      expect(component.priorContextIndices()).toEqual([1]);
      expect(component.priorSummary).toBe('1 of 2 readings');
    });

    it('keeps a merged reading out of the prior when none of its accepted readings survives', () => {
      accepts = id => id.includes('sem-1a') || id.endsWith('-pcdrs-2');

      startTurn(newSentence('sentence-3', 1));
      expect(component.priorContextIndices()).toEqual([0, 1]);

      // sem-1b's only accepted reading leaves its pronoun unbound.
      component.onReadingSelectionChange(lastMessage(), { criteria: [], filters: ['unbound'], k: null });
      expect(component.priorContextIndices()).toEqual([0]);
    });

    it('narrows only the latest sentence by its discriminants', () => {
      component.context = [priorReading('sem-1a', 'P1')] as any;
      const discriminant = { id: 'd1', type: 'scope', identifier: 'd1', associatedSolutions: ['sentence-3-S0-s1'] };

      startTurn(newSentence('sentence-3', 2, [discriminant]));
      expect(component.priorContextIndices()).toEqual([0, 1]);
      const view = component.messageViews.get(lastMessage())!;
      // The view narrows the discourse readings built from the sentence readings it names.
      expect(view.discriminants?.[0].associatedSolutions?.length).toBe(2);
      expect(view.discriminants?.[0].associatedSolutions?.every(id => id.includes('sentence-3-S0-s1'))).toBeTrue();

      component.onDiscriminantSelectionChange(lastMessage(), { scopeIds: ['d1'], mcIds: [] });

      expect(component.chatDocument.sentences.find(sentence => sentence.id === 'sentence-3')?.selectedScopeIds).toEqual(['d1']);
      expect(component.context[component.priorContextIndices()[0]].semanticAnalysis?.semId).toBe('sem-1a+sentence-3-S0-s1');
      expect(component.priorContextIndices().length).toBe(1);
    });

    it('keeps the message\'s selection as it is during a turn', () => {
      startTurn(newSentence('sentence-3', 1));
      const first = lastMessage();
      dataServiceSpy.ligerSequence.and.returnValue(new Subject());

      component.loading = true;
      expect(component.messageViews.get(first)?.orderOnly).toBeTrue();
      startTurn(newSentence('sentence-4', 1));

      const stored = () => component.chatDocument.discourseUpdates?.find(du => du.id === 'du-sentence-1+sentence-3')?.readingSelection;
      component.onReadingSelectionChange(first, { criteria: [], filters: ['unbound'], k: null });
      expect(stored()).toBeUndefined();
      // The new turn appends to the turn's sequence.
      expect(dataServiceSpy.ligerSequence.calls.mostRecent().args[0].sentenceIds).toEqual(['sentence-1', 'sentence-3', 'sentence-4']);
    });

    it('makes an older message order only, its selection fixed', () => {
      startTurn(newSentence('sentence-3', 1));
      const first = lastMessage();
      const second = (component as any).pushChatMessage({ text: 'next', sender: 'Bot', branchSolutions: first.branchSolutions });

      (component as any).setLatestTurn(second, {
        updateId: 'du-sentence-1+sentence-3', sentenceId: 'sentence-3', defaultSelection: { criteria: [], filters: [], k: null },
        sent: null, accepted: null,
      });

      expect(component.messageViews.get(first)).toEqual(jasmine.objectContaining({
        orderOnly: true, readingSelection: null, selectableIds: null, discriminants: null,
      }));
      expect(component.messageViews.get(second)?.orderOnly).toBeFalse();
      component.onReadingSelectionChange(first, { criteria: [], filters: ['unbound'], k: null });
      expect(component.chatDocument.discourseUpdates?.find(du => du.id === 'du-sentence-1+sentence-3')?.readingSelection)
        .toEqual({ criteria: [], filters: [], k: null });
    });

    it('leaves the discourse as it was when no reading is accepted (an entailed input)', () => {
      startTurn(newSentence('sentence-3', 1));
      const first = lastMessage();
      const context = component.context;
      const rows = component.history.length;
      accepts = () => false;

      startTurn(newSentence('sentence-4', 1), { criteria: [], filters: [], k: 1 });

      const answer = lastMessage();
      expect(answer.text).toBe('Your input is not informative.');
      // The context, the history's last row and the latest message are the previous turn's.
      expect(component.context).toBe(context);
      expect(component.history.length).toBe(rows + 1);
      expect(component.history[component.history.length - 1].map(entry => entry.semanticAnalysis?.semId))
        .toEqual(context.map(entry => entry.semanticAnalysis?.semId));
      expect(component.messageViews.get(first)?.orderOnly).toBeFalse();
      expect(component.chatDocument.discourseUpdates?.find(du => du.id === 'du-sentence-1+sentence-3')?.readingSelection).toBeUndefined();
      expect(component.priorContextIndices()).toEqual([0, 1]);
      // The answer shows what was checked, with its verdicts, for inspection only.
      expect(answer.branchSolutions?.length).toBe(sentReadings().length);
      expect(answer.branchLabels?.[0]).toBe('consistent, uninformative, irrelevant');
      expect(component.messageViews.get(answer)?.orderOnly).toBeTrue();
    });

    it('hands the pills one TPTP block and one DRS per reading sent, labelled with its verdict', () => {
      accepts = id => id.endsWith('-pcdrs-1');

      startTurn(newSentence('sentence-3', 1));

      const message = lastMessage();
      const blocks = (message.detailText ?? '').split('\n\n').filter(Boolean);
      expect(blocks.length).toBe(4);
      // The verdict alone: the reading's id overlapped the controls.
      expect(message.branchLabels?.[0]).toBe('consistent, informative, irrelevant');
      expect(message.branchLabels?.[1]).toBe('consistent, uninformative, irrelevant');
      expect(blocks[0]).toContain('-pcdrs-1 — consistent, informative, irrelevant');
      // The paged viewer replaces the concatenated-text pill on this path.
      expect(message.semanticText).toBe('');
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

      (component as any).prepareLfgxdrtSolutions('a man appeared', ligerSolutions[0], ligerSolutions);

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

    it('makes turn 1\'s message the latest: every reading selectable, its narrowing the next prior', () => {
      const profile = (pronouns: number[]) => ({ pronouns, binding: [0, 0, 0], accommodation: [0, 0, 0] });
      reasoningPipelineSpy.generateDiscourseMappings.and.callFake((request: any) => of([{
        mapping: {
          id: `${request.scopeId}-pcdrs-1`, semantic: 'drs', solution: '<svg/>', anaphoraRelations: [],
          pragmaticProfile: profile(request.merged.semId === 'sem-2' ? [0, 0, 1] : [1, 0, 0]),
        },
        ruleBranchIndex: 1,
      }]));
      const solution = (semId: string) => ({
        id: semId, syntax: structure, solutionKey: 'S0',
        semanticAnalysis: { syntacticOrigin: 'S0', semId, semString: `P-${semId}`, graph: structure, semType: 'lfgxdrt' },
      });

      acceptFirst('a man saw him', [solution('sem-1'), solution('sem-2')]);

      const reply = component.chatHistory.find(m => m.sender === 'Bot')!;
      const view = component.messageViews.get(reply)!;
      expect(view.orderOnly).toBeFalse();
      expect(view.selectableIds).toBeNull();
      expect(component.priorContextIndices()).toEqual([0, 1]);

      component.onReadingSelectionChange(reply, { criteria: [], filters: ['unbound'], k: null });

      expect(component.priorContextIndices()).toEqual([0]);
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

      it('captions turn 1\'s DRS branches with their rank once lm answers, and hands the pill the ranking', () => {
        const lm = new Subject<any>();
        dataServiceSpy.lmRankAnaphora.and.returnValue(lm);

        acceptTwoBindings();
        expect(reply().branchSolutions?.map(s => s.solution)).toEqual(['<svg>dog</svg>', '<svg>cat</svg>']);
        expect(component.chatDocument.discourseUpdates?.[0].anaphoraRanking).toBeUndefined();
        expect(dataServiceSpy.lmRankAnaphora).toHaveBeenCalledTimes(1);

        lm.next(ranking);
        lm.complete();

        expect(component.chatDocument.discourseUpdates?.[0].anaphoraRanking).toEqual(ranking as any);
        // Generation order, captions aligned: the pill's sem view orders them by its options.
        expect(reply().branchSolutions?.map(s => s.solution)).toEqual(['<svg>dog</svg>', '<svg>cat</svg>']);
        // The ranking is in its pill, not the caption.
        expect(reply().branchLabels?.[1]).toBe('1 binding(s)');
        expect(reply().branchRankings?.[1]?.rows).toEqual([['it', 'the cat', '0.950', 'cos 0.90', '', '2']]);
        expect(component.messageViews.get(reply())?.readingOrder.updates[0].anaphoraRanking).toEqual(ranking as any);
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
