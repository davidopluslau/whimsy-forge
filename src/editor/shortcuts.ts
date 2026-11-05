/** Where the editor's single-key shortcuts must leave the key alone: typing, choosing, or a dialog on top. */
export function shortcutsBlocked(target: EventTarget | null): boolean {
  return isTextTarget(target) || document.querySelector('dialog[open]') !== null;
}

/** Where to type or select text. */
export const isTextTarget = (target: EventTarget | null) => target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]') !== null;

/** Whether a key press carries a modifier that belongs to the browser or another shortcut. */
export const hasCommandModifier = (event: KeyboardEvent) => event.ctrlKey || event.metaKey || event.altKey;

export const PLAN_TOOL_KEYS = { w: 'draw', v: 'select', d: 'door', n: 'window' } as const;

export type ShortcutGroup = { title: string; shortcuts: { keys: string[]; action: string }[] };

/** Every shortcut the editor has. The help dialog is drawn from this list, so the two can't drift apart unnoticed. */
export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    title: 'General',
    shortcuts: [
      { keys: ['?'], action: 'Show these shortcuts' },
      { keys: ['Ctrl', 'Z'], action: 'Undo' },
      { keys: ['Ctrl', 'Shift', 'Z'], action: 'Redo (also Ctrl+Y)' },
      { keys: ['Ctrl', 'S'], action: 'Save now' },
      { keys: ['1'], action: 'Split view' },
      { keys: ['2'], action: 'Plan view' },
      { keys: ['3'], action: '3D view' },
      { keys: ['C'], action: 'Show or hide the catalog' },
      { keys: ['/'], action: 'Search the catalog' },
    ],
  },
  {
    title: 'Floor plan',
    shortcuts: [
      { keys: ['W'], action: 'Draw walls' },
      { keys: ['V'], action: 'Select' },
      { keys: ['D'], action: 'Add a door' },
      { keys: ['N'], action: 'Add a window' },
      { keys: ['Tab'], action: 'Go to the next wall, item or opening' },
      { keys: ['Enter'], action: 'Select what has focus' },
      { keys: ['Delete'], action: 'Delete the selected wall or opening' },
      { keys: ['Esc'], action: 'Stop drawing, or clear the selection' },
    ],
  },
  {
    title: 'Selected item',
    shortcuts: [
      { keys: ['Arrows'], action: 'Nudge 5 cm (with Shift, 25 cm)' },
      { keys: ['Page Up'], action: 'Raise 5 cm (with Shift, 25 cm)' },
      { keys: ['Page Down'], action: 'Lower 5 cm (with Shift, 25 cm)' },
      { keys: ['R'], action: 'Turn a quarter (with Shift, the other way)' },
      { keys: ['G'], action: 'Switch between the move and rotate gizmos' },
      { keys: ['Ctrl', 'D'], action: 'Duplicate' },
      { keys: ['Delete'], action: 'Delete' },
      { keys: ['Esc'], action: 'Clear the selection' },
    ],
  },
];
