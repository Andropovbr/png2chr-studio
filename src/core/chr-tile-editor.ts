/**
 * Pure domain operations for NES CHR 8x8 tile pixel manipulation,
 * geometric transformations, planar bitplane encode/decode, and undo/redo history.
 */

export const TILE_SIZE = 8;
export const PIXELS_PER_TILE = TILE_SIZE * TILE_SIZE; // 64
export const BYTES_PER_TILE = 16;
export const DEFAULT_HISTORY_DEPTH = 50;

export type ColorIndex = 0 | 1 | 2 | 3;
export type ShiftDirection = 'up' | 'down' | 'left' | 'right';

/**
 * Validates that a tile pixel buffer has exactly 64 pixels with values 0..3.
 */
export function validateTilePixels(pixels: Uint8Array): void {
  if (pixels.length !== PIXELS_PER_TILE) {
    throw new RangeError(
      `A CHR tile must contain exactly ${String(PIXELS_PER_TILE)} pixels, got ${String(pixels.length)}.`,
    );
  }
  for (let i = 0; i < pixels.length; i += 1) {
    const val = pixels[i];
    if (val === undefined || val < 0 || val > 3) {
      throw new RangeError(
        `CHR tile pixel value at index ${String(i)} must be between 0 and 3, got ${String(val)}.`,
      );
    }
  }
}

/**
 * Creates a new 64-pixel tile buffer initialized to a color index (default 0).
 */
export function createEmptyTilePixels(fillIndex = 0): Uint8Array {
  const clamped = Math.max(0, Math.min(3, Math.floor(fillIndex)));
  const pixels = new Uint8Array(PIXELS_PER_TILE);
  if (clamped !== 0) {
    pixels.fill(clamped);
  }
  return pixels;
}

/**
 * Clones a 64-pixel tile buffer.
 */
export function cloneTilePixels(pixels: Uint8Array): Uint8Array {
  validateTilePixels(pixels);
  return new Uint8Array(pixels);
}

/**
 * Returns a new tile pixel buffer with a single pixel modified.
 */
export function setTilePixel(
  pixels: Uint8Array,
  x: number,
  y: number,
  colorIndex: number,
): Uint8Array {
  validateTilePixels(pixels);
  if (x < 0 || x >= TILE_SIZE || y < 0 || y >= TILE_SIZE) {
    throw new RangeError(
      `Pixel coordinates (${String(x)}, ${String(y)}) out of bounds for 8x8 tile.`,
    );
  }
  const clampedColor = Math.max(0, Math.min(3, Math.floor(colorIndex)));
  const next = new Uint8Array(pixels);
  next[y * TILE_SIZE + x] = clampedColor;
  return next;
}

/**
 * Mirrors an 8x8 tile horizontally (x' = 7 - x).
 */
export function flipTileHorizontal(pixels: Uint8Array): Uint8Array {
  validateTilePixels(pixels);
  const next = new Uint8Array(PIXELS_PER_TILE);
  for (let y = 0; y < TILE_SIZE; y += 1) {
    const rowOffset = y * TILE_SIZE;
    for (let x = 0; x < TILE_SIZE; x += 1) {
      next[rowOffset + x] = pixels[rowOffset + (TILE_SIZE - 1 - x)] ?? 0;
    }
  }
  return next;
}

/**
 * Mirrors an 8x8 tile vertically (y' = 7 - y).
 */
export function flipTileVertical(pixels: Uint8Array): Uint8Array {
  validateTilePixels(pixels);
  const next = new Uint8Array(PIXELS_PER_TILE);
  for (let y = 0; y < TILE_SIZE; y += 1) {
    const srcRowOffset = (TILE_SIZE - 1 - y) * TILE_SIZE;
    const dstRowOffset = y * TILE_SIZE;
    for (let x = 0; x < TILE_SIZE; x += 1) {
      next[dstRowOffset + x] = pixels[srcRowOffset + x] ?? 0;
    }
  }
  return next;
}

/**
 * Shifts tile pixels by 1 pixel in the specified direction.
 * If wrap is true, pixels scrolling off one side re-enter from the opposite side.
 * If wrap is false, empty positions are filled with 0.
 */
