function toOutputFileName(fileName: string | null, extension: string): string {
  if (fileName === null) {
    return `image.${extension}`;
  }

  const baseName = fileName.replace(/\.png$/i, '') || 'image';
  return `${baseName}.${extension}`;
}

export function toChrFileName(fileName: string | null): string {
  return toOutputFileName(fileName, 'chr');
}

export function toNametableFileName(fileName: string | null): string {
  return toOutputFileName(fileName, 'nam');
}

export function toAttributeTableFileName(fileName: string | null): string {
  return toOutputFileName(fileName, 'atr');
}

export function toCollisionMapFileName(fileName: string | null): string {
  return toOutputFileName(fileName, 'col');
}

export function toPaletteFileName(fileName: string | null): string {
  return toOutputFileName(fileName, 'pal');
}
