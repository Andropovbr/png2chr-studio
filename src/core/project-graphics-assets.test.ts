import { describe, expect, it } from 'vitest';
import { createLogicalTileKey } from './asset-identity';
import { createEmptyBackgroundMap } from './background-model';
import {
  decodeProjectGraphicsAssets,
  encodeRawGraphicsTilePack,
} from './project-graphics-assets';
import { compileProjectGraphics } from './project-graphics-compiler';
import { createDefaultProject } from './project';
import type { IndexedImage } from './types';

function image(seed: number): IndexedImage {
  return {
    width: 8,
    height: 8,
    pixels: new Uint8Array(64).fill(seed),
    colors: [],
    transparentIndex: 0,
    colorCount: 4,
  };
}

function graphics() {
  const project = createDefaultProject();
  return {
    ...project.graphics,
    assets: [
      {
        id: 'asset-a',
        kind: 'tileset-image' as const,
        name: 'A',
        source: null,
        logicalTiles: {
          decoding: 'png-indexed' as const,
          quantization: null,
          paletteBank: 'background' as const,
        },
      },
      {
        id: 'asset-b',
        kind: 'spritesheet' as const,
        name: 'B',
        source: null,
        logicalTiles: {
          decoding: 'png-indexed' as const,
          quantization: null,
          paletteBank: 'sprite' as const,
        },
      },
    ],
    renderContexts: [
      {
        id: 'main',
        name: 'Main',
        backgroundPatternTable: 0 as const,
        spriteMode: '8x8' as const,
        spritePatternTable: 1 as const,
        mapIds: ['map-a'],
        animationIds: ['anim-b'],
      },
    ],
  };
}

describe('independent project graphics asset decoding', () => {
  it('decodes each catalog asset under its real stable ID', () => {
    const result = decodeProjectGraphicsAssets(graphics(), [
      { assetId: 'asset-a', indexedImage: image(1) },
      { assetId: 'asset-b', indexedImage: image(2) },
    ]);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.assets.map((asset) => asset.assetId)).toEqual([
      'asset-a',
      'asset-b',
    ]);
    expect(
      result.assets[0]?.tilesByLogicalKey.get(
        createLogicalTileKey('asset-a', 0, 0),
      )?.pixels[0],
    ).toBe(1);
    expect(
      result.assets[1]?.tilesByLogicalKey.get(
        createLogicalTileKey('asset-b', 0, 0),
      )?.pixels[0],
    ).toBe(2);
  });

  it('fails missing source instead of substituting another asset tiles', () => {
    expect(
      decodeProjectGraphicsAssets(graphics(), [
        { assetId: 'asset-a', indexedImage: image(1) },
      ]),
    ).toEqual({ success: false, assetId: 'asset-b', reason: 'missing-source' });
  });

  it('decodes only assets required by canonical logical demands', () => {
    const result = decodeProjectGraphicsAssets(
      graphics(),
      [{ assetId: 'asset-a', indexedImage: image(1) }],
      new Set(['asset-a']),
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.assets.map((asset) => asset.assetId)).toEqual(['asset-a']);
  });

  it('keeps raw tile packs separate from compiled project CHR', () => {
    const decoded = decodeProjectGraphicsAssets(graphics(), [
      { assetId: 'asset-a', indexedImage: image(1) },
      { assetId: 'asset-b', indexedImage: image(2) },
    ]);
    expect(decoded.success).toBe(true);
    if (!decoded.success) return;
    const backgroundAsset = decoded.assets[0];
    const spriteAsset = decoded.assets[1];
    if (!backgroundAsset || !spriteAsset) return;
    const raw = encodeRawGraphicsTilePack(backgroundAsset);
    expect(raw).toHaveLength(16);

    const logicalKey = createLogicalTileKey('asset-a', 0, 0);
    const map = {
      ...createEmptyBackgroundMap({ id: 'map-a', assetId: 'asset-a' }),
      cells: createEmptyBackgroundMap().cells.map((cell, index) =>
        index === 0 ? { logicalKey, tileX: 0, tileY: 0 } : cell,
      ),
    };
    const sprite = spriteAsset.tiles[0];
    if (!sprite) return;
    const compiled = compileProjectGraphics({
      graphics: graphics(),
      decodedAssets: decoded.assets,
      backgroundMaps: [map],
      animationDemands: [
        {
          animationId: 'anim-b',
          frames: [
            {
              sourceIndex: 0,
              sourceX: 0,
              sourceY: 0,
              duration: 1,
              effectivePalette: 0,
              width: 8,
              height: 8,
              omittedTileCount: 0,
              sprites: [
                {
                  pixels: sprite.pixels,
                  tileColumn: 0,
                  tileRow: 0,
                  tileX: 0,
                  tileY: 0,
                  logicalKey: createLogicalTileKey('asset-b', 0, 0),
                  x: 0,
                  y: 0,
                  sourceTileColumn: 0,
                  sourceTileRow: 0,
                },
              ],
            },
          ],
        },
      ],
    });
    expect(compiled.success).toBe(true);
    if (compiled.success) expect(compiled.finalChr).toHaveLength(8192);
  });
});
