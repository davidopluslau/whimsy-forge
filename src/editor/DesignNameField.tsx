import { useEffect, useState } from 'react';
import { MAX_DESIGN_NAME_LENGTH } from '../model/design';
import { useDesignStore } from '../store/designStore';

/** The open design's name. It commits when you leave the box or press Enter; Esc puts it back. */
export function DesignNameField() {
  const name = useDesignStore((state) => state.design.name);
  const renameDesign = useDesignStore((state) => state.renameDesign);
  const [text, setText] = useState(name);

  useEffect(() => setText(name), [name]);

  return (
    <input
      type="text"
      className="editor__name"
      aria-label="Design name"
      value={text}
      maxLength={MAX_DESIGN_NAME_LENGTH}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        renameDesign(text);
        // An empty name is refused, and an unchanged one has no update to bring the box back in line.
        setText(useDesignStore.getState().design.name);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          setText(name);
          event.currentTarget.blur();
        }
      }}
    />
  );
}
