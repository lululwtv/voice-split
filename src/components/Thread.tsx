import { useEffect, useRef, type RefObject } from "react";
import { HERO_MID, HERO_VIEW_WIDTH, LANE_YS } from "./HeroSplit";

const GUTTER = 56;
const CORNER = 16;
const BEND = 90;
const INPUT_SPREAD = 14;
const NARROW_RAIL = 14;
const WIDE_ENOUGH = 1000;
const SAMPLE_EVERY = 16;
/** The line is drawn up to this share of the viewport height. */
const DRAW_HEAD = 0.72;
const OFFSETS = [18, 6, -6, -18];
const COLORS = ["var(--speaker-1)", "var(--speaker-2)", "var(--speaker-3)", "var(--speaker-4)"];

interface Run {
  length: number;
  samples: { y: number; at: number }[];
}

function buildPaths(root: HTMLElement) {
  const box = root.getBoundingClientRect();
  const rel = (el: Element) => {
    const r = el.getBoundingClientRect();
    return { left: r.left - box.left, right: r.right - box.left, top: r.top - box.top, bottom: r.bottom - box.top };
  };
  const laptop = root.querySelector('[data-thread="laptop"]');
  const voices = [...root.querySelectorAll('[data-thread="voice"]')];
  const story = root.querySelector('[data-thread="split-scene"]');
  const hero = root.querySelector('[data-thread="hero"]');
  const end = root.querySelector('[data-thread="end"]');
  const sections = [...root.querySelectorAll('[data-thread="section"]')];
  if (!laptop || voices.length !== COLORS.length || !story || !hero || !end || !sections.length) return null;

  const wide = box.width >= WIDE_ENOUGH;
  const heroBox = rel(hero);
  const scale = (heroBox.right - heroBox.left) / HERO_VIEW_WIDTH;
  const heroY = (y: number) => heroBox.top + y * scale;
  const left = wide ? heroBox.left - GUTTER : NARROW_RAIL;
  const right = wide ? heroBox.right + GUTTER : NARROW_RAIL;

  // Each person's voice runs from where they sit into the one laptop.
  const mic = rel(laptop);
  const startX = (mic.left + mic.right) / 2;
  const inputs = voices.map((voice, i) => {
    const v = rel(voice);
    const x = (v.left + v.right) / 2;
    const landing = startX + (i - (voices.length - 1) / 2) * INPUT_SPREAD;
    const bend = mic.top - BEND;
    return `M${x} ${v.bottom} L${x} ${bend} C${x} ${mic.top - BEND / 3} ${landing} ${bend} ${landing} ${mic.top}`;
  });

  // One grey line: out of the laptop, down through the story, into the mixed signal.
  const sceneTop = rel(story).top;
  const gapY = sceneTop - 44;
  const heroMid = heroY(HERO_MID);
  const grey = [
    `M${startX} ${mic.bottom}`,
    `L${startX} ${gapY - 70}`,
    `C${startX} ${gapY} ${left} ${gapY} ${left} ${gapY + 70}`,
    `L${left} ${heroMid - 60}`,
    `C${left} ${heroMid} ${left} ${heroMid} ${heroBox.left} ${heroMid}`,
  ].join(" ");

  // Four voices: out of the hero tracks, weaving down each side of the evidence, ending at the repo button.
  const e = rel(end);
  const strands = OFFSETS.map((offset, i) => {
    const y0 = heroY(LANE_YS[i]);
    const x0 = right + (wide ? offset : i * 4);
    const d = [`M${heroBox.right} ${y0}`, `L${x0 - 24} ${y0}`, `Q${x0} ${y0} ${x0} ${y0 + 24}`];
    let x = x0;
    let y = y0 + 24;
    sections.forEach((section, index) => {
      const r = rel(section);
      const side = wide && index % 2 === 1 ? left + offset : x0;
      if (side !== x) {
        // Keep the four lines a visible ribbon while crossing: each turns at its own height, so none overlap.
        const crossing = (y + r.top) / 2 + (side < x ? offset : -offset);
        const step = side < x ? -CORNER : CORNER;
        d.push(
          `L${x} ${crossing - CORNER}`,
          `Q${x} ${crossing} ${x + step} ${crossing}`,
          `L${side - step} ${crossing}`,
          `Q${side} ${crossing} ${side} ${crossing + CORNER}`,
        );
        x = side;
      }
      y = index === sections.length - 1 ? e.top + (e.bottom - e.top) / 2 + offset / 3 - 24 : r.bottom;
      d.push(`L${x} ${y}`);
    });
    const yEnd = y + 24;
    const edge = x < e.left ? e.left : e.right;
    const toward = edge > x ? 24 : -24;
    d.push(`Q${x} ${yEnd} ${x + toward} ${yEnd}`, `L${edge} ${yEnd}`);
    return d.join(" ");
  });

  return { inputs, grey, strands, height: rel(root.lastElementChild!).bottom + 24 };
}

