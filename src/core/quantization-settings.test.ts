import { describe, expect, it } from 'vitest';
import {
  DEFAULT_QUANTIZATION_SETTINGS,
  QUANTIZATION_SETTINGS_STORAGE_KEY,
  loadQuantizationSettings,
  normalizeQuantizationSettings,
  saveQuantizationSettings,
  type SettingsStorage,
} from './quantization-settings';

class MemoryStorage implements SettingsStorage {
  private readonly values = new Map<string, string>();

  public getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  public setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe('quantization settings', () => {
  it('loads defaults from older configurations without quantization fields', () => {
    expect(normalizeQuantizationSettings({ version: 1 })).toEqual(
      DEFAULT_QUANTIZATION_SETTINGS,
    );
  });

  it('falls back safely when persisted modes are invalid', () => {
    expect(
      normalizeQuantizationSettings({
        quantizationMode: 'unknown',
        ditheringMode: 'random',
        colorDistanceMode: 'delta-z',
      }),
    ).toEqual(DEFAULT_QUANTIZATION_SETTINGS);
  });

  it('persists and restores valid settings', () => {
    const storage = new MemoryStorage();
    saveQuantizationSettings(storage, {
      quantizationMode: 'k-means',
      ditheringMode: 'bayer-4x4',
      colorDistanceMode: 'rgb',
    });
    expect(storage.getItem(QUANTIZATION_SETTINGS_STORAGE_KEY)).not.toBeNull();
    expect(loadQuantizationSettings(storage)).toEqual({
      quantizationMode: 'k-means',
      ditheringMode: 'bayer-4x4',
      colorDistanceMode: 'rgb',
    });
  });
});
