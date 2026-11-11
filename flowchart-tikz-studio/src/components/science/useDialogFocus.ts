import { useEffect, useRef } from 'react';

/**
 * Focus management shared by the scientific editors: focus moves into the
 * dialog on opening, Tab stays inside it, and focus returns when it closes.
 */
export function useDialogFocus() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    if (dialog && !dialog.contains(document.activeElement)) dialog.focus({ preventScroll: true });
    return () => previous?.focus?.({ preventScroll: true });
  }, []);

  const onTab = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !ref.current) return;
    const items = Array.from(
      ref.current.querySelectorAll<HTMLElement>('button:not([disabled]), input, select, textarea, [tabindex="0"]'),
    );
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === ref.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return { ref, onTab };
}
