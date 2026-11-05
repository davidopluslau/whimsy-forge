import type { Document, Node } from '@gltf-transform/core';

const BIN_SIZE = 0.02;
/** A triangle counts as level, and facing up, when its normal is within about 35 degrees of vertical. */
const MIN_UP = 0.8;

function transform(point: number[], m: readonly number[]): [number, number, number] {
  const [x, y, z] = point as [number, number, number];
  return [
    m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
    m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
    m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
  ];
}

function allNodes(document: Document): Node[] {
  return document.getRoot().listNodes();
}

/**
 * The height at which a model has the most upward-facing area, which on a chair is the seat.
 * Area is summed in 2 cm slices of height; the answer is the middle of the fullest slice.
 */
export function largestLevelSurfaceHeight(document: Document): number {
  const areaBySlice = new Map<number, number>();
  const scratch: number[] = [0, 0, 0];

  for (const node of allNodes(document)) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const matrix = node.getWorldMatrix();
    for (const primitive of mesh.listPrimitives()) {
      const positions = primitive.getAttribute('POSITION')!;
      const indices = primitive.getIndices();
      const count = indices ? indices.getCount() : positions.getCount();
      const at = (index: number) => transform(positions.getElement(indices ? indices.getScalar(index) : index, scratch), matrix);

      for (let index = 0; index + 2 < count; index += 3) {
        const [a, b, c] = [at(index), at(index + 1), at(index + 2)];
        const [ux, uy, uz] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const [vx, vy, vz] = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const [nx, ny, nz] = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
        const doubledArea = Math.hypot(nx, ny, nz);
        if (doubledArea === 0 || ny / doubledArea < MIN_UP) continue;
        const slice = Math.floor((a[1] + b[1] + c[1]) / 3 / BIN_SIZE);
        areaBySlice.set(slice, (areaBySlice.get(slice) ?? 0) + doubledArea / 2);
      }
    }
  }

  const [fullest] = [...areaBySlice.entries()].sort(([, one], [, other]) => other - one);
  if (!fullest) throw new Error('The model has no upward-facing surface.');
  return (fullest[0] + 0.5) * BIN_SIZE;
}
