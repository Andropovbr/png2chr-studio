export interface PngFile {
  readonly type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type PngLoadFailure = 'read-failed' | 'decode-failed';

export type PngLoadResult<T> =
  | { readonly success: true; readonly image: T }
  | { readonly success: false; readonly failure: PngLoadFailure };

/**
 * Reads a PNG before decoding it so the UI can distinguish an unreadable file
 * from data that the browser cannot decode as an image.
 */
export async function readAndDecodePng<T>(
  file: PngFile,
  decode: (blob: Blob) => Promise<T>,
): Promise<PngLoadResult<T>> {
  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch {
    return { success: false, failure: 'read-failed' };
  }

  try {
    return {
      success: true,
      image: await decode(
        new Blob([bytes], { type: file.type || 'image/png' }),
      ),
    };
  } catch {
    return { success: false, failure: 'decode-failed' };
  }
}
