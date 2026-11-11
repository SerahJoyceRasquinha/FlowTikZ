import { useEditor } from '../../state/store';
import { ChemEditor } from './ChemEditor';
import { FormulaEditor } from './FormulaEditor';
import { MoleculeEditor } from './MoleculeEditor';

/** Lazy-loaded entry point for the three scientific editors. */
export default function ScienceDialogs() {
  const dialog = useEditor((s) => s.scienceDialog);
  if (!dialog) return null;
  // Keyed so re-opening on another object starts from that object's content.
  if (dialog.kind === 'math') return <FormulaEditor key={dialog.nodeId ?? 'new'} nodeId={dialog.nodeId} library={dialog.library} />;
  if (dialog.kind === 'chem') return <ChemEditor key={dialog.nodeId ?? 'new'} nodeId={dialog.nodeId} tab={dialog.tab} />;
  return <MoleculeEditor key={dialog.nodeId ?? 'new'} nodeId={dialog.nodeId} />;
}
