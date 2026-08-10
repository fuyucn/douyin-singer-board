import { describe, expect, it } from 'vitest';
import { compareFullSemver } from './updater';

describe('compareFullSemver', () => {
  it('orders susu custom builds by their numeric counter', () => {
    expect(compareFullSemver('0.41.0-susu.1', '0.41.0-susu.2')).toBeLessThan(0);
    expect(compareFullSemver('0.41.0-susu.2', '0.41.0-susu.1')).toBeGreaterThan(0);
    expect(compareFullSemver('0.41.0-susu.10', '0.41.0-susu.2')).toBeGreaterThan(0);
  });

  it('orders legacy numeric suffixes numerically', () => {
    expect(compareFullSemver('0.0.40-7', '0.0.40-8')).toBeLessThan(0);
    expect(compareFullSemver('0.0.40-10', '0.0.40-2')).toBeGreaterThan(0);
  });

  it('orders by base version before the suffix', () => {
    expect(compareFullSemver('0.41.0-susu.9', '0.42.0-susu.1')).toBeLessThan(0);
    expect(compareFullSemver('0.42.0', '0.41.0')).toBeGreaterThan(0);
  });

  it('treats identical versions as equal', () => {
    expect(compareFullSemver('0.41.0-susu.3', '0.41.0-susu.3')).toBe(0);
  });
});
