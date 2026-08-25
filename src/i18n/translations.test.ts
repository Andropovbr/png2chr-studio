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

  it('provides translations for CHR region diagnostics in English and Portuguese', () => {
    expect(translations.en.chrRegionOverlapRegion).toContain(
      'Regions "{nameA}" and "{nameB}" overlap on PT{patternTable} at {range}.',
    );
    expect(translations['pt-BR'].chrRegionOverlapRegion).toContain(
      'As regiões "{nameA}" e "{nameB}" se sobrepõem na PT{patternTable} em {range}.',
    );

    expect(translations.en.chrReservationContainsOccupiedSingle).toContain(
      'Reservation "{name}" contains {count} existing tile at PT{patternTable}:{range}.',
    );
    expect(
      translations['pt-BR'].chrReservationContainsOccupiedMultiple,
    ).toContain(
      'A reserva "{name}" contém {count} tiles existentes em PT{patternTable}:{range}.',
    );

    expect(translations.en.chrPatternTableExhausted).toContain(
      'Pattern Table {patternTable} has no available slots for allocation',
    );
    expect(translations['pt-BR'].chrPatternTableExhausted).toContain(
      'A Pattern Table {patternTable} não possui slots disponíveis para alocação',
    );
  });
});
