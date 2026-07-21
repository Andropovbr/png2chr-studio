export function toChrFileName(fileName: string | null): string {
  if (fileName === null) {
    return 'image.chr';
  }

  const baseName = fileName.replace(/\.png$/i, '') || 'image';
  return `${baseName}.chr`;
}
