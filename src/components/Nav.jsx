export function Nav({ views, active, onChange }) {
  return (
    <nav class="nav" role="tablist">
      {views.map((v) => (
        <button
          key={v.id}
          role="tab"
          aria-selected={active === v.id}
          class={active === v.id ? 'active' : ''}
          onClick={() => onChange(v.id)}
        >
          {v.label}
        </button>
      ))}
    </nav>
  );
}
