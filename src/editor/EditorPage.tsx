import { useState } from 'react';
import { getDesignJson, putDesignJson } from '../api/designs';
import { createEmptyDesign } from '../model/design';
import { parseDesign } from '../model/migrate';
import { useDesignStore } from '../store/designStore';

type CheckState = { kind: 'idle' | 'running' } | { kind: 'done'; ok: boolean; message: string };

/** Placeholder until M1: proves the signed-in owner can save and load through the API. */
export default function EditorPage() {
  const [check, setCheck] = useState<CheckState>({ kind: 'idle' });
  const setDesign = useDesignStore((state) => state.setDesign);

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
      setDesign(parseDesign(received));
      setCheck({ kind: 'done', ok: true, message: `Round trip OK for design ${design.id}.` });
    } catch (error) {
      setCheck({ kind: 'done', ok: false, message: error instanceof Error ? error.message : String(error) });
    }
  }

  return (
    <main className="editor-page">
      <h1>Editor</h1>
      <p>The room editor arrives in M1. For now, this page checks that saving and loading work.</p>
      <button type="button" onClick={runCheck} disabled={check.kind === 'running'}>
        Run save and load check
      </button>
      {check.kind === 'done' && (
        <p role="status" data-testid="check-result" data-ok={check.ok}>
          {check.message}
        </p>
      )}
    </main>
  );
}
