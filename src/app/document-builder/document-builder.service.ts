import { Injectable } from '@angular/core';
import {
  SentenceAnalysis,
  SequenceAnalysis,
  XlePlusGlueDocument,
  XlePlusGlueElementRef,
} from '../models/models';

/**
 * Owns document lifecycle and registry upserts for an `XlePlusGlueDocument`, shared
 * between chat and the analysis view (glue-interface/gswb-vis) so the two stop
 * maintaining independent copies of "how a Sentence/Sequence gets registered."
 *
 * `upsertSentenceAnalyses`/`upsertSequenceAnalyses` are moved from
 * `GlueInterfaceComponent`, which owned the only implementation of this that already
 * persisted (chat's own registration was append-only and never needed to merge). See
 * `docs/plans/DOCUMENT_BUILDER_UNIFICATION_PLAN.md` for the "starting a new discourse
 * does not reset the document" defect this was extracted to fix: glue-interface never
 * called `newDocument()` again after construction, so a second discourse's `sentence-1`
 * silently merged into the first discourse's `sentence-1` under the old upsert, keeping
 * a stale `text` while accumulating the new sentence's syntax/semantics under it. This
 * class does not fix "call newDocument() on a new discourse" by itself -- callers must
 * still invoke it explicitly -- but it now refuses to silently merge two different
 * sentence texts under one id, so that failure mode surfaces loudly instead of
 * persisting a corrupted document.
 *
 * The merge/rebase half described in the plan (`mergeSequence`) is not implemented yet;
 * this is the document-assembly half only.
 */
@Injectable({ providedIn: 'root' })
export class DocumentBuilderService {

  newDocument(sessionKey: string, semanticType: string): XlePlusGlueDocument {
    return {
      id: sessionKey,
      semanticType,
      sentences: [],
      sequences: [],
      elements: [],
    };
  }

  /** Upserts sentences into the canonical `sentences` registry by id. An id not yet
   *  present is registered fresh; an id already present is merged into (syntax/semantics
   *  unioned by their own id, matching the sequence-registry's "never discard an
   *  alternative" invariant) rather than replaced, EXCEPT that a `text` mismatch under
   *  one id throws rather than silently keeping the stale text -- see class doc. */
  upsertSentenceAnalyses(document: XlePlusGlueDocument, analyses: SentenceAnalysis[]): void {
    analyses.forEach(incoming => {
      const existing = document.sentences.find(sentence => sentence.id === incoming.id);
      if (!existing) {
        document.sentences.push({
          ...incoming,
          syntax: [...incoming.syntax],
          semantics: [...incoming.semantics],
          synSemMapping: { ...incoming.synSemMapping },
          discriminants: [...(incoming.discriminants ?? [])],
          selectedSemanticIds: [...(incoming.selectedSemanticIds ?? incoming.semantics.map(semantic => semantic.semId))],
          selectedScopeIds: [...(incoming.selectedScopeIds ?? [])],
          selectedMcIds: [...(incoming.selectedMcIds ?? [])],
        });
        this.upsertElementRef(document, { kind: 'sentence', id: incoming.id });
        document.activeElementId = incoming.id;
        return;
      }

      if (existing.text !== incoming.text) {
        throw new Error(
          `Sentence ${incoming.id} already exists with a different text `
          + `("${existing.text}" vs. incoming "${incoming.text}"). This id belongs to two `
          + `different sentences -- likely a stale document that was never reset for a new `
          + `discourse. Refusing to merge them under one id.`);
      }

      existing.syntax = this.mergeById(existing.syntax, incoming.syntax, item => item.synId);
      existing.semantics = this.mergeById(existing.semantics, incoming.semantics, item => item.semId);
      existing.discriminants = [...(incoming.discriminants ?? existing.discriminants ?? [])];
      existing.selectedSemanticIds = [...(incoming.selectedSemanticIds ?? existing.selectedSemanticIds ?? [])];
      existing.selectedScopeIds = [...(incoming.selectedScopeIds ?? existing.selectedScopeIds ?? [])];
      existing.selectedMcIds = [...(incoming.selectedMcIds ?? existing.selectedMcIds ?? [])];
      Object.entries(incoming.synSemMapping).forEach(([syntaxId, semanticIds]) => {
        existing.synSemMapping[syntaxId] = Array.from(new Set([
          ...(existing.synSemMapping[syntaxId] ?? []),
          ...semanticIds,
        ]));
      });
      // No `elements` write needed: the ref for `existing.id` already occupies the right
      // position and never changes -- only the registry entry's own fields are mutated.
    });
  }

  /** Upserts sequences into the canonical `sequences` registry by id, preserving each
   *  sequence's position on update (matching sentence-upsert semantics) rather than
   *  moving it to the end of the timeline. */
  upsertSequenceAnalyses(document: XlePlusGlueDocument, analyses: SequenceAnalysis[]): void {
    analyses.forEach(incoming => {
      const index = document.sequences.findIndex(sequence => sequence.id === incoming.id);
      if (index === -1) {
        document.sequences.push(incoming);
      } else {
        document.sequences[index] = incoming;
      }
      this.upsertElementRef(document, { kind: 'sequence', id: incoming.id });
      document.activeElementId = incoming.id;
    });
  }

  /** Appends a ref if this id isn't already registered in `elements`; a no-op otherwise,
   *  so callers can call it unconditionally on every upsert without disturbing the
   *  existing position of an already-registered sentence/sequence. */
  private upsertElementRef(document: XlePlusGlueDocument, ref: XlePlusGlueElementRef): void {
    if (!document.elements.some(existingRef => existingRef.id === ref.id)) {
      document.elements = [...document.elements, ref];
    }
  }

  private mergeById<T>(existing: T[], incoming: T[], id: (item: T) => string): T[] {
    const merged = new Map(existing.map(item => [id(item), item]));
    incoming.forEach(item => merged.set(id(item), item));
    return Array.from(merged.values());
  }
}
