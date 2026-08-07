import {
  SemanticAnalysis,
  SentenceAnalysis,
  SequenceAnalysis,
  SynSemMapping,
  XlePlusGlueDocument,
} from './models/models';

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

export function validateSequenceAnalysis(sequence: SequenceAnalysis): void {
  const syntaxIds = new Set(sequence.syntax.map(syntax => syntax.synId));
  const semanticIds = new Set(sequence.semantics.map(semantic => semantic.semId));
  validateMapping(sequence.synSemMapping, syntaxIds, semanticIds);
  sequence.semantics.forEach(semantic => {
    if (!syntaxIds.has(semantic.syntacticOrigin)) {
      throw new Error(`Semantic ${semantic.semId} has unknown sequence syntax origin ${semantic.syntacticOrigin}.`);
    }
  });
  sequence.sentences.forEach(validateSentenceAnalysis);
}

export function validateAnalysisDocument(document: XlePlusGlueDocument): void {
  document.sentences.forEach(validateSentenceAnalysis);
  document.elements.forEach(element => {
    if ('sentences' in element) {
      validateSequenceAnalysis(element);
    } else {
      validateSentenceAnalysis(element);
    }
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
