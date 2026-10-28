import { SyntaxSource, XLE_SOURCE } from '../models/models';
import { SyntaxSourceService, sameSource, udGrammarPath } from './syntax-source.service';

describe('SyntaxSourceService', () => {
  let service: SyntaxSourceService;
  let switched: SyntaxSource[];

  beforeEach(() => {
    service = new SyntaxSourceService();
    switched = [];
    service.switched$.subscribe(source => switched.push(source));
  });

  it('starts with XLE and names no parser in requests', () => {
    expect(service.source).toEqual(XLE_SOURCE);
    expect(service.parserSelection()).toBeUndefined();
    expect(service.recorded()).toBeUndefined();
  });

  it('switching kind is a switch; changing the model within UD is not', () => {
    expect(service.select({ kind: 'ud', model: 'en' })).toBeNull();
    expect(service.select({ kind: 'ud', model: 'de' })).toBeNull();
    expect(service.select(XLE_SOURCE)).toBeNull();

    expect(switched).toEqual([{ kind: 'ud', model: 'en' }, XLE_SOURCE]);
  });

  it('names the UD model in requests and in what a session records', () => {
    service.select({ kind: 'ud', model: 'en' });

    expect(service.parserSelection()).toEqual({ kind: 'ud', model: 'en' });
    expect(service.recorded()).toEqual({ kind: 'ud', model: 'en' });
  });

  it('refuses a switch a view cannot take now, and says why', () => {
    let busy = true;
    const remove = service.addSwitchGuard(() => busy ? 'run in progress' : null);

    expect(service.select({ kind: 'ud', model: 'en' })).toBe('run in progress');
    expect(service.source).toEqual(XLE_SOURCE);

    busy = false;
    expect(service.select({ kind: 'ud', model: 'en' })).toBeNull();
    busy = true;
    // A model change within UD resets nothing, so nothing guards it.
    expect(service.select({ kind: 'ud', model: 'de' })).toBeNull();
    remove();
    expect(service.select(XLE_SOURCE)).toBeNull();
    expect(switched.length).toBe(2);
  });

  it('a restore sets the parser without a switch; anything but a UD model is XLE', () => {
    const kinds: string[] = [];
    service.kind$.subscribe(kind => kinds.push(kind));

    service.restore({ kind: 'ud', model: 'en' });
    expect(service.source).toEqual({ kind: 'ud', model: 'en' });
    service.restore(undefined);
    expect(service.source).toEqual(XLE_SOURCE);
    service.restore({ kind: 'ud', model: '' } as any);
    expect(service.source).toEqual(XLE_SOURCE);

    expect(switched).toEqual([]);
    expect(kinds).toEqual(['xle', 'ud', 'xle']);
  });

  it('offers UD only with an installed model', () => {
    expect(service.udAvailable).toBeFalse();
    service.setUdModels([{ id: 'en', language: 'English', package: 'combined' }]);
    expect(service.udAvailable).toBeTrue();
    service.setUdModels(null, 'not reachable');
    expect(service.udAvailable).toBeFalse();
    expect(service.udError).toBe('not reachable');
  });

  it('compares sources and finds a model\'s config folder', () => {
    expect(sameSource(undefined, XLE_SOURCE)).toBeTrue();
    expect(sameSource({ kind: 'ud', model: 'en' }, { kind: 'ud', model: 'de' })).toBeFalse();
    expect(udGrammarPath('en')).toBe('./grammars/ud/en');
  });
});
