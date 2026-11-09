

// Decorative editorial illustrations built from HTML, CSS and small inline
// SVG. Every root is aria-hidden: the surrounding text carries the meaning.
// No remote or binary assets.

/** A storyboard/scene frame: dusk sky, hills and a moon. */
export function SceneThumb({ variant = 0 }: { variant?: 0 | 1 | 2 | 3 }) {
  return (
    <span className={`scene-thumb scene-thumb--${variant}`} aria-hidden="true">
      <svg viewBox="0 0 120 72" preserveAspectRatio="xMidYMid slice" focusable="false">
        <circle className="scene-thumb__moon" cx={variant % 2 === 0 ? 92 : 30} cy="20" r="8" />
        <path className="scene-thumb__far" d="M0 50 Q30 34 60 46 T120 42 V72 H0Z" />
        <path className="scene-thumb__near" d="M0 60 Q40 48 70 58 T120 56 V72 H0Z" />
      </svg>
    </span>
  );
}

const WAVE = [6, 12, 20, 14, 26, 18, 30, 22, 12, 24, 16, 28, 20, 10, 18, 26, 14, 8, 16, 22, 12, 6];

/** Narration waveform. */
export function Waveform({ className }: { className?: string }) {
  return (
    <svg
      className={["waveform", className].filter(Boolean).join(" ")}
      viewBox={`0 0 ${WAVE.length * 6} 32`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      {WAVE.map((height, index) => (
        <rect key={index} x={index * 6 + 1} y={(32 - height) / 2} width="3" height={height} rx="1.5" />
      ))}
    </svg>
  );
}

function Lines({ count, className = "illo-lines" }: { count: number; className?: string }) {
  return (
    <span className={className}>
      {Array.from({ length: count }, (_, index) => (
        <span key={index} />
      ))}
    </span>
  );
}

/** Abstract layered cards for the closing call-to-action banner. */
export function CtaDecoration() {
  return (
    <div className="cta-decoration" aria-hidden="true">
      <span className="cta-decoration__orb" />
      <span className="cta-decoration__card cta-decoration__card--back">
        <SceneThumb variant={2} />
      </span>
      <span className="cta-decoration__card cta-decoration__card--front">
        <SceneThumb variant={0} />
        <Lines count={3} />
      </span>
      <span className="cta-decoration__chip">
        <Waveform />
      </span>
    </div>
  );
}
