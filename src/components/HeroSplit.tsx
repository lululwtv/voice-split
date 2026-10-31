const lanes = [
  { name: "Maya", y: 72, color: "var(--speaker-1)", blocks: [[560, 70], [720, 110], [930, 60]] },
  { name: "Wei Jie", y: 152, color: "var(--speaker-2)", blocks: [[640, 70], [850, 70]] },
  { name: "Priya", y: 232, color: "var(--speaker-3)", blocks: [[590, 40], [790, 50], [905, 50]] },
  { name: "Alex", y: 312, color: "var(--speaker-4)", blocks: [[700, 80], [955, 35]] },
];
const MID = 192;
const bars = Array.from({ length: 42 }, (_, i) => ({
  x: i * 8,
  height: 14 + 92 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.43)),
}));

/** The product in one picture: one mixed signal separating into named voices. */
export function HeroSplit() {
  return (
    <svg className="hero-split" viewBox="0 0 1000 350" role="img" aria-label="One mixed audio signal splits into four named speakers">
      <defs>
        {lanes.map((lane) => (
          <linearGradient key={lane.name} id={`strand-${lane.name}`} gradientUnits="userSpaceOnUse" x1="336" x2="540" y1="0" y2="0">
            <stop offset="0" stopColor="var(--unknown)" />
            <stop offset="1" stopColor={lane.color} />
          </linearGradient>
        ))}
      </defs>
      <text className="hero-caption" x="0" y="52">One shared mic</text>
      <text className="hero-caption" x="548" y="22">Every voice, named</text>
      {bars.map((bar, i) => (
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
      {lanes.map((lane, l) => (
        <g key={lane.name}>
          <path
            className="hero-strand"
            d={`M336 ${MID} C 430 ${MID}, 440 ${lane.y}, 540 ${lane.y} L 1000 ${lane.y}`}
            pathLength={1}
            stroke={`url(#strand-${lane.name})`}
            style={{ animationDelay: `${l * 90}ms` }}
          />
          <text className="hero-name" x="548" y={lane.y - 15}>{lane.name}</text>
          {lane.blocks.map(([x, width], b) => (
            <rect
              key={x}
              className="hero-block"
              x={x}
              y={lane.y - 9}
              width={width}
              height="18"
              rx="9"
              fill={lane.color}
              style={{ animationDelay: `${500 + l * 90 + b * 110}ms` }}
            />
          ))}
        </g>
      ))}
    </svg>
  );
}
