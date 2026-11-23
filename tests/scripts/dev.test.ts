import { describe, expect, test } from 'bun:test';
import { HOST, nextDevArgs } from '../../scripts/dev';

// The IDE edits project files and holds the plugin token: it must listen on loopback only
// (next dev without --hostname listens on every interface).

describe('scripts/dev.ts', () => {
  test('next dev is bound to 127.0.0.1', () => {
    expect(HOST).toBe('127.0.0.1');
    const args = nextDevArgs(15198);
    const i = args.findIndex((a) => a === '--hostname' || a === '-H');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(args[i + 1]).toBe('127.0.0.1');
    expect(args).toEqual(['dev', '--hostname', '127.0.0.1', '--port', '15198']);
  });
});
