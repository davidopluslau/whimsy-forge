// Runs inside headless Chromium (see thumbnail.ts), so thumbnails come from the same renderer the app uses.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const SIZE = 512;
const FIELD_OF_VIEW = 25;
const VIEW_AZIMUTH = THREE.MathUtils.degToRad(35);
const VIEW_ELEVATION = THREE.MathUtils.degToRad(18);
const MARGIN = 1.06;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setSize(SIZE, SIZE);
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.append(renderer.domElement);

const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const key = new THREE.DirectionalLight(0xffffff, 1.5);
key.position.set(2, 4, 3);
scene.add(key);

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

/** Places the camera at a fixed three-quarter view, as close as it can get with the whole box in frame. */
function frame(box: THREE.Box3): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(FIELD_OF_VIEW, 1, 0.01, 100);
  const center = box.getCenter(new THREE.Vector3());
  const back = new THREE.Vector3(
    Math.sin(VIEW_AZIMUTH) * Math.cos(VIEW_ELEVATION),
    Math.sin(VIEW_ELEVATION),
    Math.cos(VIEW_AZIMUTH) * Math.cos(VIEW_ELEVATION),
  );
  const right = new THREE.Vector3(0, 1, 0).cross(back).normalize();
  const up = back.clone().cross(right);
  const halfView = Math.tan(THREE.MathUtils.degToRad(FIELD_OF_VIEW / 2));

  let distance = 0;
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        const corner = new THREE.Vector3(x, y, z).sub(center);
        const needed = corner.dot(back) + Math.max(Math.abs(corner.dot(right)), Math.abs(corner.dot(up))) / halfView;
        distance = Math.max(distance, needed);
      }
    }
  }
  camera.position.copy(center).addScaledVector(back, distance * MARGIN);
  camera.lookAt(center);
  return camera;
}

async function renderThumbnail(url: string): Promise<string> {
  const { scene: model } = await loader.loadAsync(url);
  scene.add(model);
  renderer.render(scene, frame(new THREE.Box3().setFromObject(model)));
  const image = renderer.domElement.toDataURL('image/png');
  scene.remove(model);
  return image;
}

Object.assign(window, { renderThumbnail });
