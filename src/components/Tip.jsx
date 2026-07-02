import { useState, useLayoutEffect, useRef } from 'preact/hooks';
import { createPortal } from 'preact/compat';

// Instantaneous hover/focus tooltip. The bubble is rendered through a portal to
// <body> as a position:fixed element, so it escapes ancestor overflow/transform
// containing blocks (the results table's sticky-header scroll container would
// otherwise clip it) and it's horizontally clamped to stay on-screen near the
// page edges. It shows with no delay — unlike a native `title`. Pass `mark` to
// reveal a small "?" affordance on hover, and `focusable={false}` when the
// trigger already sits inside an interactive element (avoids a duplicate tab stop).
const MARGIN = 8; // min gap between the bubble and the viewport edge

export function Tip({ text, children, mark = false, focusable = true, className }) {
  // While shown: { cx, top } trigger anchor in viewport coords; else null.
  const [anchor, setAnchor] = useState(null);
  const [left, setLeft] = useState(0);
  const bubbleRef = useRef(null);

  // After the bubble mounts we know its width, so clamp its center into the
  // viewport. Runs before paint, so there's no visible jump.
  useLayoutEffect(() => {
    if (!anchor || !bubbleRef.current) return;
    const half = bubbleRef.current.offsetWidth / 2;
    const lo = MARGIN + half;
    const hi = window.innerWidth - MARGIN - half;
    setLeft(lo > hi ? window.innerWidth / 2 : Math.max(lo, Math.min(anchor.cx, hi)));
  }, [anchor]);

  if (!text) return children;

  const show = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    setAnchor({ cx, top: r.bottom + 6 });
    setLeft(cx); // rough center first; useLayoutEffect refines it before paint
  };
  const hide = () => setAnchor(null);

  return (
    <span
      class={`tip${className ? ` ${className}` : ''}`}
      tabIndex={focusable ? 0 : undefined}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {mark && <span class="tip-mark" aria-hidden="true">?</span>}
      {anchor && createPortal(
        <span ref={bubbleRef} class="tip-bubble" role="tooltip" style={`left:${left}px;top:${anchor.top}px`}>
          {text}
        </span>,
        document.body,
      )}
    </span>
  );
}
