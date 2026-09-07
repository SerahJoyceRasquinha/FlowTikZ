import { useState } from 'react';
import { PALETTE, normalizeHex } from '../latex/colors';

interface Props {
  label: string;
  value: string;
  onChange: (hex: string) => void;
  allowNone?: boolean;
}

/**
 * Colour control: swatch palette plus a native picker and a hex field.
 * Whatever is chosen here becomes a deduplicated `\definecolor` downstream.
 */
export function ColorField({ label, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);

  const commitHex = (raw: string) => {
    const hex = normalizeHex(raw);
    if (hex) onChange(`#${hex.toLowerCase()}`);
  };

  return (
    <div className="field color-field">
      <label>{label}</label>
      <div className="color-row">
        <button
          className="swatch"
          style={{ background: value }}
          onClick={() => setOpen((v) => !v)}
          aria-label={`${label} colour`}
        />
        <input
          className="hex"
          value={draft.startsWith('#') ? draft : value}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commitHex(draft)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitHex(draft);
            e.stopPropagation();
          }}
          onFocus={() => setDraft(value)}
          spellCheck={false}
        />
        <input
          type="color"
          className="native-color"
          value={normalizeHex(value) ? `#${normalizeHex(value)!.toLowerCase()}` : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} custom colour`}
        />
      </div>
      {open && (
        <div className="palette">
          {PALETTE.map((c) => (
            <button
              key={c.hex}
              className="palette-swatch"
              style={{ background: c.hex }}
              title={c.name}
              onClick={() => {
                onChange(c.hex);
                setOpen(false);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
