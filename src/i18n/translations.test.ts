import { describe, expect, it } from 'vitest';

import { detectLocale } from './index';
import { translations } from './translations';

describe('translations', () => {
  it('keeps the same keys in Portuguese and English', () => {
    expect(Object.keys(translations['pt-BR']).sort()).toEqual(
      Object.keys(translations.en).sort(),
    );
  });

  it('detects Portuguese variants and defaults other languages to English', () => {
    expect(detectLocale('pt-PT')).toBe('pt-BR');
    expect(detectLocale('en-US')).toBe('en');
    expect(detectLocale('es')).toBe('en');
  });

  it('describes base CHR occupancy separately from physical capacity', () => {
    expect(translations.en.animationDestinationDetails).toContain(
      '{occupied} occupied / {capacity} slots',
    );
    expect(translations['pt-BR'].animationDestinationDetails).toContain(
      '{occupied} ocupados / {capacity} slots',
    );
  });
});
