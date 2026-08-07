export const NES_CHR_ROM_MINIMUM_SIZE = 8 * 1024;

export function padChrRom(bytes: Uint8Array): Uint8Array {
  if (bytes.length >= NES_CHR_ROM_MINIMUM_SIZE) return bytes;
  const padded = new Uint8Array(NES_CHR_ROM_MINIMUM_SIZE);
  padded.set(bytes);
  return padded;
}
