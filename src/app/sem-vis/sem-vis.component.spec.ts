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
});
