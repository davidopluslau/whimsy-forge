import { useState } from 'react';
import type { LengthUnit } from '../model/units';
import { RoomScene } from '../scene/RoomScene';
import { useDesignStore } from '../store/designStore';
import { LengthField } from './LengthField';
import { PlanEditor } from './PlanEditor';
import { SaveCheck } from './SaveCheck';

type ViewMode = 'split' | 'plan' | '3d';

const VIEW_MODES: { mode: ViewMode; label: string }[] = [
  { mode: 'split', label: 'Split' },
  { mode: 'plan', label: 'Plan' },
  { mode: '3d', label: '3D' },
];

const UNITS: { unit: LengthUnit; label: string }[] = [
  { unit: 'm', label: 'Meters' },
  { unit: 'ft', label: 'Feet' },
];

export default function EditorPage() {
  const room = useDesignStore((state) => state.design.room);
  const setWallHeight = useDesignStore((state) => state.setWallHeight);
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const [unit, setUnit] = useState<LengthUnit>('m');

  return (
    <main className="editor" data-view-mode={viewMode}>
      <header className="editor__header">
        <h1>Editor</h1>
        <div className="segmented" role="group" aria-label="View">
          {VIEW_MODES.map(({ mode, label }) => (
            <button key={mode} type="button" aria-pressed={viewMode === mode} onClick={() => setViewMode(mode)}>
              {label}
            </button>
          ))}
        </div>
        <div className="segmented" role="group" aria-label="Units">
          {UNITS.map((option) => (
            <button key={option.unit} type="button" aria-pressed={unit === option.unit} onClick={() => setUnit(option.unit)}>
              {option.label}
            </button>
          ))}
        </div>
        <LengthField label="Wall height" meters={room.wallHeight} unit={unit} onCommit={setWallHeight} />
        <SaveCheck />
      </header>
      {/* Both panes stay mounted, so switching views keeps a half-drawn wall and the 3D camera. */}
      <div className="editor__panes">
        <section className="editor__pane editor__pane--plan" aria-label="Floor plan">
          <PlanEditor unit={unit} />
        </section>
        <section className="editor__pane editor__pane--scene" aria-label="3D view" data-testid="room-scene" data-wall-count={room.walls.length} data-opening-count={room.openings.length}>
          <RoomScene room={room} />
        </section>
      </div>
    </main>
  );
}
