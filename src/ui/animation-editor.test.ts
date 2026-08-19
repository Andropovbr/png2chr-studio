import { describe, expect, it } from 'vitest';

import { buildAnimationProjectModel } from '../core/animation-model';
import type { IndexedImage } from '../core/types';
import { resolveAnimationSetting } from './animation-editor';
import type { AnimationItemSetting } from './types';

function singleTileImage(): IndexedImage {
  const pixels = new Uint8Array(64);
  pixels[0] = 1;
  return {
    width: 8,
    height: 8,
    pixels,
    colors: [null, null, null, null],
    transparentIndex: 0,
    colorCount: 4,
  };
}

describe('animation mapping identity', () => {
  it('resolves raw settings by stable id when the model name is composite', () => {
    const setting: AnimationItemSetting = {
      id: 'anim-walk',
      entity: 'hero',
      name: 'walk',
      source: null,
      frameWidth: 8,
      frameHeight: 8,
      originX: 0,
      originY: 0,
      playback: 'loop',
      allowHorizontalFlip: false,
      allowVerticalFlip: false,
      defaultDuration: 8,
      frameIndices: [0],
      frameDurations: [8],
    };
    const model = buildAnimationProjectModel({
      name: 'hero',
      animations: [
        {
          id: setting.id,
          name: 'hero_walk',
          image: singleTileImage(),
          frameWidth: setting.frameWidth,
          frameHeight: setting.frameHeight,
          frameIndices: setting.frameIndices,
          frameDuration: setting.defaultDuration,
        },
      ],
    });
    const animation = model.animations[0];

    expect(animation?.name).toBe('hero_walk');
    expect(animation?.id).toBe('anim-walk');
    expect(animation && resolveAnimationSetting([setting], animation)).toBe(
      setting,
    );
  });
});
