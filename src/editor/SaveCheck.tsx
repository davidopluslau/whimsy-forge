import { useState } from 'react';
import { getDesignJson, putDesignJson } from '../api/designs';
import { createEmptyDesign } from '../model/design';
import { parseDesign } from '../model/migrate';

type CheckState = { kind: 'idle' | 'running' } | { kind: 'done'; ok: boolean; message: string };

/** Proves the signed-in owner can save and load through the API, until M5 adds real persistence. */
export function SaveCheck() {
  const [check, setCheck] = useState<CheckState>({ kind: 'idle' });

  async function runCheck() {
    setCheck({ kind: 'running' });
    try {
      const design = createEmptyDesign('Round-trip check');
      const sent = JSON.stringify(design);
      await putDesignJson(design.id, sent);
      const received = await getDesignJson(design.id);
      if (received !== sent) {
        setCheck({ kind: 'done', ok: false, message: 'The loaded design differs from the saved one.' });
        return;
      }
      parseDesign(received);
      setCheck({ kind: 'done', ok: true, message: `Round trip OK for design ${design.id}.` });
    } catch (error) {
      setCheck({ kind: 'done', ok: false, message: error instanceof Error ? error.message : String(error) });
    }
  }

  return (
    <details className="save-check">
      <summary>API check</summary>
      <div className="save-check__body">
        <button type="button" onClick={runCheck} disabled={check.kind === 'running'}>
          Run save and load check
        </button>
        {check.kind === 'done' && (
          <p role="status" data-testid="check-result" data-ok={check.ok}>
            {check.message}
          </p>
        )}
      </div>
    </details>
  );
}
