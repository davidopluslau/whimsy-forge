import { useState, type FormEvent } from 'react';
import { uploadPhoto } from '../api/uploads';
import { generateId } from '../model/ids';
import type { LengthUnit } from '../model/units';
import { LengthField } from './LengthField';
import { type PhotoUpload, prepareImage } from './photo';

const MIN_WIDTH = 0.05;
const MAX_WIDTH = 10;
const DEFAULT_WIDTH: Record<PhotoUpload['kind'], number> = { picture: 0.6, rug: 1.6 };

type PhotoFormProps = {
  unit: LengthUnit;
  onAdd: (photo: PhotoUpload) => void;
};

/**
 * Turns a photo into a picture or a rug. The photo is resized in the browser and uploaded, then placed
 * in the room at the typed width; its height, or a rug's length, comes from the photo's shape.
 */
export function PhotoForm({ unit, onAdd }: PhotoFormProps) {
  const [file, setFile] = useState<File | null>(null);
  /** Remounting the file input after an add clears its displayed file name too. */
  const [inputKey, setInputKey] = useState(0);
  const [kind, setKind] = useState<PhotoUpload['kind']>('picture');
  const [width, setWidth] = useState(DEFAULT_WIDTH.picture);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || working) return;
    setWorking(true);
    setError(null);
    try {
      const { blob, aspect } = await prepareImage(file);
      const uploadId = generateId();
      await uploadPhoto(uploadId, blob);
      onAdd({ uploadId, kind, width, aspect });
      setFile(null);
      setInputKey((key) => key + 1);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The photo could not be added.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <form className="photo-form" aria-label="Add a photo" onSubmit={submit}>
      <h2 className="photo-form__title">Add a photo</h2>
      <label className="field">
        Photo
        <input key={inputKey} type="file" accept="image/*" disabled={working} onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
      </label>
      <fieldset className="photo-form__kind">
        <legend>Use it as</legend>
        {(['picture', 'rug'] as const).map((option) => (
          <label key={option}>
            <input
              type="radio"
              name="photo-kind"
              value={option}
              checked={kind === option}
              onChange={() => {
                setKind(option);
                setWidth(DEFAULT_WIDTH[option]);
              }}
            />
            {option === 'picture' ? 'Picture on a wall' : 'Rug on the floor'}
          </label>
        ))}
      </fieldset>
      <LengthField
        label="Across"
        meters={width}
        unit={unit}
        onCommit={(meters) => {
          if (meters < MIN_WIDTH || meters > MAX_WIDTH) return false;
          setWidth(meters);
          return true;
        }}
      />
      <button type="submit" disabled={!file || working}>
        {working ? 'Adding…' : 'Add to room'}
      </button>
      {error && (
        <p className="photo-form__error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
