import { COLOR_DISTANCE_MODES, type ColorDistanceMode } from './color-distance';

export const QUANTIZATION_MODES = ['nearest', 'median-cut', 'k-means'] as const;
export const DITHERING_MODES = [
  'none',
  'floyd-steinberg',
  'atkinson',
  'bayer-4x4',
  'bayer-8x8',
] as const;

export type QuantizationMode = (typeof QUANTIZATION_MODES)[number];
export type DitheringMode = (typeof DITHERING_MODES)[number];

export interface QuantizationSettings {
  readonly quantizationMode: QuantizationMode;
  readonly ditheringMode: DitheringMode;
  readonly colorDistanceMode: ColorDistanceMode;
}

export const DEFAULT_QUANTIZATION_SETTINGS: QuantizationSettings = {
  quantizationMode: 'median-cut',
  ditheringMode: 'none',
  colorDistanceMode: 'perceptual',
};

function isOneOf<T extends string>(
  value: unknown,
  choices: readonly T[],
): value is T {
  return typeof value === 'string' && choices.includes(value as T);
}

export function normalizeQuantizationSettings(
  value: unknown,
): QuantizationSettings {
  const candidate =
    typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : {};
  return {
    quantizationMode: isOneOf(candidate.quantizationMode, QUANTIZATION_MODES)
      ? candidate.quantizationMode
      : DEFAULT_QUANTIZATION_SETTINGS.quantizationMode,
    ditheringMode: isOneOf(candidate.ditheringMode, DITHERING_MODES)
      ? candidate.ditheringMode
      : DEFAULT_QUANTIZATION_SETTINGS.ditheringMode,
    colorDistanceMode: isOneOf(
      candidate.colorDistanceMode,
      COLOR_DISTANCE_MODES,
    )
      ? candidate.colorDistanceMode
      : DEFAULT_QUANTIZATION_SETTINGS.colorDistanceMode,
  };
}

export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const QUANTIZATION_SETTINGS_STORAGE_KEY =
  'png2chr-studio.quantization-settings.v1';

export function loadQuantizationSettings(
  storage: SettingsStorage | null,
): QuantizationSettings {
  if (storage === null) return DEFAULT_QUANTIZATION_SETTINGS;
  try {
    const stored = storage.getItem(QUANTIZATION_SETTINGS_STORAGE_KEY);
    return normalizeQuantizationSettings(
      stored === null ? undefined : JSON.parse(stored),
    );
  } catch {
    return DEFAULT_QUANTIZATION_SETTINGS;
  }
}

export function saveQuantizationSettings(
  storage: SettingsStorage | null,
  settings: QuantizationSettings,
): void {
  if (storage === null) return;
  try {
    storage.setItem(
      QUANTIZATION_SETTINGS_STORAGE_KEY,
      JSON.stringify(normalizeQuantizationSettings(settings)),
    );
  } catch {
    // Storage may be unavailable in private or restricted browser contexts.
  }
}
