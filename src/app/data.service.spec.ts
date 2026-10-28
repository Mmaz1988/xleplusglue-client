import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { DataService } from './data.service';
import { SyntaxSourceService } from './syntax-source/syntax-source.service';

describe('DataService', () => {
  let service: DataService;
  let http: HttpTestingController;
  let syntaxSource: SyntaxSourceService;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    service = TestBed.inject(DataService);
    http = TestBed.inject(HttpTestingController);
    syntaxSource = TestBed.inject(SyntaxSourceService);
  });

  afterEach(() => http.verify());

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('sends XLE parse requests as before, without a parser', () => {
    service.ligerAnnotate({ sentence: 'A dog barked.', ruleString: 'R' }).subscribe();
    service.ligerSequence({ sentences: ['A dog barked.'], ruleString: 'R' }).subscribe();
    service.ligerBatchAnnotate({ sentences: { '1': 'A dog barked.' }, ruleString: 'R' }).subscribe();

    for (const path of ['apply_rules_xle', 'apply_rules_xle_sequence', 'apply_rules_to_batch']) {
      const request = http.expectOne(`http://localhost:8080/${path}`);
      expect('parser' in request.request.body).withContext(path).toBeFalse();
      request.flush({});
    }
  });

  it('names the session\'s UD model on all three parse requests', () => {
    syntaxSource.select({ kind: 'ud', model: 'en' });
    const body = { sentence: 'A dog barked.', ruleString: 'R' };

    service.ligerAnnotate(body).subscribe();
    service.ligerSequence({ sentences: ['A dog barked.'], ruleString: 'R' }).subscribe();
    service.ligerBatchAnnotate({ sentences: { '1': 'A dog barked.' }, ruleString: 'R' }).subscribe();

    for (const path of ['apply_rules_xle', 'apply_rules_xle_sequence', 'apply_rules_to_batch']) {
      const request = http.expectOne(`http://localhost:8080/${path}`);
      expect(request.request.body.parser).withContext(path).toEqual({ kind: 'ud', model: 'en' });
      request.flush({});
    }
    expect('parser' in body).toBeFalse();
  });

  it('refuses multistage parsing in a UD session, without calling LiGER', () => {
    syntaxSource.select({ kind: 'ud', model: 'en' });
    const errors: string[] = [];

    service.ligerMulti({ sentence: 'A dog barked.' }).subscribe({ error: error => errors.push(error.message) });
    service.ligerBatchMultistage({ sentences: {} }).subscribe({ error: error => errors.push(error.message) });

    expect(errors.length).toBe(2);
    expect(errors[0]).toContain('needs XLE');
    http.expectNone('http://localhost:8080/parse_xle');
    http.expectNone('http://localhost:8080/multistage_to_batch');
  });

  it('lists the UD models through LiGER', () => {
    let models: any;
    service.listUdModels().subscribe(list => models = list);

    http.expectOne('http://localhost:8080/list_ud_models').flush({ models: [{ id: 'en' }], error: null });

    expect(models.models[0].id).toBe('en');
  });
});
