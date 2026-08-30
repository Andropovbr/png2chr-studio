import { createBackgroundMapFromPlayfield } from './background-model';
import { encodeBackgroundAttributeTable } from './background-model';
import type { ChrRegion } from './chr-pattern-table';
import {
  compileProjectGraphics,
  type ProjectGraphicsCompilationResult,
} from './project-graphics-compiler';
import {
  createDefaultProjectGraphicsConfiguration,
  type ProjectBaseChr,
} from './project-graphics';
import type { Tile } from './types';

export interface CompilePlayfieldBackgroundOptions {
  readonly assetId: string;
  readonly mapId?: string;
  readonly name?: string;
  readonly tiles: readonly Tile[];
  readonly paletteAssignments: ArrayLike<number>;
  readonly patternTable?: 0 | 1;
  readonly baseChr?: ProjectBaseChr;
  readonly baseChrBytes?: Uint8Array | null;
  readonly chrRegions?: readonly ChrRegion[];
}

export interface CompiledPlayfieldBackground {
  readonly map: ReturnType<typeof createBackgroundMapFromPlayfield>;
  readonly graphics: ProjectGraphicsCompilationResult;
  readonly attributeTable: Uint8Array;
}

/**
 * Compatibility boundary for full-screen PNG/procedural workflows. It creates
 * logical Background input and delegates every physical CHR/Nametable choice
 * to the canonical project compiler.
 */
export function compilePlayfieldBackground(
  options: CompilePlayfieldBackgroundOptions,
): CompiledPlayfieldBackground {
  const mapId = options.mapId ?? 'background-playfield-active';
  const patternTable = options.patternTable ?? 0;
  const map = createBackgroundMapFromPlayfield({
    id: mapId,
    name: options.name ?? 'Playfield Background',
    assetId: options.assetId,
    patternTable,
    paletteAssignments: options.paletteAssignments,
  });
  const tilesByLogicalKey = new Map(
    map.cells.flatMap((cell, index) => {
      const tile = options.tiles[index];
      return cell === null || tile === undefined
        ? []
        : ([[cell.logicalKey, tile]] as const);
    }),
  );
  const defaults = createDefaultProjectGraphicsConfiguration();
  const graphics = compileProjectGraphics({
    graphics: {
      ...defaults,
      assets: [
        {
          id: options.assetId,
          kind: 'background-image',
          name: options.name ?? 'Playfield Background',
          source: null,
          logicalTiles: {
            decoding: 'png-indexed',
            quantization: null,
            paletteBank: 'background',
          },
        },
      ],
      baseChr: options.baseChr ?? defaults.baseChr,
      renderContexts: [
        {
          id: `render-context-${mapId}`,
          name: `${options.name ?? 'Playfield Background'} Render Context`,
          backgroundPatternTable: patternTable,
          spriteMode: '8x8',
          spritePatternTable: patternTable === 0 ? 1 : 0,
          mapIds: [mapId],
          animationIds: [],
        },
      ],
    },
    decodedAssets: [
      {
        assetId: options.assetId,
        widthTiles: 32,
        heightTiles: 30,
        tiles: options.tiles,
        tilesByLogicalKey,
      },
    ],
    backgroundMaps: [map],
    animationDemands: [],
    baseChrBytes: options.baseChrBytes,
    chrRegions: options.chrRegions,
  });

  return {
    map,
    graphics,
    attributeTable: encodeBackgroundAttributeTable(map.paletteAssignments),
  };
}
