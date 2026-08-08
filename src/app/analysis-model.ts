import {
  DiscourseUpdate,
  SemanticAnalysis,
  SentenceAnalysis,
  SequenceAnalysis,
  SynSemMapping,
  XlePlusGlueDocument,
  XlePlusGlueElement,
  XlePlusGlueElementRef,
} from './models/models';

/** Resolves a thin element ref against the document's canonical sentences/sequences
 *  registries. Both SentenceAnalysis and SequenceAnalysis share the syntax/semantics/
 *  synSemMapping shape, so callers that only need that shared shape (post-processing,
 *  validation) can treat the result uniformly without either being coerced into the
 *  other's type. */
export function resolveElement(
  document: XlePlusGlueDocument,
  ref: XlePlusGlueElementRef,
): XlePlusGlueElement | undefined {
  return ref.kind === 'sentence'
    ? document.sentences.find(sentence => sentence.id === ref.id)
    : document.sequences.find(sequence => sequence.id === ref.id);
}

/** Resolves by id alone (sentence and sequence ids are drawn from the same id space and
 *  never collide) -- used where only an id is available, e.g. DiscourseUpdate.sourceElementId. */
export function findElementById(
  document: XlePlusGlueDocument,
  id: string,
): XlePlusGlueElement | undefined {
  return document.sentences.find(sentence => sentence.id === id)
    ?? document.sequences.find(sequence => sequence.id === id);
}

/** Builds a stable ordered parent ID. Array position must not be used as identity. */
export function compositeAnalysisId(parts: string[]): string {
  const ids = parts.map(part => part.trim()).filter(Boolean);
  if (!ids.length) {
    throw new Error('Cannot create a composite analysis ID without parent IDs.');
  }
  return ids.join('+');
}

/** Returns all sentence alternatives when no explicit selection has been stored. */
export function selectedSentenceSemantics(sentence: SentenceAnalysis): SemanticAnalysis[] {
  if (!sentence.selectedSemanticIds) {
    return sentence.semantics;
  }
  const selected = new Set(sentence.selectedSemanticIds);
  return sentence.semantics.filter(semantic => selected.has(semantic.semId));
}

export function validateSentenceAnalysis(sentence: SentenceAnalysis): void {
  const syntaxIds = new Set(sentence.syntax.map(syntax => syntax.synId));
  const semanticIds = new Set(sentence.semantics.map(semantic => semantic.semId));
  validateMapping(sentence.synSemMapping, syntaxIds, semanticIds);

  sentence.semantics.forEach(semantic => {
    if (!syntaxIds.has(semantic.syntacticOrigin)) {
      throw new Error(`Semantic ${semantic.semId} has unknown syntax origin ${semantic.syntacticOrigin}.`);
    }
  });

  if (sentence.selectedSemanticIds) {
    sentence.selectedSemanticIds.forEach(semanticId => {
      if (!semanticIds.has(semanticId)) {
        throw new Error(`Sentence selection references unknown semantic ${semanticId}.`);
      }
    });
  }
}

export function validateSequenceAnalysis(document: XlePlusGlueDocument, sequence: SequenceAnalysis): void {
  const syntaxIds = new Set(sequence.syntax.map(syntax => syntax.synId));
  const semanticIds = new Set(sequence.semantics.map(semantic => semantic.semId));
  validateMapping(sequence.synSemMapping, syntaxIds, semanticIds);
  sequence.semantics.forEach(semantic => {
    if (!syntaxIds.has(semantic.syntacticOrigin)) {
      throw new Error(`Semantic ${semantic.semId} has unknown sequence syntax origin ${semantic.syntacticOrigin}.`);
    }
  });
  const knownSentenceIds = new Set(document.sentences.map(sentence => sentence.id));
  sequence.sentenceIds.forEach(sentenceId => {
    if (!knownSentenceIds.has(sentenceId)) {
      throw new Error(`Sequence ${sequence.id} references unknown sentence ${sentenceId}.`);
    }
  });
}

export function validateAnalysisDocument(document: XlePlusGlueDocument): void {
  document.sentences.forEach(validateSentenceAnalysis);
  (document.sequences ?? []).forEach(sequence => validateSequenceAnalysis(document, sequence));
  document.elements.forEach(ref => {
    if (!resolveElement(document, ref)) {
      throw new Error(`Element ${ref.kind} ${ref.id} is not registered in sentences/sequences.`);
    }
  });
  (document.discourseUpdates ?? []).forEach(update => validateDiscourseUpdate(document, update));
}

/** The discourse layer stacks on Sentence/Sequence by id reference rather than
 *  embedding into it, so validation here checks the reference resolves and that
 *  semDiscourseMapping stays internally consistent -- it does not touch synSemMapping. */
export function validateDiscourseUpdate(document: XlePlusGlueDocument, update: DiscourseUpdate): void {
  const element = findElementById(document, update.sourceElementId);
  if (!element) {
    throw new Error(`Discourse update ${update.id} references unknown element ${update.sourceElementId}.`);
  }

  const semanticIds = new Set(element.semantics.map(semantic => semantic.semId));
  const discourseIds = new Set(update.discourse.map(discourse => discourse.id));

  update.discourse.forEach(discourse => {
    if (!semanticIds.has(discourse.semanticOrigin)) {
      throw new Error(`Discourse analysis ${discourse.id} has unknown semantic origin ${discourse.semanticOrigin}.`);
    }
  });

  Object.entries(update.semDiscourseMapping).forEach(([semId, mappedDiscourseIds]) => {
    if (!semanticIds.has(semId)) {
      throw new Error(`Discourse mapping references unknown semantic ${semId}.`);
    }
    mappedDiscourseIds.forEach(discourseId => {
      if (!discourseIds.has(discourseId)) {
        throw new Error(`Discourse mapping references unknown discourse analysis ${discourseId}.`);
      }
    });
  });
}

function validateMapping(
  mapping: SynSemMapping,
  syntaxIds: Set<string>,
  semanticIds: Set<string>,
): void {
  Object.entries(mapping).forEach(([syntaxId, mappedSemanticIds]) => {
    if (!syntaxIds.has(syntaxId)) {
      throw new Error(`Mapping references unknown syntax ${syntaxId}.`);
    }
    mappedSemanticIds.forEach(semanticId => {
      if (!semanticIds.has(semanticId)) {
        throw new Error(`Mapping references unknown semantic ${semanticId}.`);
      }
    });
  });
}
