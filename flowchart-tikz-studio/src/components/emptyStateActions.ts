/** Opens the same file picker as File → Import diagram. */
export function requestImportPicker() {
  const input = document.querySelector('input[data-input="import"]') as HTMLInputElement | null;
  input?.click();
}
