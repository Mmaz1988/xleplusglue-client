import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ChatComponent } from './chat.component';
import { DataService } from '../../data.service';
import { ReasoningPipelineService } from '../../reasoning/reasoning-pipeline.service';

describe('ChatComponent', () => {
  let component: ChatComponent;
  let fixture: ComponentFixture<ChatComponent>;

  beforeEach(() => {
    const dataServiceSpy = jasmine.createSpyObj('DataService', [
      'ligerSequence',
      'gswbMergeSequenceSemantics',
      'callVampire'
    ]);
    const reasoningPipelineSpy = jasmine.createSpyObj('ReasoningPipelineService', [
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

  describe('contextFromLfgxdrtChecks', () => {
    /** One accepted reasoning assignment: a rule branch x PCDRS mapping of `merged`.
     *  Every assignment of one pair carries the identical `merged` -- chat builds them as
     *  `{ ...item, checks }` -- which is exactly why they must not each become a prior. */
    const assignment = (semId: string, ruleBranch: number, mappingIndex: number) => ({
      contextIndex: 0,
      priorElementId: 'sentence-1',
      newSentenceId: 'sentence-2',
      merged: {
        id: semId,
        semantic: `drs([x${ruleBranch}],[])`,
        graph: { nodes: [] },
        semanticAnalysis: { semId, syntacticOrigin: 'syn-1', semType: 'lfgxdrt' },
      },
      syntax: { id: 'syn-1' },
      checks: {
        assignmentId: `${semId}/r${ruleBranch}/pcdrs-${mappingIndex}`,
        structureId: `${semId}-rule-${ruleBranch}`,
        baseStructureId: `${semId}-base`,
        sequenceTptp: `fof(seq_${ruleBranch}_${mappingIndex}, axiom, $true).`,
        mapping: {
          id: `${semId}-rule-${ruleBranch}-pcdrs-${mappingIndex}`,
          semantic: `drs([x${ruleBranch}],[collapsed(${mappingIndex})])`,
          anaphoraRelations: [{ pronoun: 'x5', antecedent: 'x2' }],
        },
      },
    });

    const accepted = { consistent: true, informative: true, relevant: true };

    /** The two sentences the merged sequence is built from. Registered so the document
     *  stays valid through the upserts -- validateAnalysisDocument rejects a sequence
     *  whose sentenceIds are unknown, and it runs on every emit. */
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
      const checks = prepared.map((item: any, index: number) =>
        index === 5 ? accepted : { consistent: false, informative: false });

      const result = (component as any).contextFromLfgxdrtChecks(
        prepared, checks, 'he saw him', false);

      expect(result.length).toBe(1);
      expect(result[0].tptp).toBe('fof(seq_6_1, axiom, $true).');
    });
  });
});
