import { describe, expect, it } from 'vitest';
import { LITE_THRESHOLD_MS, medianFrameMs } from './lite';

describe('lite guard', () => {
  it('median ignores a single long frame', () => {
    expect(medianFrameMs([16, 16, 16, 16, 200])).toBe(16);
  });
  it('slow machine trips the threshold', () => {
    expect(medianFrameMs([33, 34, 33, 40, 33])).toBeGreaterThan(LITE_THRESHOLD_MS);
  });
  it('empty is zero', () => expect(medianFrameMs([])).toBe(0));
});
