import { describe, expect, it } from 'vitest';

import {
  decideFrameDimensions,
  detectFrameGrid,
  type FrameDetectionResult,
} from './frame-detection';
import {
  frameGrid8x8Fixture,
  frameGrid16x16Fixture,
  frameGrid16x8Fixture,
  gutteredGrid16x8Fixture,
  irregularFixture,
  singleCell13x7Fixture,
  solidFixture,
} from './fixtures/frame-detection-fixtures';

describe('frame grid detection', () => {
  it('detects a 16 x 8 frame grid without gutters', () => {
    const result = detectFrameGrid(frameGrid16x8Fixture());

    expect(result.recommendedWidth).toBe(16);
    expect(result.recommendedHeight).toBe(8);
    expect(result.confidence).toBe('high');
  });

  it('detects a 2 x 2 grid of 16 x 16 frames without gutters', () => {
    const result = detectFrameGrid(frameGrid16x16Fixture());

    expect(result.recommendedWidth).toBe(16);
    expect(result.recommendedHeight).toBe(16);
    expect(result.confidence).toBe('high');
  });

  it('recommends the full 16 x 8 cell for a 13 x 7 sprite inside it', () => {
    const result = detectFrameGrid(singleCell13x7Fixture());

    expect(result.recommendedWidth).toBe(16);
    expect(result.recommendedHeight).toBe(8);
    expect(result.confidence).toBe('high');
  });

  it('uses transparent gutters to detect the frame grid', () => {
    const result = detectFrameGrid(gutteredGrid16x8Fixture());

    expect(result.recommendedWidth).toBe(16);
    expect(result.recommendedHeight).toBe(8);
    expect(result.confidence).toBe('high');
  });

  it('reports reduced confidence and multiple candidates for an ambiguous image', () => {
    const result = detectFrameGrid(solidFixture());

    expect(result.confidence).not.toBe('high');
    expect(result.candidates.length).toBeGreaterThan(1);
  });

  it('does not auto-apply a grid for an irregular sheet', () => {
    const result = detectFrameGrid(irregularFixture());

    expect(result.confidence).not.toBe('high');
  });

  it('applies a high-confidence detection over manual dimensions', () => {
    const manual = { width: 20, height: 20 };
    const detection: FrameDetectionResult = {
      recommendedWidth: 16,
      recommendedHeight: 8,
      confidence: 'high',
      candidates: [],
    };

    expect(
      decideFrameDimensions(manual.width, manual.height, detection),
    ).toEqual({
      width: 16,
      height: 8,
    });
  });

  it('preserves manual dimensions when no detection is available', () => {
    expect(decideFrameDimensions(20, 20, null)).toEqual({
      width: 20,
      height: 20,
    });
  });

  it('preserves manual dimensions when confidence is not high', () => {
    const detection: FrameDetectionResult = {
      recommendedWidth: 16,
      recommendedHeight: 8,
      confidence: 'medium',
      candidates: [],
    };

    expect(decideFrameDimensions(20, 20, detection)).toEqual({
      width: 20,
      height: 20,
    });
  });

  it('preserves manual dimensions when confidence is low', () => {
    const detection: FrameDetectionResult = {
      recommendedWidth: 32,
      recommendedHeight: 32,
      confidence: 'low',
      candidates: [],
    };

    expect(decideFrameDimensions(24, 24, detection)).toEqual({
      width: 24,
      height: 24,
    });
  });

  it('keeps manual override after low confidence detection on irregular sheet', () => {
    const irregularResult = detectFrameGrid(irregularFixture());
    expect(irregularResult.confidence).toBe('low');

    const customWidth = 24;
    const customHeight = 24;
    const resolved = decideFrameDimensions(
      customWidth,
      customHeight,
      irregularResult,
    );
    expect(resolved).toEqual({ width: 24, height: 24 });
  });

  it('re-detects when a new source image replaces the previous one', () => {
    const first = detectFrameGrid(frameGrid16x8Fixture());
    const second = detectFrameGrid(frameGrid8x8Fixture());

    expect(first.recommendedWidth).toBe(16);
    expect(first.recommendedHeight).toBe(8);
    expect(second.recommendedWidth).toBe(8);
    expect(second.recommendedHeight).toBe(8);

    const afterReload = decideFrameDimensions(20, 20, second);
    expect(afterReload).toEqual({ width: 8, height: 8 });
  });

  it('replaces detection correctly when replacing high-confidence source with low-confidence irregular source', () => {
    const regular = detectFrameGrid(frameGrid16x16Fixture());
    expect(regular.confidence).toBe('high');
    const appliedRegular = decideFrameDimensions(8, 8, regular);
    expect(appliedRegular).toEqual({ width: 16, height: 16 });

    // Source replaced with irregular sheet
    const irregular = detectFrameGrid(irregularFixture());
    expect(irregular.confidence).toBe('low');
    // Manual/current dimensions are preserved because confidence is not high
    const preserved = decideFrameDimensions(
      appliedRegular.width,
      appliedRegular.height,
      irregular,
    );
    expect(preserved).toEqual({ width: 16, height: 16 });
  });
});
