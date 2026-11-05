import { useEffect, useState } from 'react';
import { formatLength, parseLength, type LengthUnit } from '../model/units';

const SAME_LENGTH = 1e-6;

type LengthFieldProps = {
  label: string;
  meters: number;
  unit: LengthUnit;
  /** Applies a new length in meters; returns false if it was refused. */
  onCommit: (meters: number) => boolean;
};

/**
 * A text box for one length, committed by Enter or leaving the field. Text that was not edited is
 * never committed, because the displayed value is rounded and would otherwise change the length.
 */
export function LengthField({ label, meters, unit, onCommit }: LengthFieldProps) {
  const shown = formatLength(meters, unit);
  const [text, setText] = useState(shown);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setText(shown);
    setInvalid(false);
  }, [shown]);

  function commit() {
    if (text === shown) {
      setInvalid(false);
      return;
    }
    const parsed = parseLength(text, unit);
    // Retyping the current value is not an edit, and must not read as one that was refused.
    if (parsed !== null && Math.abs(parsed - meters) < SAME_LENGTH) {
      setText(shown);
      setInvalid(false);
      return;
    }
    setInvalid(parsed === null || !onCommit(parsed));
  }

  return (
    <label className="field">
      {label}
      <input
        type="text"
        inputMode="decimal"
        value={text}
        aria-invalid={invalid}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
        }}
      />
    </label>
  );
}
