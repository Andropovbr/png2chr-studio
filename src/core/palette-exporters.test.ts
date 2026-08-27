import { describe, expect, it } from 'vitest';

import type { DualBankPaletteState } from './palette-manager';
import {
  exportBackgroundPaletteBinary,
  exportFullPpuPaletteBinary,
  exportSpritePaletteBinary,
  generateCa65PaletteExport,
  generateCPaletteExport,
} from './palette-exporters';

const state: DualBankPaletteState = {
  universalBackgroundColor: 0x2a,
  palettes: [
    {
      id: 'bg_0',
      name: 'Background Zero',
      colors: [0x00, 0x01, 0x11, 0x21],
      target: 'background',
    },
    {
      id: 'bg_3',
      name: 'Background Three',
      colors: [0x0f, 0x03, 0x13, 0x23],
      target: 'background',
    },
    {
      id: 'spr_0',
      name: 'Sprite Zero',
      colors: [0x0f, 0x05, 0x15, 0x25],
      target: 'sprite',
    },
    {
      id: 'spr_3',
      name: 'Sprite Three',
      colors: [0x0f, 0x0a, 0x1a, 0x2a],
      target: 'sprite',
    },
  ],
  activeBackgroundSlots: ['bg_0', null, 'missing_bg', 'bg_3'],
  activeSpriteSlots: ['spr_0', 'missing_spr', null, 'spr_3'],
};

const expectedBackground = [
  0x2a, 0x01, 0x11, 0x21, 0x2a, 0x06, 0x16, 0x26, 0x2a, 0x09, 0x19, 0x29, 0x2a,
  0x03, 0x13, 0x23,
];

const expectedSprites = [
  0x2a, 0x05, 0x15, 0x25, 0x2a, 0x06, 0x16, 0x26, 0x2a, 0x09, 0x19, 0x29, 0x2a,
  0x0a, 0x1a, 0x2a,
];

