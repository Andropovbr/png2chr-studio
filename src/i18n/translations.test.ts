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

  it('provides translations for CHR region and reservation visualization in English and Portuguese', () => {
    expect(translations.en.chrTileInspectorRegionLabel).toBe('Region');
    expect(translations['pt-BR'].chrTileInspectorRegionLabel).toBe('Região');
    expect(translations.en.chrTileInspectorReservationLabel).toBe(
      'Reservation',
    );
    expect(translations['pt-BR'].chrTileInspectorReservationLabel).toBe(
      'Reserva',
    );
    expect(translations.en.chrWorkspaceLegendReserved).toBe('Reserved');
    expect(translations['pt-BR'].chrWorkspaceLegendReserved).toBe('Reservado');
    expect(translations.en.chrWorkspaceLegendRegion).toBe('Region');
    expect(translations['pt-BR'].chrWorkspaceLegendRegion).toBe('Região');
  });

  it('provides translations for CHR Region Manager panel and form in English and Portuguese', () => {
    expect(translations.en.chrRegionManagerSectionTitle).toBe(
      'CHR Regions & Reservations',
    );
    expect(translations['pt-BR'].chrRegionManagerSectionTitle).toBe(
      'Regiões e Reservas de CHR',
    );
    expect(translations.en.chrRegionManagerAddAction).toBe('+ New Region');
    expect(translations['pt-BR'].chrRegionManagerAddAction).toBe(
      '+ Nova Região',
    );
    expect(translations.en.chrRegionManagerActionSave).toBe('Save');
    expect(translations['pt-BR'].chrRegionManagerActionSave).toBe('Salvar');
    expect(translations.en.chrRegionManagerActionCancel).toBe('Cancel');
    expect(translations['pt-BR'].chrRegionManagerActionCancel).toBe('Cancelar');
    expect(translations.en.chrRegionManagerValStartInvalid).toContain(
      'Invalid start tile',
    );
    expect(translations['pt-BR'].chrRegionManagerValStartInvalid).toContain(
      'Tile inicial inválido',
    );
    expect(translations.en.chrRegionManagerDeleteRegionConfirm).toContain(
      'Remove organizational Region',
    );
    expect(translations['pt-BR'].chrRegionManagerDeleteRegionConfirm).toContain(
      'Remover a região organizacional',
    );
    expect(translations.en.chrRegionManagerDeleteReservationConfirm).toContain(
      'Slots previously protected from automatic allocation',
    );
    expect(
      translations['pt-BR'].chrRegionManagerDeleteReservationConfirm,
    ).toContain('Slots anteriormente protegidos contra alocação automática');
  });
});
