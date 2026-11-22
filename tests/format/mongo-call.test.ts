import { describe, expect, test } from 'bun:test';
import { SUBTYPES, collectionProblem, hint, isWrite, problem, problems, signatureOf } from '@/lib/format/mongo-call';

// Port of the validation half of server/src/test/java/com/testframe/server/format/MongoCallTest.java.
// The IDE only validates a mongo body; running the call is the plugin's job.

const SUBTYPE_LIST = SUBTYPES.join(', ');

describe('mongo call arguments', () => {
  test('the signatures of every subtype', () => {
    expect(SUBTYPES).toEqual([
      'find',
      'aggregation',
      'deleteOne',
      'deleteMany',
      'updateOne',
      'updateMany',
      'insertOne',
      'insertMany'
    ]);
    expect(signatureOf('find').map((a) => a.name)).toEqual(['filter', 'projection', 'options']);
    expect(signatureOf('aggregation').map((a) => a.name)).toEqual(['pipeline', 'options']);
    expect(signatureOf('deleteOne').map((a) => a.name)).toEqual(['filter', 'options']);
    expect(signatureOf('updateMany').map((a) => a.name)).toEqual(['filter', 'update', 'options']);
    expect(signatureOf('insertOne').map((a) => a.name)).toEqual(['document', 'options']);
    expect(signatureOf('insertMany').map((a) => a.name)).toEqual(['documents', 'options']);
    expect(signatureOf('nope')).toEqual([]);
    expect(signatureOf(null)).toEqual([]);
    expect(hint('find', signatureOf('find'))).toBe(
      'the body is one JSON array of arguments, find: [filter, projection?, options?]'
    );
    expect(isWrite('find')).toBe(false);
    expect(isWrite('aggregation')).toBe(false);
    for (const sub of ['deleteOne', 'deleteMany', 'updateOne', 'updateMany', 'insertOne', 'insertMany']) {
      expect(isWrite(sub)).toBe(true);
    }
  });

  test('find takes filter, projection and options', () => {
    expect(
      problem(
        'find',
        `[{"ativo": true, "_id": {"$oid": "6b022609da8071eb915cbe8a"}}, {"nome": 1},
           {"sort": {"preco": -1}, "limit": 5, "skip": 2, "maxTimeMS": 300, "collation": {"locale": "pt"},
            "hint": "nome_1", "comment": "c"}]`
      )
    ).toBeNull();
    expect(problem('find', '[{}]')).toBeNull();
    expect(problem('find', '[{}, {"nome": 1}]')).toBeNull();
    expect(problem('find', '[]')).toBe(
      `arg 1 (filter): required, the body is one JSON array of arguments, find: [filter, projection?, options?]`
    );
  });

  test('arity, argument types and unknown option keys', () => {
    expect(problem('find', '[{}, {}, {}, {}]')).toBe(
      'find takes at most 3 arguments: the body is one JSON array of arguments, find: [filter, projection?, options?]'
    );
    expect(problem('find', '[[]]')).toBe('arg 1 (filter): must be an object');
    expect(problem('find', '[{}, {}, {"upsert": true}]')).toBe(
      'arg 3 (options): unknown key "upsert" (find accepts sort, limit, skip, maxTimeMS, collation, hint, comment)'
    );
    expect(problem('find', '[{}, null, {"limit": -1}]')).toBe('arg 3 (options): limit must be a non-negative integer');
    expect(problem('aggregation', '[[{}], {"batchSize": 0}]')).toBe(
      'arg 2 (options): batchSize must be a positive integer'
    );
    expect(problem('updateOne', '[{"a": 1}, {"$set": {"b": 2}}, {"arrayFilters": [1]}]')).toBe(
      'arg 3 (options): arrayFilters must be an array of objects'
    );
    expect(problem('find', '{"filter": {}}')!.startsWith('the body is one JSON array of arguments, find:')).toBe(true);
    expect(problem('find', 'db.products.find({})')!.startsWith('invalid JSON: ')).toBe(true);
    expect(problem('drop', '[]')).toBe(`unknown mongo subtype "drop" (${SUBTYPE_LIST})`);
    expect(problems('find', '[1, 2]')).toEqual([
      'arg 1 (filter): must be an object',
      'arg 2 (projection): must be an object'
    ]);
  });

  test('null skips an argument (a binding stands for any value)', () => {
    expect(problem('find', '[{}, null, {"limit": 5}]')).toBeNull();
    expect(problem('find', '[{"ativo": true}, null, null]')).toBeNull();
    // the code rule is lenient: a required argument may be a binding, so null passes here and
    // the runner checks the resolved arguments again (docs/project-format.md, "Mongo cards")
    expect(problem('updateOne', '[{"a": 1}, null]')).toBeNull();
    expect(problem('insertOne', '[null]')).toBeNull();
    // an options object with a null value is accepted for the same reason
    expect(problem('find', '[{}, null, {"limit": null}]')).toBeNull();
  });

  test('a draft (empty body) has no problem yet', () => {
    expect(problem('find', '')).toBeNull();
    expect(problem('find', '   ')).toBeNull();
    expect(problem('find', null)).toBeNull();
    expect(problem('aggregation', undefined)).toBeNull();
    expect(problem(null, '[{}]]')).toBeNull();
    expect(problems('find', '')).toEqual([]);
  });

  test('option value types', () => {
    expect(problem('find', '[{}, null, {"sort": 1}]')).toBe('arg 3 (options): sort must be an object');
    expect(problem('find', '[{}, null, {"limit": 1.5}]')).toBe('arg 3 (options): limit must be a non-negative integer');
    expect(problem('aggregation', '[[{}], {"allowDiskUse": "yes"}]')).toBe(
      'arg 2 (options): allowDiskUse must be true or false'
    );
    expect(problem('find', '[{}, null, {"comment": 1}]')).toBe('arg 3 (options): comment must be a string');
    expect(problem('find', '[{}, null, {"hint": 1}]')).toBe(
      'arg 3 (options): hint must be an index name (string) or an index key object'
    );
    expect(problem('find', '[{}, null, {"hint": {"nome": 1}}]')).toBeNull();
    expect(problem('find')).toBeNull();
  });

  test('collation follows the driver keys', () => {
    expect(problem('find', '[{}, null, {"collation": {"locale": "pt", "strength": 2}}]')).toBeNull();
    expect(problem('find', '[{}, null, {"collation": {"strength": 2}}]')).toBe(
      'arg 3 (options): collation needs a locale, e.g. {"locale": "pt"}'
    );
    expect(problem('find', '[{}, null, {"collation": {"locale": "pt", "nope": 1}}]')).toContain(
      'unknown collation key "nope"'
    );
    expect(problem('find', '[{}, null, {"collation": {"locale": "pt", "strength": 9}}]')).toBe(
      'arg 3 (options): invalid collation: strength must be 1, 2, 3, 4 or 5'
    );
    expect(problem('find', '[{}, null, {"collation": {"locale": "pt", "caseFirst": "sideways"}}]')).toBe(
      'arg 3 (options): invalid collation: caseFirst must be one of upper, lower, off'
    );
    expect(problem('find', '[{}, null, {"collation": {"locale": "pt", "backwards": "yes"}}]')).toBe(
      'arg 3 (options): invalid collation: backwards must be true or false'
    );
  });

  test('aggregation takes a pipeline and rejects write stages', () => {
    expect(
      problem(
        'aggregation',
        '[[{"$match": {"ativo": true}}, {"$group": {"_id": "$categoria", "n": {"$sum": 1}}}], {"allowDiskUse": true, "let": {"x": 1}}]'
      )
    ).toBeNull();
    expect(problem('aggregation', '[[]]')).toBe('arg 1 (pipeline): needs at least one stage');
    expect(problem('aggregation', '[[{"$out": "x"}]]')).toBe(
      'arg 1 (pipeline): stage "$out" is not allowed in mongo cards'
    );
    expect(problem('aggregation', '[[{"$facet": {"a": [{"$merge": "y"}]}}]]')).toBe(
      'arg 1 (pipeline): stage "$merge" is not allowed in mongo cards'
    );
    expect(problem('aggregation', '[{"ativo": true}]')).toBe('arg 1 (pipeline): must be an array of stages');
    expect(problem('aggregation', '[[1]]')).toBe('arg 1 (pipeline): stage 1 must be an object');
    expect(problem('find', '[{"$merge": "x"}]')).toBe(
      'arg 1 (filter): stage "$merge" is not allowed in mongo cards'
    );
  });

  test('writes need a non-empty filter and operator updates', () => {
    expect(problem('deleteMany', '[{"tmp": true}, {"comment": "c"}]')).toBeNull();
    expect(problem('deleteMany', '[{}]')).toBe(
      'arg 1 (filter): deleteMany needs a non-empty filter (an empty filter would delete the whole collection)'
    );
    expect(problem('deleteOne', '[{}]')).toBe(
      'arg 1 (filter): deleteOne needs a non-empty filter (an empty filter would delete the whole collection)'
    );
    expect(problem('updateOne', '[{}, {"$set": {"a": 1}}]')).toBe(
      'arg 1 (filter): updateOne needs a non-empty filter (an empty filter would update the whole collection)'
    );
    expect(problem('updateMany', '[{"a": 1}, {"nome": "x"}]')).toBe(
      'arg 2 (update): takes only $-operators ("nome" would replace the document), e.g. {"$set": {"nome": ...}}'
    );
    expect(problem('updateOne', '[{"a": 1}]')).toBe(
      'arg 2 (update): required, the body is one JSON array of arguments, updateOne: [filter, update, options?]'
    );
    expect(problem('updateOne', '[{"a": 1}, {}]')).toBe(
      'arg 2 (update): needs at least one $-operator, e.g. {"$set": {...}}'
    );
    expect(problem('updateMany', '[{"a": 1}, [{"$set": {"b": "$a"}}], {"upsert": false}]')).toBeNull();
    expect(problem('updateOne', '[{"k": "a"}, {"$set": {"v": 1}}, {"upsert": true}]')).toBeNull();
    expect(problem('find', '[{}, null, {"upsert": true}]')).toContain('unknown key "upsert"');
  });

  test('inserts take data documents', () => {
    expect(problem('insertOne', '[{"k": "a"}, {"bypassDocumentValidation": true}]')).toBeNull();
    expect(problem('insertMany', '[[{"k": 1}, {"k": 2}], {"ordered": false}]')).toBeNull();
    expect(problem('insertOne', '[{}]')).toBe('arg 1 (document): must be a non-empty object');
    expect(problem('insertOne', '[{"$set": {"a": 1}}]')).toBe(
      'arg 1 (document): cannot have the operator key "$set" (documents hold data)'
    );
    expect(problem('insertMany', '[[]]')).toBe('arg 1 (documents): must be an array of at least one document');
    expect(problem('insertMany', '[[{"a": 1}, {}]]')).toBe('arg 1 (documents): document 2 must be a non-empty object');
    expect(problem('insertMany', '[[{"a": 1}], {"upsert": true}]')).toBe(
      'arg 2 (options): unknown key "upsert" (insertMany accepts ordered, comment, bypassDocumentValidation)'
    );
  });

  test('bindings stand for any value in the code rule', () => {
    expect(problem('find', '[{"nome": "{{first.nome}}"}, null, {"limit": {{n}}}]')).toBeNull();
    expect(problem('deleteOne', '[{"_id": "{{created.id}}"}]')).toBeNull();
    expect(problem('insertMany', '["{{docs}}"]')).toBeNull();
    expect(problem('aggregation', '[[{"$match": {{filter}} }]]')).toBeNull();
  });

  test('extended JSON is understood', () => {
    expect(problem('find', '[{"_id": {"$oid": "6b022609da8071eb915cbe8a"}}]')).toBeNull();
    expect(problem('find', '[{"when": {"$date": "2026-11-22T00:00:00Z"}}]')).toBeNull();
    expect(problem('find', '[{"big": {"$numberLong": "10"}}]')).toBeNull();
  });

  test('duplicate keys inside one object are rejected', () => {
    expect(problem('find', '[{"a": 1, "a": 2}]')).toContain('duplicate field');
  });

  test('collection names', () => {
    expect(collectionProblem('products')).toBeNull();
    expect(collectionProblem('order.items')).toBeNull();
    expect(collectionProblem('')).toBe('required on mongo cards (the collection the call works on)');
    expect(collectionProblem(null)).toBe('required on mongo cards (the collection the call works on)');
    expect(collectionProblem('a$b')).toBe('"a$b" is not a collection name (no $, no spaces around, no null character)');
    expect(collectionProblem(' a ')).toBe('" a " is not a collection name (no $, no spaces around, no null character)');
    expect(collectionProblem('a\u0000b')).toContain('is not a collection name');
    expect(collectionProblem('system.users')).toBe('system collections cannot be used');
  });
});
