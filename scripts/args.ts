// Minimal --key=value flag parsing for IDE runner scripts. Every setting the
// runners need arrives as a parameter (the root scripts resolve package.json
// config and forward it here).
export interface Flags {
  values: Record<string, string>;
  require(key: string): string;
  requireNumber(key: string): number;
  optional(key: string): string | undefined;
}

export function parseFlags(argv: string[]): Flags {
  const values: Record<string, string> = {};
  for (const arg of argv) {
    const match = /^--([\w]+)=(.*)$/.exec(arg);
    if (match) values[match[1]!] = match[2]!;
  }
  const require = (key: string): string => {
    const value = values[key];
    if (value === undefined) {
      console.error(`falta parâmetro obrigatório --${key}`);
      process.exit(1);
    }
    return value;
  };
  return {
    values,
    require,
    requireNumber: (key: string) => {
      const raw = require(key);
      const n = Number(raw);
      if (!Number.isInteger(n)) {
        console.error(`--${key} deve ser um número, veio: ${raw}`);
        process.exit(1);
      }
      return n;
    },
    optional: (key: string) => values[key]
  };
}
