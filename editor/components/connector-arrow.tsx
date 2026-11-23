interface ConnectorArrowProps {
  /** The shorter arrow between the last card and the "+" button. */
  short?: boolean;
}

/** Horizontal SVG arrow between two cards of a step (execution order, left to right). */
export function ConnectorArrow({ short = false }: ConnectorArrowProps) {
  const width = short ? 28 : 42;
  return (
    <div className="shrink-0 flex items-center justify-center">
      <svg width={width} height="20" viewBox={`0 0 ${width} 20`} fill="none" aria-hidden="true">
        <line x1="0" y1="10" x2={width - 6} y2="10" stroke="#475569" strokeWidth="1.75" />
        <path
          d={`M${width - 8} 5L${width - 2} 10L${width - 8} 15`}
          stroke="#475569"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
