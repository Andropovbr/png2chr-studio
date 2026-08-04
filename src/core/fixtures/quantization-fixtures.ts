import type { RawImageData } from '../types';

function fixture(
  width: number,
  height: number,
  pixel: (x: number, y: number) => readonly [number, number, number, number],
): RawImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      data.set(pixel(x, y), offset);
    }
  }
  return { width, height, data };
}

export const pixelArtFixture = fixture(8, 8, (x, y) =>
  (x + y) % 2 === 0 ? [0, 0, 0, 255] : [236, 238, 236, 255],
);

// 512 unique colors also exercises the pre-indexing reduction path.
export const gradientFixture = fixture(32, 16, (x, y) => [
  x * 8,
  y * 16,
  (y * 32 + x) % 256,
  255,
]);

export const transparencyFixture = fixture(8, 8, (x, y) =>
  x === 3 || y === 3 ? [255, 0, 255, 0] : [x * 28, y * 28, 140, 255],
);

export const outlinedDetailFixture = fixture(8, 8, (x, y) => {
  const border = x === 0 || y === 0 || x === 7 || y === 7;
  const isolatedDetail = x === 4 && y === 2;
  if (border) return [8, 16, 24, 255];
  if (isolatedDetail) return [236, 88, 180, 255];
  return [168, 204, 236, 255];
});
