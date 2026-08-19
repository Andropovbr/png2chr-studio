import { describe, expect, it } from 'vitest';
import { readAndDecodePng } from './png-load';

describe('readAndDecodePng', () => {
  const validFile = {
    type: 'image/png',
    arrayBuffer: () =>
      Promise.resolve(new Uint8Array([137, 80, 78, 71]).buffer),
  };

  it('returns the decoded image for a valid PNG', async () => {
    const result = await readAndDecodePng(validFile, () =>
      Promise.resolve('decoded'),
    );

    expect(result).toEqual({ success: true, image: 'decoded' });
  });

  it('reports file-read failures distinctly', async () => {
    const result = await readAndDecodePng(
      { type: 'image/png', arrayBuffer: () => Promise.reject(new Error()) },
      () => Promise.resolve('decoded'),
    );

    expect(result).toEqual({ success: false, failure: 'read-failed' });
  });

  it('reports corrupt or undecodable PNG data without returning an image', async () => {
    const result = await readAndDecodePng(validFile, () =>
      Promise.reject(new Error('invalid PNG')),
    );

    expect(result).toEqual({ success: false, failure: 'decode-failed' });
  });

  it('can decode a valid PNG after a failed attempt', async () => {
    const failed = await readAndDecodePng(validFile, () =>
      Promise.reject(new Error('invalid PNG')),
    );
    const succeeded = await readAndDecodePng(validFile, () =>
      Promise.resolve('decoded'),
    );

    expect(failed.success).toBe(false);
    expect(succeeded).toEqual({ success: true, image: 'decoded' });
  });
});
