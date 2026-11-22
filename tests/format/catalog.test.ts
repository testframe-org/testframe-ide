import { describe, expect, test } from 'bun:test';
import {
  HTTP_METHODS,
  NAMED_SOURCE_TYPES,
  SOURCE_TYPES,
  TYPES,
  cardTypeOf,
  defaultSize,
  defaultTimeout,
  hasSources,
  hasSubtypes,
  kindOf,
  languageOf,
  subtypesOf,
  subtypeProblem,
  typeOf
} from '@/lib/format/catalog';
import { catalog } from '@/lib/api/domain';

// Port of the catalog assertions of CardCodecTest.java (the type/subtype table of
// docs/project-format.md, "Source types and subtypes").

describe('catalog', () => {
  test('card type and fence language follow (type, subtype)', () => {
    const expected: Record<string, string> = {
      'openapi/restapi': 'request js',
      'openapi/swagger': 'request json',
      'openapi/graphql': 'request js',
      'mongo/find': 'query json',
      'mongo/aggregation': 'query json',
      'mongo/deleteOne': 'query json',
      'mongo/deleteMany': 'query json',
      'mongo/updateOne': 'query json',
      'mongo/updateMany': 'query json',
      'mongo/insertOne': 'query json',
      'mongo/insertMany': 'query json',
      'sql/oracle': 'sql sql',
      'sql/postgres': 'sql sql',
      'sql/mysql': 'sql sql',
      'sql/sqlserver': 'sql sql',
      'jsonassert/script': 'jsonassert jsonassert',
      'jsonassert/conditional': 'condition jsonassert',
      'kafka/': 'js js',
      'grpc/': 'js js',
      'rawvalue/json': 'json json'
    };
    for (const [key, value] of Object.entries(expected)) {
      const [type, sub] = key.split('/');
      const subtype = sub === '' ? null : sub!;
      expect(`${cardTypeOf(type, subtype)} ${languageOf(type, subtype)}`).toBe(value);
      expect(subtypeProblem(type, subtype)).toBeNull();
    }
    const kinds = TYPES.reduce((n, t) => n + t.kinds.length, 0);
    expect(kinds).toBe(Object.keys(expected).length);
  });

  test('the type list and which types have named sources', () => {
    expect([...SOURCE_TYPES]).toEqual(['openapi', 'mongo', 'sql', 'jsonassert', 'kafka', 'grpc', 'rawvalue']);
    expect([...NAMED_SOURCE_TYPES]).toEqual(['openapi', 'mongo', 'sql', 'kafka', 'grpc']);
    expect(hasSources('rawvalue')).toBe(false);
    expect(hasSources('jsonassert')).toBe(false);
    expect(hasSources('openapi')).toBe(true);
    expect(hasSources('unknown')).toBe(false);
    expect([...HTTP_METHODS]).toEqual(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
  });

  test('a blank type is the rawvalue type (a draft card)', () => {
    expect(typeOf('')?.name).toBe('rawvalue');
    expect(typeOf(null)?.name).toBe('rawvalue');
    expect(typeOf('nope')).toBeUndefined();
    expect(cardTypeOf('', undefined)).toBe('json');
    expect(languageOf('', undefined)).toBe('json');
  });

  test('subtypes only for the types that have them', () => {
    expect(subtypesOf(typeOf('mongo')!)).toEqual([
      'find',
      'aggregation',
      'deleteOne',
      'deleteMany',
      'updateOne',
      'updateMany',
      'insertOne',
      'insertMany'
    ]);
    expect(subtypesOf(typeOf('kafka')!)).toEqual([]);
    expect(hasSubtypes(typeOf('rawvalue')!)).toBe(true);
    expect(hasSubtypes(typeOf('kafka')!)).toBe(false);
    expect(kindOf('mongo', 'find')?.form).toBe('mongo');
    expect(kindOf('mongo', 'nope')).toBeUndefined();
    expect(kindOf('kafka', null)?.cardType).toBe('js');
  });

  test('subtype problems', () => {
    expect(subtypeProblem('nope', null)).toBe('unknown type-source "nope"');
    expect(subtypeProblem('mongo', null)).toBe(
      'required for mongo (find, aggregation, deleteOne, deleteMany, updateOne, updateMany, insertOne, insertMany)'
    );
    expect(subtypeProblem('mongo', 'update')).toBe(
      'unknown subtype "update" of mongo (find, aggregation, deleteOne, deleteMany, updateOne, updateMany, insertOne, insertMany)'
    );
    expect(subtypeProblem('rawvalue', 'find')).toBe('unknown subtype "find" of rawvalue (json)');
    expect(subtypeProblem('kafka', 'x')).toBe('kafka has no subtypes');
    expect(subtypeProblem('kafka', '')).toBeNull();
  });

  test('defaults per card type', () => {
    expect(defaultSize('request')).toEqual({ width: 320, height: 210 });
    expect(defaultSize('query')).toEqual({ width: 320, height: 210 });
    expect(defaultSize('jsonassert')).toEqual({ width: 300, height: 190 });
    expect(defaultSize('json')).toEqual({ width: 290, height: 185 });
    expect(defaultSize('condition')).toEqual({ width: 240, height: 165 });
    expect(defaultTimeout('request')).toBe(5000);
    expect(defaultTimeout('jsonassert')).toBe(2000);
    expect(defaultTimeout('json')).toBe(2000);
    expect(defaultTimeout('condition')).toBe(1000);
  });

  test('the catalog endpoint serves every kind with its defaults and mongo signature', () => {
    const response = catalog();
    expect(response.httpMethods).toEqual([...HTTP_METHODS]);
    expect(response.sourceTypes.map((t) => t.name)).toEqual([...SOURCE_TYPES]);
    const mongo = response.sourceTypes.find((t) => t.name === 'mongo')!;
    const find = mongo.cards.find((c) => c.subtype === 'find')!;
    expect(find.args.map((a) => a.name)).toEqual(['filter', 'projection', 'options']);
    expect(find.args[0]).toMatchObject({ kind: 'object', required: true });
    expect(find.args[2]!.options.map((o) => o.name)).toEqual([
      'sort',
      'limit',
      'skip',
      'maxTimeMS',
      'collation',
      'hint',
      'comment'
    ]);
    expect(mongo.cards.find((c) => c.subtype === 'updateOne')!.args.map((a) => a.name)).toEqual([
      'filter',
      'update',
      'options'
    ]);
    expect(response.sourceTypes.find((t) => t.name === 'rawvalue')!.cards[0]).toMatchObject({
      subtype: 'json',
      cardType: 'json',
      language: 'json',
      form: 'json',
      defaultWidth: 290,
      defaultHeight: 185,
      defaultTimeout: 2000,
      args: []
    });
  });
});
