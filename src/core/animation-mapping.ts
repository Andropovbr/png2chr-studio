import { decodeChrTile } from './chr-decoder';
import type {
  AnimationFrameModel,
  AnimationModel,
  AnimationProjectModel,
  MetaspriteTile,
} from './animation-model';
import { transformTile } from './tile-deduplication';
import type { Tile } from './types';

const TILE_SIZE = 8;
const BYTES_PER_TILE = 16;

export interface AnimationMappingCell {
  readonly column: number;
  readonly row: number;
  readonly spriteOrder: number | null;
  readonly sprite: MetaspriteTile | null;
  /** Final CHR tile after applying the sprite's exported flip attributes. */
  readonly tile: Tile | null;
}

function effectiveSpriteTile(
  finalChr: Uint8Array,
  sprite: MetaspriteTile,
): Tile {
  const byteOffset = sprite.physicalTileIndex * BYTES_PER_TILE;
  const tile = decodeChrTile(
    finalChr.slice(byteOffset, byteOffset + BYTES_PER_TILE),
    sprite.physicalTileIndex,
  );
  return transformTile(tile, sprite.horizontalFlip, sprite.verticalFlip);
}

/**
 * Projects a final animation frame into its metasprite grid. Tile pixels come
 * from final CHR and are oriented with the same attributes exported to OAM.
 */
export function createAnimationFrameMapping(
  project: AnimationProjectModel,
  animation: AnimationModel,
  frame: AnimationFrameModel,
): readonly AnimationMappingCell[] {
  const spritesByPosition = new Map<
    string,
    { readonly sprite: MetaspriteTile; readonly spriteOrder: number }
  >();
  frame.sprites.forEach((sprite, spriteOrder) => {
    const column = (sprite.x + animation.originX) / TILE_SIZE;
    const row = (sprite.y + animation.originY) / TILE_SIZE;
    spritesByPosition.set(`${String(column)}_${String(row)}`, {
      sprite,
      spriteOrder,
    });
  });

  const cells: AnimationMappingCell[] = [];
  for (let row = 0; row < animation.heightTiles; row += 1) {
    for (let column = 0; column < animation.widthTiles; column += 1) {
      const positioned = spritesByPosition.get(
        `${String(column)}_${String(row)}`,
      );
      cells.push({
        column,
        row,
        spriteOrder: positioned?.spriteOrder ?? null,
        sprite: positioned?.sprite ?? null,
        tile:
          positioned === undefined
            ? null
            : effectiveSpriteTile(project.finalChr, positioned.sprite),
      });
    }
  }
  return cells;
}
