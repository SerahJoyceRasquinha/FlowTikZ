import { useEffect, useState } from 'react';
import { useEditor } from '../state/store';
import { useTour } from '../state/tourStore';
import { Icon } from './Icon';
import { MenuItem } from './Toolbar';
import { getShapeDef } from '../model/shapes';

type BarMenu = 'align' | 'arrange';

/**
 * Floating actions for the current selection. It only appears when something
 * is selected, so the main toolbar stays short and the canvas never jumps.
 */
export function SelectionBar() {
  const selection = useEditor((s) => s.selection);
  const nodes = useEditor((s) => s.doc.nodes);
  const align = useEditor((s) => s.align);
  const distribute = useEditor((s) => s.distribute);
  const reorder = useEditor((s) => s.reorderSelection);
  const group = useEditor((s) => s.group);
  const ungroup = useEditor((s) => s.ungroup);
  const toggleLock = useEditor((s) => s.toggleLock);
  const deleteSelection = useEditor((s) => s.deleteSelection);
  const duplicate = useEditor((s) => s.duplicateSelection);
  const flip = useEditor((s) => s.flipSelection);
  const rotateBy = useEditor((s) => s.rotateSelectionBy);

  const tourActive = useTour((t) => t.active);
  const tourMenu = useTour((t) => t.menu);
  const tourPreview = useTour((t) => t.previewSelection);

  const [openMenu, setOpenMenu] = useState<BarMenu | null>(null);
  const menu = tourActive ? (tourMenu === 'align' || tourMenu === 'arrange' ? tourMenu : null) : openMenu;

  const count = selection.length;
  const has = count > 0;
  const multi = count > 1;
  const grouped = selection.some((id) => !!nodes[id]?.groupId);
  const allLocked = has && selection.every((id) => !nodes[id] || nodes[id].locked);
  const flippable = has && selection.some((id) => {
    const n = nodes[id];
    return !!n && (n.science?.type === 'molecule' || !!getShapeDef(n.kind).flippable);
  });

  useEffect(() => {
    if (!has) setOpenMenu(null);
  }, [has]);

  useEffect(() => {
    if (!openMenu) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (t && t.closest?.('.selection-bar .menu-wrap')) return;
      setOpenMenu(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [openMenu]);

  if (!has && !(tourActive && tourPreview)) return null;

  const toggle = (m: BarMenu) => setOpenMenu((cur) => (cur === m ? null : m));
  const run = (fn: () => void) => () => {
    setOpenMenu(null);
    fn();
  };
  const preview = !has;

  return (
    <div
      className={`selection-bar${preview ? ' is-preview' : ''}`}
      role="toolbar"
      aria-label="Selection actions"
      data-tour="selection"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span className="selection-count">
        <span className="dot" aria-hidden="true" />
        {preview ? '1 selected' : `${count} selected`}
      </span>

      <div className="menu-wrap">
        <button
          className={`btn tiny${menu === 'align' ? ' on' : ''}`}
          onClick={() => toggle('align')}
          disabled={!multi && !preview}
          title={multi ? 'Line up or evenly space the selected shapes' : 'Select two or more shapes to align them (Shift+click or drag a box)'}
          aria-haspopup="menu"
          aria-expanded={menu === 'align'}
        >
          <Icon name="align" size={16} />
          <span className="bl">Align</span>
          <span className="caret">
            <Icon name="chevronDown" size={13} />
          </span>
        </button>
        {menu === 'align' && (
          <div className="menu" role="menu">
            <div className="menu-label">Line up (2 or more shapes)</div>
            <MenuItem icon="alignLeft" label="Left edges" onClick={run(() => align('left'))} disabled={!multi} />
            <MenuItem icon="alignCenterH" label="Centres (left–right)" onClick={run(() => align('center-h'))} disabled={!multi} />
            <MenuItem icon="alignRight" label="Right edges" onClick={run(() => align('right'))} disabled={!multi} />
            <MenuItem icon="alignTop" label="Top edges" onClick={run(() => align('top'))} disabled={!multi} />
            <MenuItem icon="alignCenterV" label="Middles (top–bottom)" onClick={run(() => align('center-v'))} disabled={!multi} />
            <MenuItem icon="alignBottom" label="Bottom edges" onClick={run(() => align('bottom'))} disabled={!multi} />
            <div className="menu-sep" />
            <div className="menu-label">Even spacing (3 or more)</div>
            <MenuItem icon="distH" label="Space out left to right" onClick={run(() => distribute('h'))} disabled={count < 3} />
            <MenuItem icon="distV" label="Space out top to bottom" onClick={run(() => distribute('v'))} disabled={count < 3} />
          </div>
        )}
      </div>

      <div className="menu-wrap">
        <button
          className={`btn tiny${menu === 'arrange' ? ' on' : ''}`}
          onClick={() => toggle('arrange')}
          title="Move the selection in front of or behind other shapes"
          aria-haspopup="menu"
          aria-expanded={menu === 'arrange'}
        >
          <Icon name="layers" size={16} />
          <span className="bl">Arrange</span>
          <span className="caret">
            <Icon name="chevronDown" size={13} />
          </span>
        </button>
        {menu === 'arrange' && (
          <div className="menu" role="menu">
            <div className="menu-label">Stacking order</div>
            <MenuItem icon="toFront" label="Bring to front" sub="On top of everything" onClick={run(() => reorder('front'))} disabled={!has} />
            <MenuItem icon="forward" label="Bring forward" sub="Up one layer" onClick={run(() => reorder('forward'))} disabled={!has} />
            <MenuItem icon="backward" label="Send backward" sub="Down one layer" onClick={run(() => reorder('backward'))} disabled={!has} />
            <MenuItem icon="toBack" label="Send to back" sub="Behind everything" onClick={run(() => reorder('back'))} disabled={!has} />
          </div>
        )}
      </div>

      {flippable && (
        <>
          <button className="btn tiny" onClick={() => rotateBy(90)} title="Turn clockwise by 90 degrees (R)" data-action="rotate-90">
            <span className="bl">Rotate</span> 90°
          </button>
          <button className="btn tiny" onClick={() => flip('h')} title="Mirror left to right" aria-label="Flip left to right" data-action="flip-h">⇋</button>
          <button className="btn tiny" onClick={() => flip('v')} title="Mirror top to bottom" aria-label="Flip top to bottom" data-action="flip-v">⥮</button>
        </>
      )}

      <button className="btn tiny" onClick={duplicate} disabled={!has} title="Make a copy of the selection (Ctrl+D)">
        <Icon name="copy" size={16} />
        <span className="bl">Duplicate</span>
      </button>

      {grouped ? (
        <button className="btn tiny" onClick={ungroup} title="Split the group back into separate shapes (Ctrl+Shift+G)">
          <Icon name="ungroup" size={16} />
          <span className="bl">Ungroup</span>
        </button>
      ) : (
        <button
          className="btn tiny"
          disabled={!multi && !preview}
          onClick={group}
          title={multi ? 'Group the selected shapes so they move together (Ctrl+G)' : 'Select two or more shapes to group them'}
        >
          <Icon name="group" size={16} />
          <span className="bl">Group</span>
        </button>
      )}

      <button
        className={`btn tiny${allLocked ? ' on' : ''}`}
        disabled={!has && !preview}
        onClick={toggleLock}
        title={allLocked ? 'Unlock so the selection can be moved again' : 'Lock the selection so it cannot be moved by accident'}
      >
        <Icon name="lock" size={16} />
        <span className="bl">{allLocked ? 'Unlock' : 'Lock'}</span>
      </button>

      <span className="bar-sep" aria-hidden="true" />

      <button
        className="btn tiny danger"
        disabled={!has && !preview}
        onClick={deleteSelection}
        title="Delete the selection (Delete key). You can undo this."
        data-tour="delete"
      >
        <Icon name="trash" size={16} />
        Delete
      </button>
    </div>
  );
}
