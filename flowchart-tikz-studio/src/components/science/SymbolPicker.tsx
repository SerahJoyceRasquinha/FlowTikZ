import { useMemo, useState } from 'react';
import { SymbolCategory, SymbolDef, searchSymbols } from '../../science/math/symbols';
import { frequentSymbols, recentSymbols, recordUse } from '../../science/recents';

/** Searchable symbol grid with recent and frequent tabs; shared by every editor. */
export function SymbolPicker({
  library,
  categories,
  onPick,
}: {
  library: string;
  categories: SymbolCategory[];
  onPick: (s: SymbolDef) => void;
}) {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<string>(categories[0].id);
  const [version, setVersion] = useState(0);

  const shown = useMemo(() => {
    void version;
    if (query.trim()) return searchSymbols(categories, query);
    if (tab === '__recent') return recentSymbols(library);
    if (tab === '__frequent') return frequentSymbols(library);
    return categories.find((c) => c.id === tab)?.symbols ?? [];
  }, [categories, library, query, tab, version]);

  const pick = (s: SymbolDef) => {
    recordUse(library, s);
    setVersion((v) => v + 1);
    onPick(s);
  };

  return (
    <div className="sym-picker">
      <div className="sym-head">
        <input
          type="search"
          value={query}
          placeholder="Search symbols, e.g. integral, ohm, arrow"
          aria-label="Search symbols"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </div>
      {!query.trim() && (
        <div className="sym-tabs" role="tablist" aria-label="Symbol categories">
          {[{ id: '__recent', label: 'Recent' }, { id: '__frequent', label: 'Frequent' }, ...categories].map((c) => (
            <button key={c.id} role="tab" aria-selected={tab === c.id} className={tab === c.id ? 'on' : ''} onClick={() => setTab(c.id)} type="button">
              {c.label}
            </button>
          ))}
        </div>
      )}
      <div className="sym-grid" role="group" aria-label="Symbols">
        {shown.map((s) => (
          <button key={s.tex} type="button" className="sym-btn" title={`${s.name}  ${s.tex}`} aria-label={s.name} onClick={() => pick(s)}>
            {s.glyph}
          </button>
        ))}
        {shown.length === 0 && (
          <p className="note sym-empty">
            {query.trim() ? 'No symbols match that search.' : tab === '__frequent' ? 'Symbols you use more than once appear here.' : 'Symbols you use appear here.'}
          </p>
        )}
      </div>
    </div>
  );
}