export function shiftTile(
  pixels: Uint8Array,
  direction: ShiftDirection,
  wrap = false,
): Uint8Array {
  validateTilePixels(pixels);
  const next = new Uint8Array(PIXELS_PER_TILE);

  for (let y = 0; y < TILE_SIZE; y += 1) {
    for (let x = 0; x < TILE_SIZE; x += 1) {
      let srcX = x;
      let srcY = y;

      switch (direction) {
        case 'up':
          srcY = y + 1;
          break;
        case 'down':
          srcY = y - 1;
          break;
        case 'left':
          srcX = x + 1;
          break;
        case 'right':
          srcX = x - 1;
          break;
      }

      if (srcX >= 0 && srcX < TILE_SIZE && srcY >= 0 && srcY < TILE_SIZE) {
        next[y * TILE_SIZE + x] = pixels[srcY * TILE_SIZE + srcX] ?? 0;
      } else if (wrap) {
        const wrappedX = (srcX + TILE_SIZE) % TILE_SIZE;
        const wrappedY = (srcY + TILE_SIZE) % TILE_SIZE;
        next[y * TILE_SIZE + x] = pixels[wrappedY * TILE_SIZE + wrappedX] ?? 0;
      } else {
        next[y * TILE_SIZE + x] = 0;
      }
    }
  }

  return next;
}

/**
 * Rotates an 8x8 tile 90 degrees clockwise (or counter-clockwise).
 */
export function rotateTile90(pixels: Uint8Array, clockwise = true): Uint8Array {
  validateTilePixels(pixels);
  const next = new Uint8Array(PIXELS_PER_TILE);

  for (let y = 0; y < TILE_SIZE; y += 1) {
    for (let x = 0; x < TILE_SIZE; x += 1) {
      if (clockwise) {
        next[y * TILE_SIZE + x] =
          pixels[(TILE_SIZE - 1 - x) * TILE_SIZE + y] ?? 0;
      } else {
        next[y * TILE_SIZE + x] =
          pixels[x * TILE_SIZE + (TILE_SIZE - 1 - y)] ?? 0;
      }
    }
  }

  return next;
}

/**
 * Clears all 64 pixels of a tile to the specified color index (default 0).
 */
export function clearTile(pixels: Uint8Array, fillIndex = 0): Uint8Array {
  validateTilePixels(pixels);
  return createEmptyTilePixels(fillIndex);
}

/**
 * Flood-fills contiguous 4-connected pixels sharing the same color index.
 */
export function floodFillTile(
  pixels: Uint8Array,
  startX: number,
  startY: number,
  targetColorIndex: number,
): Uint8Array {
  validateTilePixels(pixels);

  if (startX < 0 || startX >= TILE_SIZE || startY < 0 || startY >= TILE_SIZE) {
    return cloneTilePixels(pixels);
  }

  const targetColor = Math.max(0, Math.min(3, Math.floor(targetColorIndex)));
  const sourceColor = pixels[startY * TILE_SIZE + startX] ?? 0;

  if (sourceColor === targetColor) {
    return cloneTilePixels(pixels);
  }

  const result = new Uint8Array(pixels);
  const queue: [number, number][] = [[startX, startY]];
  const visited = new Uint8Array(PIXELS_PER_TILE);

  while (queue.length > 0) {
    const item = queue.pop();
    if (!item) continue;
    const [x, y] = item;
    const idx = y * TILE_SIZE + x;

    if (visited[idx] === 1) continue;
    visited[idx] = 1;

    if (result[idx] === sourceColor) {
      result[idx] = targetColor;

      if (x > 0 && visited[idx - 1] === 0) queue.push([x - 1, y]);
      if (x < TILE_SIZE - 1 && visited[idx + 1] === 0) queue.push([x + 1, y]);
      if (y > 0 && visited[idx - TILE_SIZE] === 0) queue.push([x, y - 1]);
      if (y < TILE_SIZE - 1 && visited[idx + TILE_SIZE] === 0)
        queue.push([x, y + 1]);
    }
  }

  return result;
}

/**
 * Encodes an 8x8 tile (64 pixels, values 0..3) into 16 planar NES CHR bytes.
 */
export function encodeChrTileFromPixels(pixels: Uint8Array): Uint8Array {
  validateTilePixels(pixels);
  const bytes = new Uint8Array(BYTES_PER_TILE);

  for (let row = 0; row < TILE_SIZE; row += 1) {
    let bitplane0 = 0;
    let bitplane1 = 0;
    const rowOffset = row * TILE_SIZE;

    for (let col = 0; col < TILE_SIZE; col += 1) {
      const colorIndex = pixels[rowOffset + col] ?? 0;
      const bit = 7 - col;
      bitplane0 |= (colorIndex & 0b01) << bit;
      bitplane1 |= ((colorIndex >> 1) & 0b01) << bit;
    }

    bytes[row] = bitplane0;
    bytes[row + TILE_SIZE] = bitplane1;
  }

  return bytes;
}

