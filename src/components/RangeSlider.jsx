// A dual-thumb range slider (two overlaid native range inputs). Emits the
// current [lo, hi] on every change. Thumbs can't cross. Optional `ticks` is an
// array of { value, label? } rendered as marks + labels beneath the track.
export function RangeSlider({ min, max, step, lo, hi, onChange, format, ticks, listId }) {
  const span = max - min || 1;
  const pctLo = ((lo - min) / span) * 100;
  const pctHi = ((hi - min) / span) * 100;
  const fmt = format || ((v) => v);
  const pct = (v) => ((v - min) / span) * 100;

  return (
    <div class="range-slider has-ticks">
      <div class="range-track">
        <div class="range-fill" style={`left:${pctLo}%; right:${100 - pctHi}%`} />
        {ticks &&
          ticks.map((t) => (
            <span key={t.value} class="range-tick" style={`left:${pct(t.value)}%`} />
          ))}
      </div>
      <input
        class="range-input"
        type="range"
        min={min}
        max={max}
        step={step}
        value={lo}
        list={listId}
        onInput={(e) => onChange(Math.min(parseFloat(e.currentTarget.value), hi), hi)}
        aria-label="Minimum"
      />
      <input
        class="range-input"
        type="range"
        min={min}
        max={max}
        step={step}
        value={hi}
        list={listId}
        onInput={(e) => onChange(lo, Math.max(parseFloat(e.currentTarget.value), lo))}
        aria-label="Maximum"
      />
      {listId && ticks && (
        <datalist id={listId}>
          {ticks.map((t) => (
            <option key={t.value} value={t.value} />
          ))}
        </datalist>
      )}
      {ticks && (
        <div class="range-tick-labels">
          {ticks.map((t) => (
            <span key={t.value} class="range-tick-label" style={`left:${pct(t.value)}%`}>
              {t.label ?? fmt(t.value)}
            </span>
          ))}
        </div>
      )}
      <div class="range-readout mono">
        {fmt(lo)} &ndash; {fmt(hi)}
      </div>
    </div>
  );
}