describe('palette exporters', () => {
  it('exports exactly 16 canonical Background bytes with universal color mirroring', () => {
    const bytes = exportBackgroundPaletteBinary(state);
    expect(bytes).toHaveLength(16);
    expect(Array.from(bytes)).toEqual(expectedBackground);
    expect([bytes[0], bytes[4], bytes[8], bytes[12]]).toEqual([
      0x2a, 0x2a, 0x2a, 0x2a,
    ]);
  });

  it('exports exactly 16 canonical Sprite bytes independently from Background', () => {
    const bytes = exportSpritePaletteBinary(state);
    expect(bytes).toHaveLength(16);
    expect(Array.from(bytes)).toEqual(expectedSprites);
    expect(bytes.slice(1, 4)).not.toEqual(
      exportBackgroundPaletteBinary(state).slice(1, 4),
    );
  });

  it('uses deterministic per-slot fallbacks for empty and dangling slots', () => {
    const background = exportBackgroundPaletteBinary(state);
    const sprites = exportSpritePaletteBinary(state);
    expect(Array.from(background.slice(4, 12))).toEqual([
      0x2a, 0x06, 0x16, 0x26, 0x2a, 0x09, 0x19, 0x29,
    ]);
    expect(Array.from(sprites.slice(4, 12))).toEqual([
      0x2a, 0x06, 0x16, 0x26, 0x2a, 0x09, 0x19, 0x29,
    ]);
  });

  it('exports exactly 32 bytes as Background followed by Sprite bytes', () => {
    const full = exportFullPpuPaletteBinary(state);
    const background = exportBackgroundPaletteBinary(state);
    const sprites = exportSpritePaletteBinary(state);
    expect(full).toHaveLength(32);
    expect(Array.from(full)).toEqual([
      ...expectedBackground,
      ...expectedSprites,
    ]);
    expect(full).toEqual(new Uint8Array([...background, ...sprites]));
  });

  it('does not mutate canonical state while exporting', () => {
    const before = JSON.stringify(state);
    exportBackgroundPaletteBinary(state);
    exportSpritePaletteBinary(state);
    exportFullPpuPaletteBinary(state);
    generateCPaletteExport(state);
    generateCa65PaletteExport(state);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('generates exact deterministic cc65 header and hexadecimal tables', () => {
    const result = generateCPaletteExport(state, {
      symbolBase: '9 Hero Stage!',
    });
    expect(result.headerFileName).toBe('_9_hero_stage.h');
    expect(result.sourceFileName).toBe('_9_hero_stage.c');
    expect(result.estimatedRomBytes).toBe(32);
    expect(result.header).toBe(`#ifndef _9_HERO_STAGE_H
#define _9_HERO_STAGE_H

#define _9_HERO_STAGE_BANK_SIZE 16
#define _9_HERO_STAGE_PPU_SIZE 32
#define _9_HERO_STAGE_BG_OFFSET 0
#define _9_HERO_STAGE_SPR_OFFSET 16
#define _9_HERO_STAGE_BG_SLOT_0_INDEX 0
#define _9_HERO_STAGE_BG_SLOT_1_INDEX 4
#define _9_HERO_STAGE_BG_SLOT_2_INDEX 8
#define _9_HERO_STAGE_BG_SLOT_3_INDEX 12
#define _9_HERO_STAGE_SPR_SLOT_0_INDEX 16
#define _9_HERO_STAGE_SPR_SLOT_1_INDEX 20
#define _9_HERO_STAGE_SPR_SLOT_2_INDEX 24
#define _9_HERO_STAGE_SPR_SLOT_3_INDEX 28

extern const unsigned char _9_hero_stage_bg[_9_HERO_STAGE_BANK_SIZE];
extern const unsigned char _9_hero_stage_spr[_9_HERO_STAGE_BANK_SIZE];

#endif
`);
    expect(result.source).toBe(`#include "_9_hero_stage.h"

/* Background Palette RAM ($3F00-$3F0F). */
const unsigned char _9_hero_stage_bg[_9_HERO_STAGE_BANK_SIZE] = {
    /* BG 0 ($3F00-$3F03) */ 0x2A, 0x01, 0x11, 0x21,
    /* BG 1 ($3F04-$3F07) */ 0x2A, 0x06, 0x16, 0x26,
    /* BG 2 ($3F08-$3F0B) */ 0x2A, 0x09, 0x19, 0x29,
    /* BG 3 ($3F0C-$3F0F) */ 0x2A, 0x03, 0x13, 0x23
};

/* Sprite Palette RAM ($3F10-$3F1F). Color 0 entries mirror $3F00. */
const unsigned char _9_hero_stage_spr[_9_HERO_STAGE_BANK_SIZE] = {
    /* SPR 0 ($3F10-$3F13) */ 0x2A, 0x05, 0x15, 0x25,
    /* SPR 1 ($3F14-$3F17) */ 0x2A, 0x06, 0x16, 0x26,
    /* SPR 2 ($3F18-$3F1B) */ 0x2A, 0x09, 0x19, 0x29,
    /* SPR 3 ($3F1C-$3F1F) */ 0x2A, 0x0A, 0x1A, 0x2A
};
`);
    expect(
      generateCPaletteExport(state, { symbolBase: '9 Hero Stage!' }),
    ).toEqual(result);
  });

  it('generates exact deterministic ca65 include and source tables', () => {
    const result = generateCa65PaletteExport(state, {
      symbolBase: 'boss palette',
      segment: 'PALETTES',
    });
    expect(result.includeFileName).toBe('boss_palette.inc');
    expect(result.sourceFileName).toBe('boss_palette.s');
    expect(result.estimatedRomBytes).toBe(32);
    expect(result.include).toContain('BOSS_PALETTE_PPU_SIZE = 32');
    expect(result.include).toContain('.import boss_palette_bg');
    expect(result.include).toContain('.import boss_palette_spr');
    expect(result.source).toBe(`; Generated by PNG2CHR Studio palette export.
.export boss_palette_bg
.export boss_palette_spr

.segment "PALETTES"

; Background Palette RAM ($3F00-$3F0F).
boss_palette_bg:
    .byte $2A, $01, $11, $21 ; BG 0 ($3F00-$3F03)
    .byte $2A, $06, $16, $26 ; BG 1 ($3F04-$3F07)
    .byte $2A, $09, $19, $29 ; BG 2 ($3F08-$3F0B)
    .byte $2A, $03, $13, $23 ; BG 3 ($3F0C-$3F0F)

; Sprite Palette RAM ($3F10-$3F1F). Color 0 entries mirror $3F00.
boss_palette_spr:
    .byte $2A, $05, $15, $25 ; SPR 0 ($3F10-$3F13)
    .byte $2A, $06, $16, $26 ; SPR 1 ($3F14-$3F17)
    .byte $2A, $09, $19, $29 ; SPR 2 ($3F18-$3F1B)
    .byte $2A, $0A, $1A, $2A ; SPR 3 ($3F1C-$3F1F)
`);
    expect(
      generateCa65PaletteExport(state, {
        symbolBase: 'boss palette',
        segment: 'PALETTES',
      }),
    ).toEqual(result);
  });
});
