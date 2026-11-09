import { Group, Mesh, Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { CAPTURE_HIDDEN, prepareForCapture, PRIVATE_CONTENT, PRIVATE_STAND_IN_MARK } from './capture';

/** A scene with a gizmo, a public model, and a private model with its hidden stand-in. */
function scene() {
  const root = new Scene();
  const gizmo = Object.assign(new Group(), { userData: { ...CAPTURE_HIDDEN } });
  const publicModel = new Mesh();
  const privateModel = Object.assign(new Group(), { userData: { ...PRIVATE_CONTENT } });
  const standIn = Object.assign(new Mesh(), { userData: { ...PRIVATE_STAND_IN_MARK }, visible: false });
  root.add(gizmo, publicModel, privateModel, standIn);
  return { root, gizmo, publicModel, privateModel, standIn };
}

const visibility = (parts: ReturnType<typeof scene>) => ({
  gizmo: parts.gizmo.visible,
  publicModel: parts.publicModel.visible,
  privateModel: parts.privateModel.visible,
  standIn: parts.standIn.visible,
});

describe('prepareForCapture', () => {
  it("draws the owner's own picture with private assets as they are", () => {
    const parts = scene();
    const { redacted } = prepareForCapture(parts.root, false);
    expect(visibility(parts)).toEqual({ gizmo: false, publicModel: true, privateModel: true, standIn: false });
    expect(redacted).toBe(false);
  });

  it('swaps each private asset for its stand-in in a picture for someone else', () => {
    const parts = scene();
    const { redacted } = prepareForCapture(parts.root, true);
    expect(visibility(parts)).toEqual({ gizmo: false, publicModel: true, privateModel: false, standIn: true });
    expect(redacted).toBe(true);
  });

  it('puts everything back afterward', () => {
    const parts = scene();
    const before = visibility(parts);
    prepareForCapture(parts.root, true).restore();
    expect(visibility(parts)).toEqual(before);
  });

  it('has nothing to redact in a room without private assets', () => {
    const root = new Scene().add(new Mesh());
    expect(prepareForCapture(root, true).redacted).toBe(false);
  });
});
