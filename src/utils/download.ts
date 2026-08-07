import { padChrRom } from '../core/chr-rom';

export function prepareBinaryDownload(
  bytes: Uint8Array,
  fileName: string,
): Uint8Array {
  return fileName.toLowerCase().endsWith('.chr') ? padChrRom(bytes) : bytes;
}

export function downloadBytes(bytes: Uint8Array, fileName: string): void {
  const prepared = prepareBinaryDownload(bytes, fileName);
  const buffer = new ArrayBuffer(prepared.byteLength);
  new Uint8Array(buffer).set(prepared);
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  queueMicrotask(() => {
    URL.revokeObjectURL(url);
  });
}

export function downloadText(text: string, fileName: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  queueMicrotask(() => {
    URL.revokeObjectURL(url);
  });
}
