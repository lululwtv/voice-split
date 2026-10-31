const MID = 192;
const WAVE_START = 640;
const WAVE_BARS = 45;

/** Lane heights in the 1000-wide drawing, so the page thread can pick up where each voice ends. */
export const LANE_YS = [72, 152, 232, 312];
export const HERO_VIEW_WIDTH = 1000;
export const HERO_MID = MID;
/** Where a voice track's line ends, just before its name. */
export const HERO_LANE_START = 540;

const voices = [
  { name: "Youngjin", ownLine: true, color: "var(--speaker-4)", shape: (i: number) => 0.2 + 0.6 * Math.abs(Math.cos(i * 0.9) * Math.sin(i * 0.17)) },
  { name: "Edric", color: "var(--speaker-1)", shape: (i: number) => Math.abs(Math.sin(i * 1.3)) ** 3 },
  { name: "Dowon", color: "var(--speaker-2)", shape: (i: number) => (i % 9 < 6 ? 0.55 + 0.2 * Math.sin(i * 2.1) : 0.06) },
  { name: "Wei Ming", color: "var(--speaker-3)", shape: (i: number) => 0.08 + 0.92 * Math.sin(i * 0.31) ** 2 },
];

const mixedBars = Array.from({ length: 42 }, (_, i) => ({
  x: i * 8,
  height: 14 + 92 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.43)),
}));

/** The product in one picture: the shared signal separates into named voices beside the one that was never mixed. */
export function HeroSplit() {
  return (
    <svg
      className="hero-split"
      data-thread="hero"
      viewBox="0 0 1000 350"
      role="img"
      aria-label="One grey signal splits into tracks for Edric, Dowon and Wei Ming. Youngjin's own line arrives as a fourth track."
    >
      <defs>
        {voices.map((voice, v) => (
          <linearGradient key={v} id={`strand-${v}`} gradientUnits="userSpaceOnUse" x1="336" x2="540" y1="0" y2="0">
            <stop offset="0" stopColor="var(--unknown)" />
            <stop offset="1" stopColor={voice.color} />
          </linearGradient>
        ))}
      </defs>
      {mixedBars.map((bar, i) => (
        <rect
          key={bar.x}
          className="hero-bar"
          x={bar.x}
          y={MID - bar.height / 2}
          width="4"
          height={bar.height}
          rx="2"
          style={{ animationDelay: `${i * -90}ms` }}
        />
      ))}
      {voices.map((voice, v) => (
        <g key={voice.name}>
          {!voice.ownLine && (
            <path
              className="hero-strand"
              d={`M336 ${MID} C 430 ${MID}, 440 ${LANE_YS[v]}, 540 ${LANE_YS[v]}`}
              pathLength={1}
              stroke={`url(#strand-${v})`}
              style={{ animationDelay: `${v * 90}ms` }}
            />
          )}
          <text className="hero-name" x="548" y={LANE_YS[v] + 5} fill={voice.color}>{voice.name}</text>
          {Array.from({ length: WAVE_BARS }, (_, i) => {
            const height = Math.max(3, voice.shape(i) * 56);
            return (
              <rect
                key={i}
                className="hero-voice"
                x={WAVE_START + i * 8}
                y={LANE_YS[v] - height / 2}
                width="4"
                height={height}
                rx="2"
                fill={voice.color}
                style={{ animationDelay: `${500 + v * 90 + i * 12}ms` }}
              />
            );
          })}
        </g>
      ))}
    </svg>
  );
}
