import {
  AnaphoraMappingModel,
  DiscourseAnalysis,
  DiscourseUpdate,
  LigerStructure,
  SemDiscourseMapping,
} from '../models/models';

/** One post-processing rule branch to generate PCDRS readings from. */
export interface PcdrsRuleBranch {
  /** The reading's semantics, as GSWB /generate_pcdrs takes it. */
  semantic: string;
  /** The semId of the reading, recorded as each PCDRS reading's `semanticOrigin`. */
  semanticOrigin: string;
  /** The tier-B structure the rules produced, or the tier-A union without rules. */
  structure: LigerStructure;
  /** GSWB derives every PCDRS id from it, so it is the caller's id scheme. */
  parentSolutionId: string;
  /** 1-based, recorded as DiscourseAnalysis.ruleBranch. */
  ruleBranchIndex: number;
  /** Whether the structure comes from the post-processing rules: without them GSWB gives
   *  its default reading (every p-box in situ, every pronoun unbound) instead of the
   *  rules' proposals. */
  rulesApplied: boolean;
}

/** One PCDRS reading together with the reading and rule branch it came from -- the output
 *  of post-processing, before any reasoning checks are built on top. The tier-A union and
 *  the tier-B branch stay inside the pipeline: they are consumed to produce this mapping
 *  and then dropped, since no consumer persists them and holding them would keep the whole
 *  cross product in memory. */
export interface MappingWithStructure {
  /** GSWB's PCDRS solution: `.id`, `.semantic`, `.graph`, `.anaphoraRelations`. */
  mapping: any;
  /** 1-based, matching the parentSolutionId sent to GSWB. */
  ruleBranchIndex: number;
  /** The semId of the reading the mapping enriches. */
  semanticOrigin: string;
}

/** A PCDRS reading to record: a mapping and, for a mapping without text, its reading's. */
export interface PcdrsReading extends MappingWithStructure {
  semString?: string;
}

/** Two rule branches can yield the SAME anaphora mapping over the same DRS: a branching rule
 *  forks one branch per solution, and branches that differ only in facts GSWB does not read
 *  give the same mapping. The key is what makes two branches the same discourse analysis --
 *  the binding it asserts, over the DRS it asserts it about. The rule branch is deliberately
 *  not part of it: being reached via a different branch carries no meaning here. Dropped
 *  before the collapse/TPTP batch and Vampire, so a duplicate costs nothing further. */
export function distinctPcdrsMappings<T extends { mapping: any }>(mappings: T[]): T[] {
  const seen = new Set<string>();
  return mappings.filter(({ mapping }) => {
    const relations = (mapping.anaphoraRelations ?? [])
      .map((relation: any) => `${relation?.pronounReferentId}>${relation?.antecedent}@${relation?.stateLabel ?? ''}`)
      .sort()
      .join('|');
    const key = `${relations}::${mapping.semantic ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The stored discourse analyses of PCDRS readings, in order, each id once, and the
 *  semantics -> pragmatics mapping over them. One procedure for analysis, chat and
 *  regression, so their documents are comparable. */
export function discourseAnalysesOf(readings: PcdrsReading[]): {
  discourse: DiscourseAnalysis[];
  semDiscourseMapping: SemDiscourseMapping;
} {
  const discourse: DiscourseAnalysis[] = [];
  const semDiscourseMapping: SemDiscourseMapping = {};
  readings.forEach(({ mapping, ruleBranchIndex, semanticOrigin, semString }) => {
    const id = mapping?.id ?? `${semanticOrigin}-pcdrs-${ruleBranchIndex}`;
    if (discourse.some(entry => entry.id === id)) return;
    semDiscourseMapping[semanticOrigin] = [...(semDiscourseMapping[semanticOrigin] ?? []), id];
    const relations = mapping?.anaphoraRelations ?? [];
    discourse.push({
      id,
      semanticOrigin,
      drsString: mapping?.semantic ?? semString ?? '',
      drsGraph: mapping?.graph,
      ruleBranch: ruleBranchIndex,
      // GSWB renders a reading to SVG (`solution`) only when asked to.
      ...(mapping?.solution ? { svg: mapping.solution } : {}),
      anaphoraMapping: { relations } as AnaphoraMappingModel,
      collapsed: relations.length > 0,
      ...(mapping?.pragmaticProfile ? { pragmaticProfile: mapping.pragmaticProfile } : {}),
    });
  });
  return { discourse, semDiscourseMapping };
}

/** The DiscourseUpdate of an element's PCDRS readings. */
export function discourseUpdateOf(
  source: { id: string; kind: 'sentence' | 'sequence' },
  readings: PcdrsReading[],
  ruleString?: string,
): DiscourseUpdate {
  return {
    id: `du-${source.id}`,
    sourceElementId: source.id,
    sourceElementKind: source.kind,
    ...(ruleString !== undefined ? { ruleString } : {}),
    ...discourseAnalysesOf(readings),
  };
}
