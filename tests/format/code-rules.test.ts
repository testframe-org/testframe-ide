import { describe, expect, test } from 'bun:test';
import { formatted, problem, problems } from '@/lib/format/code-rules';
import { validate } from '@/lib/api/domain';

// Port of server/src/test/java/com/testframe/server/format/CodeRulesTest.java

describe('code rules', () => {
  test('mongo bodies follow the card subtype', () => {
    const find = '[{"ativo": true}, null, {"limit": 5}]';
    const aggregation = '[[{"$match": {"ativo": true}}]]';
    expect(problem('mongo', 'find', '[{"ativo": true}, {}, {"limit": 5}]')).toBeNull();
    expect(problem('mongo', 'aggregation', aggregation)).toBeNull();
    expect(problem('mongo', 'find', '')).toBeNull();
    expect(problem('mongo', 'aggregation', null)).toBeNull();
    expect(problem('mongo', 'find', aggregation)).toBe('arg 1 (filter): must be an object');
    expect(problem('mongo', 'aggregation', '[{"ativo": true}]')).toBe('arg 1 (pipeline): must be an array of stages');
    expect(problem('mongo', 'aggregation', find)!.startsWith('aggregation takes at most 2 arguments')).toBe(true);
    expect(problems('mongo', 'find', '[{}, [], {"foo": 1}]')).toEqual([
      'arg 2 (projection): must be an object',
      'arg 3 (options): unknown key "foo" (find accepts sort, limit, skip, maxTimeMS, collation, hint, comment)'
    ]);
    expect(formatted('mongo', '[ {"ativo" :true} ]')).toBe('[\n  { "ativo": true }\n]');
    expect(formatted('rawvalue', '{}')).toBeNull();
    expect(formatted('mongo', 'not an array')).toBeNull();
  });

  test('mongo without a subtype has no rule yet', () => {
    // the missing subtype itself is reported by the card validation
    expect(problem('mongo', null, 'db.x.find()')).toBeNull();
    expect(problem('mongo', 'aggregation', '[[{"$out": "y"}]]')).toBe(
      'arg 1 (pipeline): stage "$out" is not allowed in mongo cards'
    );
  });

  test('oracle accepts one SELECT only', () => {
    expect(problem('sql', 'oracle', 'SELECT * FROM products WHERE ativo = 1')).toBeNull();
    expect(problem('sql', 'oracle', '-- ok\nselect 1 from dual;')).toBeNull();
    expect(problem('sql', 'oracle', '')).toBeNull();
    expect(problem('sql', 'oracle', 'DELETE FROM products')).toBe('oracle cards accept a single SELECT statement');
    expect(problem('sql', 'oracle', 'SELECT 1 FROM dual; DROP TABLE products')).toBe(
      'only one SELECT statement is allowed'
    );
    expect(problem('sql', 'oracle', "SELECT ';' AS sep FROM dual")).toBeNull();
    expect(problem('sql', 'postgres', 'DELETE FROM products')).toBeNull();
  });

  test('script lines are asserts or expressions', () => {
    expect(problem('jsonassert', 'script', 'assert $count(activeProducts) > 0\nassert status == "PROCESSADO"')).toBeNull();
    expect(problem('jsonassert', 'script', '// filter, then map\nitems[price > 10].name')).toBeNull();
    expect(problem('jsonassert', 'script', '// draft')).toBeNull();
    expect(problem('jsonassert', 'script', '')).toBeNull();
    expect(
      problem('jsonassert', 'script', 'assert $count(items) > 0\nexpect(res.status).toBe(200);')!.startsWith(
        'not a jsonassert expression: expect(res.status).toBe(200);'
      )
    ).toBe(true);
    expect(problem('jsonassert', 'script', 'assert items')!.startsWith('not a jsonassert assert line: assert items')).toBe(
      true
    );
  });

  test('a conditional is exactly one bare expression', () => {
    expect(problem('jsonassert', 'conditional', '$count(activeProducts) > 0')).toBeNull();
    expect(problem('jsonassert', 'conditional', '// only when there are products\n$count(activeProducts) > 0')).toBeNull();
    expect(problem('jsonassert', 'conditional', 'a > 1\nb > 2')).toBe(
      'a conditional holds exactly one boolean expression'
    );
    expect(problem('jsonassert', 'conditional', 'assert a > 1')).toBe(
      'a conditional is a bare boolean expression (no assert): assert a > 1'
    );
    expect(problem('jsonassert', 'conditional', 'a >')!.startsWith('not a jsonassert expression: a >')).toBe(true);
  });

  test('kinds without a rule accept anything', () => {
    expect(problem('openapi', 'restapi', '{ "a": 1 }')).toBeNull();
    expect(problem('rawvalue', 'json', 'not even close')).toBeNull();
    expect(problem(null, null, 'x')).toBeNull();
    expect(problem('kafka', null, 'x')).toBeNull();
    expect(problems('rawvalue', 'json', 'nope')).toEqual([]);
  });

  test('the validate endpoint answers the first problem, all of them and the canonical text', () => {
    expect(validate({ sourceType: 'rawvalue', subtype: 'json', code: '{}' })).toEqual({
      problem: null,
      problems: [],
      formatted: null
    });
    expect(validate({ sourceType: 'mongo', subtype: 'find', code: '[{}, [], {"foo": 1}]' })).toEqual({
      problem: 'arg 2 (projection): must be an object',
      problems: [
        'arg 2 (projection): must be an object',
        'arg 3 (options): unknown key "foo" (find accepts sort, limit, skip, maxTimeMS, collation, hint, comment)'
      ],
      // the canonical text is offered even when the arguments are wrong: it formats what parses
      formatted: '[\n  {},\n  [],\n  { "foo": 1 }\n]'
    });
    expect(validate({ sourceType: 'mongo', subtype: 'find', code: '[ {"ativo":true} ]' })).toEqual({
      problem: null,
      problems: [],
      formatted: '[\n  { "ativo": true }\n]'
    });
    expect(validate(null)).toEqual({ problem: null, problems: [], formatted: null });
  });
});
