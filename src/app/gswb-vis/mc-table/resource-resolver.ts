import { LigerStructure, LigerStructureConstraint } from '../../models/models';

const QUOTED_ATOM = /'([^']*)'/;

function normalize(value: unknown): string {
  return value == null ? '' : String(value).replace(/^[a-zA-Z]+/, '');
}

function sourceOf(c: LigerStructureConstraint): string {
  return String((c as any).sourceNode ?? c.fsNode ?? '');
}

function targetOf(c: LigerStructureConstraint): string {
  return String((c as any).targetNode ?? c.fsValue ?? '');
}

function firstValue(all: LigerStructureConstraint[], fNode: string, relation: string): string | null {
  const match = all.find(c => c.relationLabel === relation && sourceOf(c) === fNode);
  return match ? targetOf(match) : null;
}

function integerValue(value: string | null): number | null {
  if (value == null) return null;
  const digits = value.replace(/[^0-9-]/g, '');
  return digits === '' ? null : parseInt(digits, 10);
}

function predLemma(all: LigerStructureConstraint[], fNode: string): string | null {
  const pred = firstValue(all, fNode, 'PRED');
  if (pred == null) return null;
  const match = QUOTED_ATOM.exec(pred);
  return match ? match[1] : null;
}

function surfaceSpanText(structure: LigerStructure, all: LigerStructureConstraint[], fNode: string): string | null {
  const start = integerValue(firstValue(all, fNode, 'start'));
  const end = integerValue(firstValue(all, fNode, 'end'));
  if (start == null || end == null || !structure.text) return null;
  if (start < 0 || end > structure.text.length || start >= end) return null;
  return structure.text.substring(start, end).trim();
}

export function resolveAllGlueNodes(structure: LigerStructure | null | undefined): Map<string, string> {
  const result = new Map<string, string>();
  if (!structure) return result;

  const all = [...(structure.constraints ?? []), ...(structure.annotations ?? [])];

  const projectionTargetById = new Map<string, string>();
  for (const c of all) {
    if (c.relationLabel === 's::') {
      const id = normalize(targetOf(c));
      if (!projectionTargetById.has(id)) {
        projectionTargetById.set(id, sourceOf(c));
      }
    }
  }

  for (const [id, fNode] of projectionTargetById) {
    const span = surfaceSpanText(structure, all, fNode);
    if (span) {
      result.set(id, span);
      continue;
    }
    const lemma = predLemma(all, fNode);
    if (lemma) {
      result.set(id, lemma);
    }
  }

  for (const c of all) {
    if (c.relationLabel !== 'EV') continue;
    const id = normalize(targetOf(c));
    if (result.has(id)) continue;
    const ownerFNode = projectionTargetById.get(normalize(sourceOf(c)));
    if (!ownerFNode) continue;
    const lemma = predLemma(all, ownerFNode);
    if (lemma) {
      result.set(id, lemma);
    }
  }

  return result;
}
