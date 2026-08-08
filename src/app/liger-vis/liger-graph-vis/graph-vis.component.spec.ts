import { GraphVisComponent } from './graph-vis.component';

describe('GraphVisComponent', () => {
  it('keeps parallel same-direction edges distinct when normalizing ids', () => {
    const component = new GraphVisComponent({ detectChanges: () => {} } as any);
    const normalized = (component as any).normalizeGraphElements([
      { data: { id: 'edge-1', source: 'a', target: 'b', label: 'A' } },
      { data: { id: 'edge-1', source: 'a', target: 'b', label: 'B' } },
      { data: { id: 'edge-2', source: 'b', target: 'a', label: 'A' } },
    ]);

    expect(normalized.map((element: any) => element.data.id)).toEqual([
      'edge-1',
      'edge-1__2',
      'edge-2',
    ]);
  });

  it('generates fallback ids for elements without ids', () => {
    const component = new GraphVisComponent({ detectChanges: () => {} } as any);
    const normalized = (component as any).normalizeGraphElements([
      { data: { source: 'a', target: 'b', label: 'A' } },
      { data: { source: 'a', target: 'b', label: 'A' } },
    ]);

    expect(normalized[0].data.id).toContain('edge:a:A:b:0');
    expect(normalized[1].data.id).toContain('edge:a:A:b:1');
  });

  it('classifies canonical f and d structure node types', () => {
    const component = new GraphVisComponent({ detectChanges: () => {} } as any);

    expect((component as any).structureType({ data: { node_type: 'input' } })).toBe('f');
    expect((component as any).structureType({ data: { node_type: 'dnode' } })).toBe('d');
    expect((component as any).structureType({ data: { node_type: 'state' } })).toBe('d');
  });

  it('only exposes categories present in the graph', () => {
    const component = new GraphVisComponent({ detectChanges: () => {} } as any);

    (component as any).updateAvailableStructureFilters([
      { data: { id: 'c1', node_type: 'cnode' } },
      { data: { id: 'a1', node_type: 'annotation' } },
    ]);

    expect(component.availableStructureFilters.map(filter => filter.key)).toEqual(['c', 'annotation']);
  });

  it('filters hidden structure nodes and their connected edges', () => {
    const component = new GraphVisComponent({ detectChanges: () => {} } as any);
    (component as any).structureVisibility.f = false;

    const visible = (component as any).visibleGraphElements([
      { data: { id: 'f1', node_type: 'input' } },
      { data: { id: 'd1', node_type: 'state' } },
      { data: { id: 'edge-1', source: 'f1', target: 'd1' } },
    ]);

    expect(visible.map((element: any) => element.data.id)).toEqual(['d1']);
  });
});
