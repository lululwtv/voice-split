import { UserIcon } from "@phosphor-icons/react";

const MID = 192;
const WAVE_START = 590;
const WAVE_BARS = 51;

// Each voice gets its own wave shape, so the picture says "different people" without naming anyone.
const voices = [
  { y: 72, color: "var(--speaker-1)", shape: (i: number) => Math.abs(Math.sin(i * 1.3)) ** 3 },
  { y: 152, color: "var(--speaker-2)", shape: (i: number) => (i % 9 < 6 ? 0.55 + 0.2 * Math.sin(i * 2.1) : 0.06) },
  { y: 232, color: "var(--speaker-3)", shape: (i: number) => 0.08 + 0.92 * Math.sin(i * 0.31) ** 2 },
  { y: 312, color: "var(--speaker-4)", shape: (i: number) => 0.2 + 0.6 * Math.abs(Math.cos(i * 0.9) * Math.sin(i * 0.17)) },
];

const mixedBars = Array.from({ length: 42 }, (_, i) => ({
  x: i * 8,
  height: 14 + 92 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.43)),
}));

/** The product in one picture: one mixed signal separating into distinct voices. */
export function HeroSplit() {
  return (
    <svg className="hero-split" viewBox="0 0 1000 350" role="img" aria-label="One mixed audio signal splits into four different people's voices">
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
        <g key={v}>
          <path
            className="hero-strand"
            d={`M336 ${MID} C 430 ${MID}, 440 ${voice.y}, 540 ${voice.y}`}
            pathLength={1}
            stroke={`url(#strand-${v})`}
            style={{ animationDelay: `${v * 90}ms` }}
          />
          <UserIcon x={546} y={voice.y - 14} size={28} weight="fill" color={voice.color} />
          {Array.from({ length: WAVE_BARS }, (_, i) => {
            const height = Math.max(3, voice.shape(i) * 56);
            return (
              <rect
                key={i}
                className="hero-voice"
                x={WAVE_START + i * 8}
                y={voice.y - height / 2}
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