function measure(path: SVGPathElement): Run {
  const length = path.getTotalLength();
  const samples: Run["samples"] = [];
  let lowest = -Infinity;
  for (let at = 0; at <= length; at += SAMPLE_EVERY) {
    lowest = Math.max(lowest, path.getPointAtLength(at).y);
    samples.push({ y: lowest, at });
  }
  samples.push({ y: Math.max(lowest, path.getPointAtLength(length).y), at: length });
  return { length, samples };
}

/** How far along the path the drawing has reached when the head is at a given page height. */
function drawnLength(run: Run, head: number) {
  let low = 0;
  let high = run.samples.length - 1;
  if (run.samples[0].y > head) return 0;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (run.samples[mid].y <= head) low = mid;
    else high = mid - 1;
  }
  return run.samples[low].at;
}

/**
 * The line that carries the pitch: four voices enter one laptop, become one grey line,
 * split back into four at the hero, then run through every section. A faint copy is always visible; scrolling draws the bright one.
 */
export function Thread({ root }: { root: RefObject<HTMLElement | null> }) {
  const svg = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const host = root.current;
    const canvas = svg.current;
    if (!host || !canvas) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let runs: { bright: SVGPathElement; head: SVGCircleElement; run: Run }[] = [];

    const paint = () => {
      // Near the bottom the head speeds up, so the lines always reach the end of the page.
      const left = document.documentElement.scrollHeight - window.innerHeight - window.scrollY;
      const nearEnd = 1 - Math.min(1, left / window.innerHeight);
      const share = DRAW_HEAD + (1 - DRAW_HEAD) * nearEnd;
      const position = window.scrollY + window.innerHeight * share - (host.getBoundingClientRect().top + window.scrollY);
      for (const { bright, head, run } of runs) {
        const drawn = reduced ? run.length : drawnLength(run, position);
        bright.style.strokeDashoffset = String(run.length - drawn);
        const point = bright.getPointAtLength(drawn);
        head.setAttribute("cx", String(point.x));
        head.setAttribute("cy", String(point.y));
        head.style.opacity = drawn > 0 && drawn < run.length ? "1" : "0";
      }
    };

    const layout = () => {
      const built = buildPaths(host);
      if (!built) return;
      canvas.setAttribute("height", String(built.height));
      const all = [...built.inputs, built.grey, ...built.strands];
      runs = all.map((d, i) => {
        const group = canvas.children[i] as SVGGElement;
        const [track, bright] = [group.children[0], group.children[1]] as SVGPathElement[];
        track.setAttribute("d", d);
        bright.setAttribute("d", d);
        const run = measure(bright);
        bright.style.strokeDasharray = String(run.length);
        return { bright, head: group.children[2] as SVGCircleElement, run };
      });
      paint();
    };

    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(paint);
    };
    const observer = new ResizeObserver(layout);
    observer.observe(host);
    window.addEventListener("scroll", onScroll, { passive: true });
    void document.fonts?.ready.then(layout);
    layout();
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [root]);

  return (
    <svg ref={svg} className="thread" aria-hidden width="100%">
      {[...COLORS, "var(--unknown)", ...COLORS].map((color, i) => (
        <g key={i}>
          <path className="thread-track" stroke={color} />
          <path className="thread-bright" stroke={color} />
          <circle className="thread-head" r="5" fill={color} />
        </g>
      ))}
    </svg>
  );
}
