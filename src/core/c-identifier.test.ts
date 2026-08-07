import { describe, expect, it } from 'vitest';

import {
  combineCIdentifiers,
  isValidCIdentifier,
  normalizeCIdentifier,
} from './c-identifier';

describe('C identifier normalization', () => {
  it.each([
    ['soldier', 'soldier'],
    ['Soldier', 'soldier'],
    ['Soldier Idle', 'soldier_idle'],
    ['bee-bot', 'bee_bot'],
    ['Bee-Bot 01', 'bee_bot_01'],
    ['Boss #1', 'boss_1'],
    ['123player', '_123player'],
    ['static', 'static_animation'],
    ['multiple___underscores', 'multiple_underscores'],
    ['  Wizard', 'wizard'],
    ['Wizard  ', 'wizard'],
    ['ação rápida', 'acao_rapida'],
    ['---', ''],
    ['', ''],
  ])('normalizes %j as %j', (input, expected) => {
    expect(normalizeCIdentifier(input)).toBe(expected);
  });

  it('combines independently normalized prefix and animation names', () => {
    expect(combineCIdentifiers('Soldier', 'Idle')).toBe('soldier_idle');
    expect(combineCIdentifiers('Soldier', '123 Run')).toBe('soldier_123_run');
    expect(combineCIdentifiers('123 Soldier', 'Idle')).toBe(
      '_123_soldier_idle',
    );
    expect(combineCIdentifiers('---', 'Idle')).toBe('');
  });

  it.each(['soldier_idle', '_123player', 'static_animation'])(
    'produces a valid C identifier for %s',
    (identifier) => {
      expect(isValidCIdentifier(identifier)).toBe(true);
    },
  );
});
