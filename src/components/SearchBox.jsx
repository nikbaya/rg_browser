import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

const MAX_MATCHES = 25;

// A reusable phenotype typeahead (substring match over descriptions) with a
// keyboard-navigable combobox dropdown. Used both in the home hero (variant
// "hero") and the persistent header search (variant "compact").
//
// Props:
//   phenotypes   array of { id, description, ... }
//   onSelect(i)  called with the selected phenotype index
//   variant      'hero' | 'compact'  (styling only)
//   placeholder  input placeholder
//   filterFn(p)  optional predicate to scope which phenotypes are searchable
//   autoFocus    focus the input on mount
export function SearchBox({
  phenotypes,
  onSelect,
  variant = 'compact',
  placeholder = 'Search a phenotype…',
  filterFn,
  autoFocus = false,
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0); // highlighted option index
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const listId = useRef(`sb-list-${Math.round(performance.now())}-${variant}`).current;

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out = [];
    for (let i = 0; i < phenotypes.length; i++) {
      if (!phenotypes[i].description.toLowerCase().includes(q)) continue;
      if (filterFn && !filterFn(phenotypes[i])) continue;
      out.push(i);
      if (out.length >= MAX_MATCHES) break;
    }
    return out;
  }, [query, phenotypes, filterFn]);

  // Keep the highlighted option in range as matches change.
  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    if (autoFocus && inputRef.current) inputRef.current.focus();
  }, [autoFocus]);

  // Close the dropdown when clicking outside the component.
  useEffect(() => {
    function onDocClick(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const showList = open && matches.length > 0;

  function choose(i) {
    onSelect(i);
    setQuery('');
    setOpen(false);
  }

  function onKeyDown(e) {
    if (!showList) {
      if (e.key === 'ArrowDown' && matches.length) {
        setOpen(true);
        e.preventDefault();
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        setActive((a) => (a + 1) % matches.length);
        e.preventDefault();
        break;
      case 'ArrowUp':
        setActive((a) => (a - 1 + matches.length) % matches.length);
        e.preventDefault();
        break;
      case 'Enter':
        if (matches[active] != null) choose(matches[active]);
        e.preventDefault();
        break;
      case 'Escape':
        setOpen(false);
        e.preventDefault();
        break;
      default:
        break;
    }
  }

  return (
    <div class={`search-box search-box--${variant}`} ref={rootRef}>
      <svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true" width="18" height="18">
        <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2" />
        <line x1="16.5" y1="16.5" x2="21" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      </svg>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList ? `${listId}-opt-${active}` : undefined}
        placeholder={placeholder}
        value={query}
        onInput={(e) => {
          setQuery(e.currentTarget.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {showList && (
        <ul class="search-dropdown" id={listId} role="listbox">
          {matches.map((i, idx) => (
            <li
              key={i}
              id={`${listId}-opt-${idx}`}
              role="option"
              aria-selected={idx === active}
              class={`search-option${idx === active ? ' is-active' : ''}`}
              onMouseEnter={() => setActive(idx)}
              // mousedown (not click) so it fires before the input blur closes the list
              onMouseDown={(e) => {
                e.preventDefault();
                choose(i);
              }}
            >
              <span class="search-option-name">{phenotypes[i].description}</span>
              <span class="search-option-id mono">{phenotypes[i].id}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
