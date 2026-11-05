import { materialsFor, type SurfaceKind } from '../model/materials';

type MaterialSelectProps = {
  label: string;
  surface: SurfaceKind;
  value: string | undefined;
  onChange: (materialId: string | undefined) => void;
};

export function MaterialSelect({ label, surface, value, onChange }: MaterialSelectProps) {
  return (
    <label className="field">
      {label}
      <select value={value ?? ''} onChange={(event) => onChange(event.target.value || undefined)}>
        <option value="">Plain</option>
        {materialsFor(surface).map((material) => (
          <option key={material.id} value={material.id}>
            {material.name}
          </option>
        ))}
      </select>
    </label>
  );
}
