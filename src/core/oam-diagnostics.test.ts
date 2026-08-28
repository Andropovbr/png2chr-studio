import { describe, expect, it } from 'vitest';
import type {
  AnimationFrameModel,
  AnimationProjectModel,
} from './animation-model';
import {
  analyzeAnimationOamCapacity,
  countOamEntriesForFrame,
  NES_OAM_ENTRY_CAPACITY,
  NES_OAM_PRESSURE_THRESHOLD,
} from './oam-diagnostics';

function frame(spriteCount: number, sourceIndex = 0): AnimationFrameModel {
  return {
    sprites: Array.from({ length: spriteCount }, () => ({})),
    sourceIndex,
  } as unknown as AnimationFrameModel;
}

function model(frames: readonly AnimationFrameModel[]): AnimationProjectModel {
  return {
    animations: [
      {
        id: 'anim_hero',
        name: 'Hero Idle',
        frames,
      },
    ],
  } as unknown as AnimationProjectModel;
}

describe('OAM capacity diagnostics', () => {
  it('counts one OAM entry per generated sprite in a frame', () => {
    expect(countOamEntriesForFrame(frame(7))).toBe(7);
  });

  it.each([
    [NES_OAM_PRESSURE_THRESHOLD, 0, null],
    [NES_OAM_PRESSURE_THRESHOLD + 1, 1, 'oam-capacity-pressure'],
    [NES_OAM_ENTRY_CAPACITY, 1, 'oam-capacity-pressure'],
    [NES_OAM_ENTRY_CAPACITY + 1, 1, 'oam-capacity-exceeded'],
  ] as const)('classifies boundary count %s', (count, expectedLength, kind) => {
    const facts = analyzeAnimationOamCapacity(model([frame(count)]));
    expect(facts).toHaveLength(expectedLength);
    expect(facts[0]?.kind ?? null).toBe(kind);
    expect(facts[0]?.spriteCount ?? null).toBe(kind === null ? null : count);
  });

  it('emits one diagnostic per affected frame and remains deterministic', () => {
    const frames = [frame(33, 2), frame(65, 4), frame(33, 6)];
    const first = analyzeAnimationOamCapacity(model(frames));
    const second = analyzeAnimationOamCapacity(model(frames));

    expect(second).toEqual(first);
    expect(first).toHaveLength(3);
    expect(new Set(first.map((fact) => fact.id)).size).toBe(first.length);
    expect(first.map((fact) => fact.severity)).toEqual([
      'warning',
      'error',
      'warning',
    ]);
  });

  it('does not emit a second fact for a frame that exceeds both thresholds', () => {
    const facts = analyzeAnimationOamCapacity(model([frame(65)]));
    expect(facts.filter((fact) => fact.frameIndex === 0)).toHaveLength(1);
    expect(facts[0]?.kind).toBe('oam-capacity-exceeded');
  });
});
