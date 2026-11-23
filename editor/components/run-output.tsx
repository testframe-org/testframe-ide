import { highlightSyntax } from '../highlight';

interface RunOutputProps {
  output: string;
  className?: string;
}

/** Output of a card run: pretty-printed highlighted JSON when it parses, plain text otherwise. */
export function RunOutput({ output, className = '' }: RunOutputProps) {
  let pretty: string | null = null;
  try {
    pretty = JSON.stringify(JSON.parse(output), null, 2);
  } catch {
    pretty = null;
  }
  return (
    <pre className={`font-mono whitespace-pre-wrap break-all select-text scrollbar-dark ${className}`}>
      {pretty === null ? output : highlightSyntax(pretty, 'json')}
    </pre>
  );
}
