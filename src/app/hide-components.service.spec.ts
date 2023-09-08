import { TestBed } from '@angular/core/testing';

import { HideComponentsService } from './hide-components.service';

describe('HideComponentsService', () => {
  let service: HideComponentsService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(HideComponentsService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
