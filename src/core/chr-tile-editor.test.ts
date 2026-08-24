import { describe, expect, it } from 'vitest';
import {
  areTilePixelsEqual,
  clearTile,
  clearTileClipboard,
  cloneTilePixels,
  copyTileToClipboard,
  createEmptyTilePixels,
  createTileHistory,
  decodeChrTileToPixels,
  encodeChrTileFromPixels,
  flipTileHorizontal,
  flipTileVertical,
  floodFillTile,
  getClipboardTile,
  hasClipboardTile,
  pasteTileFromClipboard,
  rotateTile90,
  setTilePixel,
  shiftTile,
  validateTilePixels,
  BYTES_PER_TILE,
  PIXELS_PER_TILE,
} from './chr-tile-editor';
import { decodeChrTile } from './chr-decoder';
import { encodeTile } from './chr-encoder';

describe('chr-tile-editor domain operations', () => {
  describe('validateTilePixels', () => {
    it('accepts a valid 64-pixel buffer with values 0..3', () => {
      const pixels = new Uint8Array(64);
      pixels[0] = 1;
      pixels[10] = 2;
      pixels[63] = 3;
      expect(() => {
        validateTilePixels(pixels);
      }).not.toThrow();
    });

    it('throws RangeError if buffer length is not 64', () => {
      expect(() => {
        validateTilePixels(new Uint8Array(63));
      }).toThrow(RangeError);
      expect(() => {
        validateTilePixels(new Uint8Array(65));
      }).toThrow(RangeError);
    });

    it('throws RangeError if any pixel value is greater than 3', () => {
      const pixels = new Uint8Array(64);
      pixels[5] = 4;
      expect(() => {
        validateTilePixels(pixels);
      }).toThrow(RangeError);
    });
  });

  describe('createEmptyTilePixels & cloneTilePixels', () => {
    it('creates a 64-pixel buffer filled with 0 by default', () => {
      const pixels = createEmptyTilePixels();
      expect(pixels.length).toBe(PIXELS_PER_TILE);
      expect(pixels.every((p) => p === 0)).toBe(true);
    });

    it('creates a buffer filled with specified color index 0..3', () => {
      const pixels = createEmptyTilePixels(2);
      expect(pixels.every((p) => p === 2)).toBe(true);
    });

    it('clones a buffer creating an independent copy', () => {
      const original = createEmptyTilePixels(1);
      original[0] = 3;
      const clone = cloneTilePixels(original);
      expect(clone).toEqual(original);
      clone[0] = 0;
      expect(original[0]).toBe(3);
    });
  });

  describe('setTilePixel', () => {
    it('immutably sets a single pixel at (x, y)', () => {
      const original = createEmptyTilePixels(0);
      const modified = setTilePixel(original, 3, 4, 2);
      expect(original[4 * 8 + 3]).toBe(0);
      expect(modified[4 * 8 + 3]).toBe(2);
    });

    it('clamps color index to 0..3', () => {
      const original = createEmptyTilePixels(0);
      const modified = setTilePixel(original, 0, 0, 10);
      expect(modified[0]).toBe(3);
    });

    it('throws RangeError for out of bounds coordinates', () => {
      const pixels = createEmptyTilePixels(0);
      expect(() => {
        setTilePixel(pixels, -1, 0, 1);
      }).toThrow(RangeError);
      expect(() => {
        setTilePixel(pixels, 8, 0, 1);
      }).toThrow(RangeError);
      expect(() => {
        setTilePixel(pixels, 0, -1, 1);
      }).toThrow(RangeError);
      expect(() => {
        setTilePixel(pixels, 0, 8, 1);
      }).toThrow(RangeError);
    });
  });

  describe('flipTileHorizontal', () => {
    it('mirrors an 8x8 tile horizontally', () => {
      const pixels = createEmptyTilePixels(0);
      // Set pixel at (1, 2)
      pixels[2 * 8 + 1] = 3;
      const flipped = flipTileHorizontal(pixels);
      // Flipped should be at (7 - 1, 2) = (6, 2)
      expect(flipped[2 * 8 + 6]).toBe(3);
      expect(flipped[2 * 8 + 1]).toBe(0);
    });

    it('double horizontal flip returns original tile', () => {
      const original = createEmptyTilePixels(0);
      for (let i = 0; i < 64; i += 1) {
        original[i] = (i * 7) % 4;
      }
      const doubleFlipped = flipTileHorizontal(flipTileHorizontal(original));
      expect(doubleFlipped).toEqual(original);
    });
  });

  describe('flipTileVertical', () => {
    it('mirrors an 8x8 tile vertically', () => {
      const pixels = createEmptyTilePixels(0);
      // Set pixel at (3, 1)
      pixels[1 * 8 + 3] = 2;
      const flipped = flipTileVertical(pixels);
      // Flipped should be at (3, 7 - 1) = (3, 6)
      expect(flipped[6 * 8 + 3]).toBe(2);
      expect(flipped[1 * 8 + 3]).toBe(0);
    });

    it('double vertical flip returns original tile', () => {
      const original = createEmptyTilePixels(0);
      for (let i = 0; i < 64; i += 1) {
        original[i] = (i * 13) % 4;
      }
      const doubleFlipped = flipTileVertical(flipTileVertical(original));
      expect(doubleFlipped).toEqual(original);
    });
  });

  describe('shiftTile', () => {
    it('shifts tile up with empty padding or wrap', () => {
      const pixels = createEmptyTilePixels(0);
      pixels[3 * 8 + 2] = 1; // row 3, col 2
      pixels[0 * 8 + 5] = 2; // row 0, col 5

      const shiftedNoWrap = shiftTile(pixels, 'up', false);
      // Row 3 moves to Row 2
      expect(shiftedNoWrap[2 * 8 + 2]).toBe(1);
      // Row 0 shifted off the top is lost
      expect(shiftedNoWrap[7 * 8 + 5]).toBe(0);

      const shiftedWrap = shiftTile(pixels, 'up', true);
      expect(shiftedWrap[2 * 8 + 2]).toBe(1);
      // Row 0 wraps to Row 7
      expect(shiftedWrap[7 * 8 + 5]).toBe(2);
    });

    it('shifts tile down with empty padding or wrap', () => {
      const pixels = createEmptyTilePixels(0);
      pixels[2 * 8 + 4] = 3; // row 2, col 4
      pixels[7 * 8 + 1] = 2; // row 7, col 1

      const shiftedNoWrap = shiftTile(pixels, 'down', false);
      // Row 2 moves to Row 3
      expect(shiftedNoWrap[3 * 8 + 4]).toBe(3);
      // Row 7 shifted off bottom is lost
      expect(shiftedNoWrap[0 * 8 + 1]).toBe(0);

      const shiftedWrap = shiftTile(pixels, 'down', true);
      expect(shiftedWrap[3 * 8 + 4]).toBe(3);
      // Row 7 wraps to Row 0
      expect(shiftedWrap[0 * 8 + 1]).toBe(2);
    });

    it('shifts tile left with empty padding or wrap', () => {
      const pixels = createEmptyTilePixels(0);
      pixels[4 * 8 + 3] = 2; // row 4, col 3
      pixels[1 * 8 + 0] = 3; // row 1, col 0

      const shiftedNoWrap = shiftTile(pixels, 'left', false);
      expect(shiftedNoWrap[4 * 8 + 2]).toBe(2);
      expect(shiftedNoWrap[1 * 8 + 7]).toBe(0);

      const shiftedWrap = shiftTile(pixels, 'left', true);
      expect(shiftedWrap[4 * 8 + 2]).toBe(2);
      expect(shiftedWrap[1 * 8 + 7]).toBe(3);
    });

    it('shifts tile right with empty padding or wrap', () => {
      const pixels = createEmptyTilePixels(0);
      pixels[5 * 8 + 2] = 1; // row 5, col 2
      pixels[2 * 8 + 7] = 2; // row 2, col 7

      const shiftedNoWrap = shiftTile(pixels, 'right', false);
      expect(shiftedNoWrap[5 * 8 + 3]).toBe(1);
      expect(shiftedNoWrap[2 * 8 + 0]).toBe(0);

      const shiftedWrap = shiftTile(pixels, 'right', true);
      expect(shiftedWrap[5 * 8 + 3]).toBe(1);
      expect(shiftedWrap[2 * 8 + 0]).toBe(2);
    });
  });

  describe('rotateTile90', () => {
    it('rotates tile 90 degrees clockwise', () => {
      const pixels = createEmptyTilePixels(0);
      // Top-left pixel (0, 0) should rotate to top-right (7, 0)
      pixels[0 * 8 + 0] = 3;
      // Top-right pixel (7, 0) should rotate to bottom-right (7, 7)
      pixels[0 * 8 + 7] = 2;

      const rotated = rotateTile90(pixels, true);
      expect(rotated[0 * 8 + 7]).toBe(3); // (7, 0)
      expect(rotated[7 * 8 + 7]).toBe(2); // (7, 7)
    });

    it('four 90 degree clockwise rotations return original tile', () => {
      const original = createEmptyTilePixels(0);
      for (let i = 0; i < 64; i += 1) {
        original[i] = (i * 11) % 4;
      }
      let r = original;
      for (let step = 0; step < 4; step += 1) {
        r = rotateTile90(r, true);
      }
      expect(r).toEqual(original);
    });

    it('rotates tile 90 degrees counter-clockwise', () => {
      const pixels = createEmptyTilePixels(0);
      pixels[0 * 8 + 0] = 3; // (0, 0) -> rotates to bottom-left (0, 7)
      const rotated = rotateTile90(pixels, false);
      expect(rotated[7 * 8 + 0]).toBe(3);
    });
  });

  describe('clearTile', () => {
    it('clears all pixels to 0 by default or to specified index', () => {
      const pixels = createEmptyTilePixels(3);
      const cleared0 = clearTile(pixels, 0);
      expect(cleared0.every((p) => p === 0)).toBe(true);

      const cleared1 = clearTile(pixels, 1);
      expect(cleared1.every((p) => p === 1)).toBe(true);
    });
  });

  describe('floodFillTile', () => {
    it('fills contiguous 4-connected region', () => {
      const pixels = createEmptyTilePixels(0);
      // Create a small 2x2 box of color 1
      pixels[1 * 8 + 1] = 1;
      pixels[1 * 8 + 2] = 1;
      pixels[2 * 8 + 1] = 1;
      pixels[2 * 8 + 2] = 1;

      const filled = floodFillTile(pixels, 1, 1, 3);
      expect(filled[1 * 8 + 1]).toBe(3);
      expect(filled[1 * 8 + 2]).toBe(3);
      expect(filled[2 * 8 + 1]).toBe(3);
      expect(filled[2 * 8 + 2]).toBe(3);
      // Surrounding pixels remain 0
      expect(filled[0 * 8 + 0]).toBe(0);
      expect(filled[3 * 8 + 3]).toBe(0);
    });

    it('does not fill past diagonal barriers', () => {
      const pixels = createEmptyTilePixels(0);
      // Diagonal line
      pixels[0 * 8 + 0] = 2;
      pixels[1 * 8 + 1] = 2;
      pixels[2 * 8 + 2] = 2;

      const filled = floodFillTile(pixels, 0, 1, 1);
      expect(filled[0 * 8 + 1]).toBe(1);
      // The diagonal pixels remain 2
      expect(filled[0 * 8 + 0]).toBe(2);
      expect(filled[1 * 8 + 1]).toBe(2);
    });

    it('returns copy if start point is out of bounds or already target color', () => {
      const pixels = createEmptyTilePixels(1);
      const filledSame = floodFillTile(pixels, 2, 2, 1);
      expect(filledSame).toEqual(pixels);

      const filledOutOfBounds = floodFillTile(pixels, 10, 10, 2);
      expect(filledOutOfBounds).toEqual(pixels);
    });
  });

  describe('encodeChrTileFromPixels & decodeChrTileToPixels', () => {
    it('encodes and decodes 8x8 tile pixels with 100% round-trip fidelity', () => {
      const pixels = createEmptyTilePixels(0);
      for (let i = 0; i < 64; i += 1) {
        pixels[i] = (i * 3 + 1) % 4;
      }

      const bytes = encodeChrTileFromPixels(pixels);
      expect(bytes.length).toBe(BYTES_PER_TILE);

      const decoded = decodeChrTileToPixels(bytes);
      expect(decoded).toEqual(pixels);
    });

    it('matches output of canonical chr-encoder and chr-decoder', () => {
      const pixels = new Uint8Array(64);
      pixels[0] = 1; // bitplane 0 bit 7
      pixels[1] = 2; // bitplane 1 bit 6
      pixels[2] = 3; // bitplane 0 bit 5 & bitplane 1 bit 5

      const bytes = encodeChrTileFromPixels(pixels);
      const canonicalBytes = encodeTile({
        id: 0,
        column: 0,
        row: 0,
        pixels,
      });
      expect(bytes).toEqual(canonicalBytes);

      const decodedCanonical = decodeChrTile(bytes);
      expect(decodeChrTileToPixels(bytes)).toEqual(decodedCanonical.pixels);
    });

    it('throws RangeError if decode buffer is not 16 bytes', () => {
      expect(() => {
        decodeChrTileToPixels(new Uint8Array(15));
      }).toThrow(RangeError);
      expect(() => {
        decodeChrTileToPixels(new Uint8Array(17));
      }).toThrow(RangeError);
    });
  });

  describe('areTilePixelsEqual', () => {
    it('compares two 64-pixel buffers accurately', () => {
      const a = createEmptyTilePixels(1);
      const b = createEmptyTilePixels(1);
      expect(areTilePixelsEqual(a, b)).toBe(true);

      b[10] = 2;
      expect(areTilePixelsEqual(a, b)).toBe(false);
    });
  });

  describe('createTileHistory (Undo / Redo)', () => {
    it('tracks state pushes, undos, and redos', () => {
      const state0 = createEmptyTilePixels(0);
      const history = createTileHistory(state0, 10, areTilePixelsEqual);

      expect(history.canUndo).toBe(false);
      expect(history.canRedo).toBe(false);
      expect(history.depth).toBe(0);

      const state1 = setTilePixel(state0, 0, 0, 1);
      history.pushState(state1);

      expect(history.canUndo).toBe(true);
      expect(history.canRedo).toBe(false);
      expect(history.depth).toBe(1);
      expect(history.currentState).toEqual(state1);

      const state2 = setTilePixel(state1, 1, 1, 2);
      history.pushState(state2);
      expect(history.depth).toBe(2);

      // Undo state2 -> state1
      const undone1 = history.undo();
      expect(undone1).toEqual(state1);
      expect(history.canUndo).toBe(true);
      expect(history.canRedo).toBe(true);
      expect(history.currentState).toEqual(state1);

      // Undo state1 -> state0
      const undone0 = history.undo();
      expect(undone0).toEqual(state0);
      expect(history.canUndo).toBe(false);
      expect(history.canRedo).toBe(true);

      // Redo state0 -> state1
      const redone1 = history.redo();
      expect(redone1).toEqual(state1);
      expect(history.canUndo).toBe(true);

      // Redo state1 -> state2
      const redone2 = history.redo();
      expect(redone2).toEqual(state2);
      expect(history.canRedo).toBe(false);
    });

    it('ignores push of identical state', () => {
      const state0 = createEmptyTilePixels(0);
      const history = createTileHistory(state0, 10, areTilePixelsEqual);

      history.pushState(createEmptyTilePixels(0));
      expect(history.depth).toBe(0);
      expect(history.canUndo).toBe(false);
    });

    it('clears redo stack on new push after undo', () => {
      const history = createTileHistory(0, 10);
      history.pushState(1);
      history.pushState(2);
      history.undo(); // now at 1, redo has [2]
      expect(history.canRedo).toBe(true);

      history.pushState(3); // pushes 3, clears redo
      expect(history.canRedo).toBe(false);
      expect(history.currentState).toBe(3);
    });

    it('enforces maxDepth limit by shifting oldest states', () => {
      const history = createTileHistory(0, 3);
      history.pushState(1);
      history.pushState(2);
      history.pushState(3);
      history.pushState(4); // exceeds maxDepth=3

      expect(history.depth).toBe(3);
      expect(history.getUndoStack()).toEqual([1, 2, 3]);
    });

    it('clears history completely with new initial state', () => {
      const history = createTileHistory(0, 10);
      history.pushState(1);
      history.pushState(2);

      history.clear(100);
      expect(history.currentState).toBe(100);
      expect(history.canUndo).toBe(false);
      expect(history.canRedo).toBe(false);
      expect(history.depth).toBe(0);
    });
  });

  describe('clipboard storage', () => {
    it('stores, pastes, and clears independent tile buffers', () => {
      clearTileClipboard();
      expect(hasClipboardTile()).toBe(false);
      expect(pasteTileFromClipboard()).toBeNull();
      expect(getClipboardTile()).toBeNull();

      const pixels = createEmptyTilePixels(1);
      pixels[0] = 3;

      const copied = copyTileToClipboard(pixels);
      expect(hasClipboardTile()).toBe(true);
      expect(copied[0]).toBe(3);

      // Mutating source buffer does not affect clipboard
      pixels[0] = 0;
      const pasted = pasteTileFromClipboard();
      expect(pasted).not.toBeNull();
      expect(pasted?.[0]).toBe(3);

      // Mutating pasted buffer does not affect clipboard
      if (pasted) {
        pasted[0] = 1;
      }
      const pastedAgain = pasteTileFromClipboard();
      expect(pastedAgain?.[0]).toBe(3);

      clearTileClipboard();
      expect(hasClipboardTile()).toBe(false);
      expect(pasteTileFromClipboard()).toBeNull();
    });
  });
});
