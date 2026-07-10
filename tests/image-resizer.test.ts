import { describe, expect, it } from 'vitest';
import {
  calculateResizeDimensions,
  createOutputFilename,
  MAX_PIXEL_AREA,
} from '../src/features/image-resizer/resize-policy';

describe('calculateResizeDimensions', () => {
  it('leaves an image within the limit unchanged', () => {
    expect(calculateResizeDimensions(320, 200)).toEqual({
      width: 320,
      height: 200,
      pixelArea: 64_000,
      resized: false,
    });
  });

  it('downscales proportionally without exceeding 100,000 pixels', () => {
    const result = calculateResizeDimensions(2_000, 1_000);

    expect(result).toEqual({
      width: 447,
      height: 223,
      pixelArea: 99_681,
      resized: true,
    });
    expect(result.pixelArea).toBeLessThanOrEqual(MAX_PIXEL_AREA);
    expect(result.width / result.height).toBeCloseTo(2, 2);
  });

  it('enforces the area limit for an extreme aspect ratio', () => {
    const result = calculateResizeDimensions(1_000_000_000, 1);

    expect(result).toEqual({
      width: 100_000,
      height: 1,
      pixelArea: 100_000,
      resized: true,
    });
  });

  it('rejects invalid source dimensions', () => {
    expect(() => calculateResizeDimensions(0, 100)).toThrow(RangeError);
    expect(() => calculateResizeDimensions(Number.NaN, 100)).toThrow(RangeError);
    expect(() => calculateResizeDimensions(10.5, 100)).toThrow(RangeError);
  });
});

describe('createOutputFilename', () => {
  it('retains the source stem and changes the output extension', () => {
    expect(createOutputFilename('Observation.final.jpeg')).toBe('Observation.final-100k.png');
  });

  it('uses a stable fallback for an empty source name', () => {
    expect(createOutputFilename('  ')).toBe('image-100k.png');
  });
});
