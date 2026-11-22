import { describe, expect, test } from 'bun:test';
import { CONDITIONAL, SCRIPT, isAssert, problem, statements } from '@/lib/format/jsonassert-code';
import { strictJsonProblem } from '@/lib/format/strict-json';

describe('jsonassert card code', () => {
  test('statements drop blanks and // comments', () => {
    expect(statements('// a comment\n\n  assert x == 1  \r\n\r\ny > 2\n')).toEqual(['assert x == 1', 'y > 2']);
    expect(statements('')).toEqual([]);
    expect(statements(null)).toEqual([]);
    expect(isAssert('assert x == 1')).toBe(true);
    expect(isAssert('assertion')).toBe(false);
    expect(isAssert('x == 1')).toBe(false);
  });

  test('a script accepts assert lines and plain expressions', () => {
    expect(problem(SCRIPT, 'assert $count(items) > 0')).toBeNull();
    expect(problem(SCRIPT, 'assert a == 1\nassert b != 2\nassert c >= 3\nassert d <= 4\nassert e > 5\nassert f < 6')).toBeNull();
    expect(problem(SCRIPT, 'items[price > 100].name')).toBeNull();
    expect(problem(SCRIPT, '$map(items, function(v) { v.nome })')).toBeNull();
    expect(problem(SCRIPT, '// just a comment')).toBeNull();
    expect(problem(SCRIPT, '')).toBeNull();
    expect(problem(SCRIPT, null)).toBeNull();
  });

  test('a script reports the first broken statement', () => {
    expect(problem(SCRIPT, 'assert x == 1\nassert')).toContain('not a jsonassert assert line: assert');
    expect(problem(SCRIPT, 'x ==')).toContain('not a jsonassert expression: x ==');
    expect(problem(SCRIPT, 'assert $count(items) > ')).toContain('not a jsonassert assert line');
  });

  test('a conditional is one bare boolean expression', () => {
    expect(problem(CONDITIONAL, '$count(activeProducts) > 0')).toBeNull();
    expect(problem(CONDITIONAL, 'hasProducts')).toBeNull();
    expect(problem(CONDITIONAL, '// when there are products\n$count(activeProducts) > 0')).toBeNull();
    expect(problem(CONDITIONAL, 'a > 1\nb > 2')).toBe('a conditional holds exactly one boolean expression');
    expect(problem(CONDITIONAL, 'assert a > 1')).toBe(
      'a conditional is a bare boolean expression (no assert): assert a > 1'
    );
    expect(problem(CONDITIONAL, '')).toBeNull();
  });

  test('an expression cannot smuggle a top-level operator through the added parentheses', () => {
    expect(problem(SCRIPT, 'a) == null || (1')).toContain('unbalanced');
    expect(problem(SCRIPT, 'f(a')).toContain("unclosed '('");
    expect(problem(SCRIPT, '"unterminated')).toContain('unterminated string');
    // brackets inside strings do not count
    expect(problem(SCRIPT, 'items[name = "a(b"]')).toBeNull();
  });

  test('another subtype has no jsonassert rule', () => {
    expect(problem('nope', 'assert x')).toBeNull();
    expect(problem(null, 'assert x')).toBeNull();
  });
});

describe('strict JSON', () => {
  test('accepts well-formed JSON', () => {
    expect(strictJsonProblem('{}')).toBeNull();
    expect(strictJsonProblem('[1, 2, {"a": null}]')).toBeNull();
    expect(strictJsonProblem('"text"')).toBeNull();
    expect(strictJsonProblem('  \n {"a": 1} \n ')).toBeNull();
  });

  test('reports malformed JSON', () => {
    expect(strictJsonProblem('{')).not.toBeNull();
    expect(strictJsonProblem("{'a': 1}")).not.toBeNull();
    expect(strictJsonProblem('')).not.toBeNull();
  });

  test('reports a duplicated key inside one object', () => {
    expect(strictJsonProblem('{"a": 1, "a": 2}')).toBe('duplicate field "a"');
    expect(strictJsonProblem('{"a": {"b": 1, "b": 2}}')).toBe('duplicate field "b"');
    expect(strictJsonProblem('[{"a": 1}, {"a": 1}]')).toBeNull();
    expect(strictJsonProblem('{"a": 1, "b": {"a": 2}}')).toBeNull();
    expect(strictJsonProblem('{"a": [1, {"a": 1, "a": 2}]}')).toBe('duplicate field "a"');
  });
});
