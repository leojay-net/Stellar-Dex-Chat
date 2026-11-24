export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const editable = target.closest('[contenteditable]');
  return (
    target.isContentEditable ||
    !!target.closest('input, textarea, select, [role="textbox"]') ||
    (editable !== null && editable.getAttribute('contenteditable') !== 'false')
  );
}
