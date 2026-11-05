import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { DataService, jsonRequestBody } from './data.service';
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
  describe('loading a regression session', () => {
    const base = 'http://localhost:8082/regression_session/lilt%20bank';

    it('reads the skeleton, then each document in turn, and puts them in analysis.documents', () => {
      let loaded: any;
      service.loadRegressionSession('lilt bank').subscribe(session => loaded = session);
      http.expectOne(`${base}/skeleton`).flush({
        session: { schemaVersion: 6, analysis: { system: { x: 1 }, documents: {} } }, documentIds: ['n0', 'n/1'],
      });
      expect(loaded).toBeUndefined();
      const first = http.expectOne(`${base}/document/n0`);
      http.expectNone(`${base}/document/n%2F1`);
      first.flush({ id: 'd0' });
      expect(loaded).toBeUndefined();
      http.expectOne(`${base}/document/n%2F1`).flush({ id: 'd1' });
      expect(loaded.analysis.system).toEqual({ x: 1 });
      expect(loaded.analysis.documents).toEqual({ n0: { id: 'd0' }, 'n/1': { id: 'd1' } });
    });

    it('takes a session without documents to read as it comes', () => {
      let loaded: any;
      service.loadRegressionSession('lilt bank').subscribe(session => loaded = session);
      http.expectOne(`${base}/skeleton`).flush({ session: {}, documentIds: [] });
      expect(loaded).toEqual({});
    });

    it('fails the load when a document cannot be read', () => {
      let failed = false;
      service.loadRegressionSession('lilt bank').subscribe({ error: () => failed = true });
      http.expectOne(`${base}/skeleton`).flush({ session: { analysis: {} }, documentIds: ['n0'] });
      http.expectOne(`${base}/document/n0`).flush('gone', { status: 404, statusText: 'Not Found' });
      expect(failed).toBeTrue();
    });
  });
});

describe('jsonRequestBody', () => {
  it('sends a small body as JSON text', done => {
    jsonRequestBody({ a: 1 }).subscribe(({ body, headers }) => {
      expect(body).toBe('{"a":1}');
      expect(headers['Content-Encoding']).toBeUndefined();
      done();
    });
  });

  it('gzips a large body, which decompresses to the same JSON', done => {
    const json = JSON.stringify({ readings: Array(20000).fill('([x1],[dog(x1)])') });
    jsonRequestBody(json).subscribe(async ({ body, headers }) => {
      expect(headers['Content-Encoding']).toBe('gzip');
      expect(headers['Content-Type']).toBe('application/json');
      const blob = body as Blob;
      expect(blob.size).toBeLessThan(json.length / 20);
      const text = await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text();
      expect(text).toBe(json);
      done();
    });
  });

});