/**
 * Decodes 16 planar NES CHR bytes into an 8x8 tile (64 pixels, values 0..3).
 */
export function decodeChrTileToPixels(bytes: Uint8Array): Uint8Array {
  if (bytes.length !== BYTES_PER_TILE) {
    throw new RangeError(
      `CHR tile bytes must be exactly ${String(BYTES_PER_TILE)} bytes, got ${String(bytes.length)}.`,
    );
  }

  const pixels = new Uint8Array(PIXELS_PER_TILE);

  for (let row = 0; row < TILE_SIZE; row += 1) {
    const bitplane0 = bytes[row] ?? 0;
    const bitplane1 = bytes[row + TILE_SIZE] ?? 0;
    const rowOffset = row * TILE_SIZE;

    for (let col = 0; col < TILE_SIZE; col += 1) {
      const bit = 7 - col;
      pixels[rowOffset + col] =
        ((bitplane0 >> bit) & 1) | (((bitplane1 >> bit) & 1) << 1);
    }
  }

  return pixels;
}

/**
 * Checks whether two 64-pixel arrays are identical.
 */
export function areTilePixelsEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Generic Undo/Redo history manager.
 */
export interface TileHistoryManager<T> {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly depth: number;
  readonly currentState: T;
  pushState(nextState: T): void;
  undo(): T | null;
  redo(): T | null;
  clear(initialState: T): void;
  getUndoStack(): readonly T[];
  getRedoStack(): readonly T[];
}

export type TileHistory<T> = TileHistoryManager<T>;

export function createTileHistory<T>(
  initialState: T,
  maxDepth = DEFAULT_HISTORY_DEPTH,
  isEqual?: (a: T, b: T) => boolean,
): TileHistoryManager<T> {
  let current: T = initialState;
  const undoStack: T[] = [];
  const redoStack: T[] = [];

  const equalityFn = isEqual ?? ((a: T, b: T) => a === b);

  return {
    get canUndo(): boolean {
      return undoStack.length > 0;
    },
    get canRedo(): boolean {
      return redoStack.length > 0;
    },
    get depth(): number {
      return undoStack.length;
    },
    get currentState(): T {
      return current;
    },
    pushState(nextState: T): void {
      if (equalityFn(current, nextState)) {
        return;
      }
      undoStack.push(current);
      if (undoStack.length > maxDepth) {
        undoStack.shift();
      }
      redoStack.length = 0;
      current = nextState;
    },
    undo(): T | null {
      if (undoStack.length === 0) {
        return null;
      }
      const prev = undoStack.pop();
      if (prev === undefined) {
        return null;
      }
      redoStack.push(current);
      current = prev;
      return current;
    },
    redo(): T | null {
      if (redoStack.length === 0) {
        return null;
      }
      const next = redoStack.pop();
      if (next === undefined) {
        return null;
      }
      undoStack.push(current);
      current = next;
      return current;
    },
    clear(newInitialState: T): void {
      current = newInitialState;
      undoStack.length = 0;
      redoStack.length = 0;
    },
    getUndoStack(): readonly T[] {
      return [...undoStack];
    },
    getRedoStack(): readonly T[] {
      return [...redoStack];
    },
  };
}

/**
 * Internal CHR tile clipboard storage.
 * Retains an independent copy of 64 tile pixel color indices (0..3).
 */
let activeTileClipboard: Uint8Array | null = null;

export function copyTileToClipboard(pixels: Uint8Array): Uint8Array {
  validateTilePixels(pixels);
  activeTileClipboard = cloneTilePixels(pixels);
  return cloneTilePixels(activeTileClipboard);
}

export function pasteTileFromClipboard(): Uint8Array | null {
  if (!activeTileClipboard) {
    return null;
  }
  return cloneTilePixels(activeTileClipboard);
}

export function hasClipboardTile(): boolean {
  return activeTileClipboard !== null;
}

export function clearTileClipboard(): void {
  activeTileClipboard = null;
}

export function getClipboardTile(): Uint8Array | null {
  if (!activeTileClipboard) {
    return null;
  }
  return cloneTilePixels(activeTileClipboard);
}
