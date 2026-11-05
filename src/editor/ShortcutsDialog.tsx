import { useEffect, useRef } from 'react';
import { SHORTCUT_GROUPS } from './shortcuts';

/** Lists the editor's keyboard shortcuts. A native modal dialog traps focus, closes on Esc and returns focus. */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="shortcuts"
      aria-labelledby="shortcuts-title"
      data-testid="shortcuts-dialog"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialog.current) dialog.current.close();
      }}
    >
      <div className="shortcuts__head">
        <h2 id="shortcuts-title">Keyboard shortcuts</h2>
        <button type="button" className="button-quiet" onClick={() => dialog.current?.close()}>
          Close
        </button>
      </div>
      <div className="shortcuts__groups">
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group.title} aria-label={group.title}>
            <h3>{group.title}</h3>
            <dl>
              {group.shortcuts.map(({ keys, action }) => (
                <div key={`${keys.join('+')} ${action}`}>
                  <dt>
                    {keys.map((key) => (
                      <kbd key={key}>{key}</kbd>
                    ))}
                  </dt>
                  <dd>{action}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </dialog>
  );
}
