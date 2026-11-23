import { describe, expect, test } from 'bun:test';
import {
  camelNameProblem,
  environmentNameProblem,
  environmentNameProblemCode,
  fileNameToVarName,
  isBlank,
  isFrameDirName,
  isRoundTrip,
  normalizeVarName,
  slug,
  sourceNameProblem,
  sourceNameProblemCode,
  toVarName,
  trim,
  varNameToFileName
} from '@/lib/format/names';

// Port of server/src/test/java/com/testframe/server/format/NamesTest.java

describe('names', () => {
  test('slug is lower-case kebab-case without accents', () => {
    expect(slug('Ação Rápida!')).toBe('acao-rapida');
    expect(slug('  Active products / echo ')).toBe('active-products-echo');
    expect(slug('')).toBe('unnamed');
    expect(slug('---')).toBe('unnamed');
    expect(slug('..')).toBe('unnamed');
    expect(slug(null)).toBe('unnamed');
    expect(slug(undefined)).toBe('unnamed');
  });

  test('var-name from a title', () => {
    expect(toVarName('Get active products')).toBe('getActiveProducts');
    expect(toVarName('Send to framework echo')).toBe('sendToFrameworkEcho');
    expect(toVarName('')).toBe('unnamed');
  });

  test('camelCase to kebab-case and back', () => {
    const pairs: [string, string][] = [
      ['getActiveProducts', 'get-active-products'],
      ['assertEchoProcessed', 'assert-echo-processed'],
      ['echoPayload', 'echo-payload'],
      ['step2Value', 'step2-value'],
      ['x1', 'x1']
    ];
    for (const [varName, fileName] of pairs) {
      expect(varNameToFileName(varName)).toBe(fileName);
      expect(fileNameToVarName(fileName)).toBe(varName);
      expect(fileNameToVarName(`${fileName}.md`)).toBe(varName);
      expect(isRoundTrip(varName)).toBe(true);
    }
  });

  test('consecutive capitals do not survive the round trip', () => {
    expect(varNameToFileName('getHTTPData')).toBe('get-httpdata');
    expect(isRoundTrip('getHTTPData')).toBe(false);
    expect(normalizeVarName('getHTTPData')).toBe('getHttpdata');
    expect(normalizeVarName('getHTTP data')).toBe('getHttpData');
    expect(varNameToFileName('')).toBe('card');
    expect(varNameToFileName('run.sh')).toBe('run-sh');
    expect(isRoundTrip('run.sh')).toBe(false);
  });

  test('camelCase name rules', () => {
    expect(camelNameProblem('script', 'getActiveProducts')).toBeNull();
    expect(camelNameProblem('script', 'a')).toBe('script too short');
    expect(camelNameProblem('script', '')).toBe('script too short');
    expect(camelNameProblem('script', null)).toBe('script too short');
    expect(camelNameProblem('script', 'GetData')).toBe('script must be camelCase');
    expect(camelNameProblem('script', 'get-data')).toBe('script must be camelCase');
    expect(camelNameProblem('script', 'getHTTPData')).toBe(
      'script must survive the kebab-case file name (no consecutive capitals)'
    );
  });

  test('source name rules', () => {
    expect(sourceNameProblem('products-db')).toBeNull();
    expect(sourceNameProblem('api_v2-internal')).toBeNull();
    expect(sourceNameProblem('x')).toBe('name too short');
    expect(sourceNameProblem('../x')).toBe(
      'use lowercase letters, digits, hyphen and underscore (starting with a letter or digit)'
    );
    expect(sourceNameProblem('a/b')).toBe(
      'use lowercase letters, digits, hyphen and underscore (starting with a letter or digit)'
    );
    expect(sourceNameProblem('Api')).toBe(
      'use lowercase letters, digits, hyphen and underscore (starting with a letter or digit)'
    );
  });

  test('source name problems have a stable code the UI localizes (the message stays the format\'s)', () => {
    expect(sourceNameProblemCode('products-db')).toBeNull();
    expect(sourceNameProblemCode('x')).toBe('too-short');
    expect(sourceNameProblemCode('')).toBe('too-short');
    expect(sourceNameProblemCode(null)).toBe('too-short');
    for (const name of ['../x', 'a/b', 'Api', 'a b']) expect(sourceNameProblemCode(name)).toBe('invalid-characters');
    // the message is derived from the code, so the two can never drift apart
    expect(sourceNameProblem('x')).toBe('name too short');
    expect(sourceNameProblem('Api')).toBe(
      'use lowercase letters, digits, hyphen and underscore (starting with a letter or digit)'
    );
  });

  test('environment name rules', () => {
    expect(environmentNameProblem('local')).toBeNull();
    expect(environmentNameProblem('hml-1')).toBeNull();
    expect(environmentNameProblem('private')).toBe('the environment name "private" is reserved');
    expect(environmentNameProblem('Local')).toContain('invalid environment name');
    expect(environmentNameProblem('a_b')).toContain('invalid environment name');
    expect(environmentNameProblem('-a')).toContain('invalid environment name');
    expect(environmentNameProblem(7)).toContain('invalid environment name');
  });

  test('environment name problems have a stable code the UI localizes', () => {
    expect(environmentNameProblemCode('local')).toBeNull();
    expect(environmentNameProblemCode('hml-1')).toBeNull();
    expect(environmentNameProblemCode('private')).toBe('reserved');
    for (const name of ['Local', 'a_b', '-a', '', 7, null, ['a']]) expect(environmentNameProblemCode(name)).toBe('invalid');
    expect(environmentNameProblem('private')).toBe('the environment name "private" is reserved');
  });

  test('frame directory names are kebab-case', () => {
    expect(isFrameDirName('active-products-echo')).toBe(true);
    expect(isFrameDirName('frame2')).toBe(true);
    expect(isFrameDirName('Active')).toBe(false);
    expect(isFrameDirName('a_b')).toBe(false);
  });

  test('trim and isBlank', () => {
    expect(trim(' \t a b \n')).toBe('a b');
    expect(trim(null)).toBe('');
    expect(trim(undefined)).toBe('');
    expect(isBlank(' \n ')).toBe(true);
    expect(isBlank('x')).toBe(false);
  });
});
