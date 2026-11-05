import { expect, type APIRequestContext } from '@playwright/test';
import sharp from 'sharp';
import { accessToken, randomDesignId } from './access-token';

const WALL_HEIGHT = 2.6;
const NORTH = -2;
const EAST = 2.5;
/** Faces into the room from the east wall: its front points toward -x. */
const FACING_WEST = -Math.PI / 2;

type Upload = { width: number; height: number; stops: [string, string, string] };

/** A small abstract image, so the room has a real picture and rug without a photo in the repo. */
async function makeImage({ width, height, stops }: Upload): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${stops[0]}"/><stop offset="1" stop-color="${stops[1]}"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <circle cx="35%" cy="55%" r="24%" fill="${stops[2]}" opacity="0.8"/>
    <rect x="52%" y="18%" width="30%" height="56%" fill="${stops[0]}" opacity="0.55"/>
  </svg>`;
  return sharp(Buffer.from(svg)).webp({ quality: 85 }).toBuffer();
}

async function upload(request: APIRequestContext, image: Upload): Promise<string> {
  const id = randomDesignId();
  const response = await request.put(`/api/uploads/${id}`, {
    data: await makeImage(image),
    headers: { 'Content-Type': 'image/webp', 'Cf-Access-Jwt-Assertion': await accessToken() },
  });
  expect(response.status()).toBe(201);
  return id;
}

/** A furnished living room: the room the lighting and the phone budget are judged on. */
export function furnishedRoom(id: string, pictureUpload: string, rugUpload: string) {
  return {
    schemaVersion: 1,
    id,
    name: 'Furnished living room',
    updatedAt: '2026-11-05T12:00:00.000Z',
    room: {
      wallHeight: WALL_HEIGHT,
      floorMaterialId: 'herringbone-parquet',
      walls: [
        { id: 'n', start: [-EAST, NORTH], end: [EAST, NORTH], thickness: 0.12, materialId: 'painted-plaster-wall' },
        { id: 'e', start: [EAST, NORTH], end: [EAST, -NORTH], thickness: 0.12, materialId: 'white-plaster-02' },
        { id: 's', start: [EAST, -NORTH], end: [-EAST, -NORTH], thickness: 0.12, materialId: 'white-plaster-02' },
        { id: 'w', start: [-EAST, -NORTH], end: [-EAST, NORTH], thickness: 0.12, materialId: 'white-plaster-02' },
      ],
      openings: [
        { id: 'window', wallId: 'w', kind: 'window', offset: 1.2, width: 1.6, height: 1.4, sill: 0.8 },
        { id: 'door', wallId: 's', kind: 'door', offset: 3.4, width: 0.9, height: 2.1, sill: 0 },
      ],
    },
    items: [
      { id: 'rug', assetId: `photo:${rugUpload}`, position: [0, 0, -0.2], rotationY: 0, size: [2.6, 0.01, 1.9], mount: 'floor' },
      { id: 'sofa', assetId: 'sofa-03', position: [0, 0, NORTH + 0.5], rotationY: 0, size: [2.731, 1.118, 0.925], mount: 'floor' },
      { id: 'table', assetId: 'coffee-table-round-01', position: [0, 0, 0], rotationY: 0, size: [1.301, 0.491, 1.301], mount: 'floor' },
      { id: 'armchair', assetId: 'arm-chair-01', position: [1.65, 0, 0.1], rotationY: FACING_WEST, size: [0.848, 1.065, 0.766], mount: 'floor' },
      { id: 'lounge', assetId: 'mid-century-lounge-chair', position: [-1.6, 0, 0.5], rotationY: Math.PI * 0.75, size: [1.009, 1.169, 1.19], mount: 'floor' },
      { id: 'shelves', assetId: 'wooden-display-shelves-01', position: [EAST - 0.19, 0, 1.2], rotationY: FACING_WEST, size: [1.078, 1.556, 0.371], mount: 'floor' },
      { id: 'side', assetId: 'side-table-01', position: [1.8, 0, -1.65], rotationY: 0, size: [0.55, 0.551, 0.45], mount: 'floor' },
      { id: 'desk-lamp', assetId: 'desk-lamp-arm-01', position: [1.8, 0.551, -1.65], rotationY: -0.4, size: [0.202, 0.893, 0.614], mount: 'floor' },
      { id: 'plant-tall', assetId: 'potted-plant-01', position: [-2.05, 0, -1.55], rotationY: 0, size: [0.587, 1.335, 0.634], mount: 'floor' },
      { id: 'plant-low', assetId: 'potted-plant-02', position: [-2, 0, 1.55], rotationY: 0, size: [0.701, 0.841, 0.657], mount: 'floor' },
      { id: 'pendant', assetId: 'modern-ceiling-lamp-01', position: [0, WALL_HEIGHT - 0.952, 0], rotationY: 0, size: [0.432, 0.952, 0.432], mount: 'ceiling' },
      { id: 'sconce', assetId: 'industrial-wall-lamp', position: [EAST - 0.07, 1.5, 0.1], rotationY: FACING_WEST, size: [0.273, 0.43, 0.14], mount: 'wall', wallId: 'e' },
      { id: 'picture', assetId: `photo:${pictureUpload}`, position: [0, 1.3, NORTH + 0.015], rotationY: 0, size: [1.5, 0.95, 0.03], mount: 'wall', wallId: 'n' },
    ],
    cameras: [],
  };
}

/** Stores the furnished room as a snapshot, ready for `/v/<id>`. */
export async function storeFurnishedSnapshot(request: APIRequestContext): Promise<string> {
  const picture = await upload(request, { width: 600, height: 380, stops: ['#c9663f', '#2f4858', '#e8c468'] });
  const rug = await upload(request, { width: 780, height: 570, stops: ['#7d8c7a', '#3d4f5c', '#c7b299'] });
  const id = randomDesignId();
  const response = await request.put(`/api/snapshots/${id}`, {
    data: JSON.stringify(furnishedRoom(id, picture, rug)),
    headers: { 'Content-Type': 'application/json', 'Cf-Access-Jwt-Assertion': await accessToken() },
  });
  expect(response.status()).toBe(201);
  return id;
}
