import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NO_ERRORS_SCHEMA } from '@angular/core';

import { SemVisComponent } from './sem-vis.component';

describe('SemVisComponent', () => {
  let component: SemVisComponent;
  let fixture: ComponentFixture<SemVisComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [SemVisComponent],
      imports: [CommonModule, FormsModule],
      schemas: [NO_ERRORS_SCHEMA]
    });
    fixture = TestBed.createComponent(SemVisComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('groups disjoint discriminants together and moves overlaps into later buckets', () => {
    component.setDiscriminants([
      { id: 'a', type: 'scope', identifier: 'A', associatedSolutions: ['1'] },
      { id: 'b', type: 'scope', identifier: 'B', associatedSolutions: ['2'] },
      { id: 'c', type: 'scope', identifier: 'C', associatedSolutions: ['1', '2'] },
    ]);

    const itemLabels = component.scope_rows
      .filter(row => row.kind === 'item')
      .map(row => row.kind === 'item' ? row.disc.identifier : '');
    expect(itemLabels).toEqual(['A', 'B', 'C']);

    const separators = component.scope_rows.filter(row => row.kind === 'separator');
    expect(separators.length).toBe(1);
  });

  it('keeps fully disjoint runs together', () => {
    component.setDiscriminants([
      { id: 'a', type: 'scope', identifier: 'A', associatedSolutions: ['1'] },
      { id: 'b', type: 'scope', identifier: 'B', associatedSolutions: ['2'] },
    ]);

    const separators = component.scope_rows.filter(row => row.kind === 'separator');
    expect(separators.length).toBe(0);
  });

  it('lists surface-order scopings first within a bucket, without moving any between buckets', () => {
    component.setDiscriminants([
      { id: 'inv', type: 'scope', identifier: 'every > the', associatedSolutions: ['1'],
        surfaceKey: [9, 1], surfaceAligned: false },
      { id: 'unk', type: 'scope', identifier: 'unknown', associatedSolutions: ['3'] },
      { id: 'late', type: 'scope', identifier: 'a > every', associatedSolutions: ['4'],
        surfaceKey: [5, 9], surfaceAligned: true },
      { id: 'surf', type: 'scope', identifier: 'the > every', associatedSolutions: ['2'],
        surfaceKey: [1, 9], surfaceAligned: true },
      { id: 'both', type: 'scope', identifier: 'overlap', associatedSolutions: ['1', '2'] },
    ]);

    const labels = component.scope_rows
      .map(row => row.kind === 'item' ? row.disc.identifier : '|');
    expect(labels).toEqual(['the > every', 'a > every', 'unknown', 'every > the', '|', 'overlap']);
  });
});
