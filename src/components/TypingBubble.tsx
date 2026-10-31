import { useEffect, useRef, useState } from "react";

const MS_PER_CHARACTER = 42;

/**
 * A speech bubble whose text types itself each time it scrolls into view.
 * The full text sits underneath, invisible, so the bubble never changes size while typing.
 */
export function TypingBubble(props: {
  who: string;
  text: string;
  color: string;
  delayMs?: number;
  className?: string;
}) {
  const { text, delayMs = 0 } = props;
  const box = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(0);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (!box.current) return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.6 });
    observer.observe(box.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(text.length);
      return;
    }
    if (!inView) {
      setShown(0);
      return;
    }
    let interval: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      interval = setInterval(() => {
        setShown((count) => {
          if (count >= text.length) clearInterval(interval);
          return Math.min(count + 1, text.length);
        });
      }, MS_PER_CHARACTER);
    }, delayMs);
    return () => {
      clearTimeout(start);
      clearInterval(interval);
    };
  }, [inView, text, delayMs]);

  const typing = inView && shown < text.length;

  return (
    <div ref={box} className={`bubble ${props.className ?? ""}`} style={{ "--who": props.color } as React.CSSProperties}>
      <strong>{props.who}</strong>
      <p aria-label={text}>
        <span className="bubble-space" aria-hidden>{text}</span>
        <span className="bubble-typed" aria-hidden>
          {text.slice(0, shown)}
          {typing && <i className="caret" />}
        </span>
      </p>
    </div>
  );
}
