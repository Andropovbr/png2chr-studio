/// <reference lib="webworker" />

import { quantizeImageToNes } from '../core/image-quantization';
import type { QuantizationMode } from '../core/quantization-settings';
import type { QuantizationSettings } from '../core/quantization-settings';
import type { RgbColor } from '../core/types';

export interface QuantizationPreviewRequest {
  readonly id: number;
  readonly width: number;
  readonly height: number;
  readonly data: ArrayBuffer;
  readonly availableColors: readonly RgbColor[];
  readonly maximumColors: number;
  readonly settings: QuantizationSettings;
  readonly modes: readonly QuantizationMode[];
}

export interface QuantizationPreviewItem {
  readonly mode: QuantizationMode;
  readonly data: ArrayBuffer;
}

export type QuantizationPreviewResponse =
  | {
      readonly id: number;
      readonly width: number;
      readonly height: number;
      readonly previews: readonly QuantizationPreviewItem[];
    }
  | { readonly id: number; readonly error: string };

const worker = self as unknown as DedicatedWorkerGlobalScope;

worker.addEventListener(
  'message',
  (event: MessageEvent<QuantizationPreviewRequest>) => {
    const request = event.data;
    try {
      const source = {
        width: request.width,
        height: request.height,
        data: new Uint8ClampedArray(request.data),
      };
      const previews = request.modes.map((mode) => {
        const result = quantizeImageToNes(
          source,
          request.availableColors,
          request.maximumColors,
          { ...request.settings, quantizationMode: mode },
        );
        return {
          mode,
          data: new Uint8ClampedArray(result.image.data).buffer,
        };
      });
      const response: QuantizationPreviewResponse = {
        id: request.id,
        width: request.width,
        height: request.height,
        previews,
      };
      worker.postMessage(
        response,
        previews.map(({ data }) => data),
      );
    } catch (error: unknown) {
      const response: QuantizationPreviewResponse = {
        id: request.id,
        error: error instanceof Error ? error.message : 'preview-failed',
      };
      worker.postMessage(response);
    }
  },
);
