import type { ComponentChildren } from 'preact';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks';

/*
 * An explanation kept out of the way: a small "?" that opens it, beside a heading, a label or a figure.
 *
 * It opens as a bubble under the "?" (above it where there is no room below), laid over the page, so that
 * nothing around it moves. A tap or a click opens it; a second one, a tap anywhere else, or Escape closes it.
 * The bubble follows its button in the page's order, so that the keyboard and a screen reader reach it next;
 * the button says whether it is open and which bubble it opens. On a narrow screen the bubble is kept inside
 * the screen, whatever the place of its button.
 */

/** The bubble's widest, and its distance from the screen's edges. */
const WIDEST = 320;
const EDGE = 12;

/**
 * The bubble until it is placed: measured out of the page's layout, at the screen's corner. Laid out beside a button
 * near the right edge, it would stick out of the screen sideways; a phone's browser then scrolls the page, and the
 * bubble would be placed from where the button had moved to.
 */
const UNPLACED = { position: 'fixed', left: '0px', top: '0px', visibility: 'hidden' } as const;

export const Info = ({ label, children, wide }: { label: string; children: ComponentChildren; wide?: boolean }) => {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ left: number; arrow: number; above: boolean; width: number } | undefined>();
  const id = useId();
  const wrap = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);

  // Where the bubble goes: centred under the button, moved sideways to stay on the screen, above it where there is no room below.
  const measure = () => {
    const at = button.current?.getBoundingClientRect();
    const from = wrap.current?.getBoundingClientRect();
    if (at === undefined || from === undefined) return;
    const screen = document.documentElement.clientWidth;
    const width = Math.min(wide === true ? WIDEST + 80 : WIDEST, screen - 2 * EDGE);
    const centre = at.left + at.width / 2;
    const left = Math.min(Math.max(centre - width / 2, EDGE), screen - EDGE - width);
    // Its height at the width it gets.
    if (bubble.current !== null) bubble.current.style.width = `${width}px`;
    const height = bubble.current?.offsetHeight ?? 0;
    // On a phone the bar at the bottom covers the last part of the screen.
    const bar = window.matchMedia('(max-width: 959.98px)').matches ? 72 : 0;
    const above = at.bottom + 10 + height > window.innerHeight - bar && at.top - 10 - height > 0;
    setPlace({ left: left - from.left, arrow: centre - left, above, width });
  };

  useLayoutEffect(() => {
    if (open) measure();
    else setPlace(undefined);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    const again = () => measure();
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', outside, true);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', again);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', outside, true);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', again);
    };
  }, [open]);

  return (
    <span class="info" ref={wrap}>
      <button type="button" class="info-button" ref={button} aria-label={label} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <span aria-hidden="true">?</span>
      </button>
      <span
        id={id}
        ref={bubble}
        role="note"
        class={`info-bubble${place?.above === true ? ' above' : ''}`}
        hidden={!open}
        style={place === undefined ? UNPLACED : ({ left: `${place.left}px`, width: `${place.width}px`, '--arrow': `${place.arrow}px` } as Record<string, string>)}
      >
        {children}
      </span>
    </span>
  );
};

/** A label with its explanation beside it, for a field or a figure. */
export const InfoLabel = ({ children, info, label, htmlFor }: { children: ComponentChildren; info: ComponentChildren; label: string; htmlFor?: string }) => (
  <span class="info-label">
    {htmlFor === undefined ? <span>{children}</span> : <label for={htmlFor}>{children}</label>}
    <Info label={label}>{info}</Info>
  </span>
);
