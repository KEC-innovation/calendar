import { describe, expect, it } from 'vitest';
import { certificationIssueLabel } from '../src/lib/certificationDate';
describe('imported certification issue dates', () => {
  it.each([null, undefined, '', '  ', 'not-a-date'])('does not invent a date for %s', value => {
    expect(certificationIssueLabel(value)).toBe('Issue date not recorded');
  });
  it('uses Nepal date at a UTC midnight boundary', () => {
    const label = certificationIssueLabel('2026-10-05T20:00:00Z');
    expect(label).toMatch(/^Issued /);
    expect(label).toContain('6');
    expect(label).toContain('2026');
    expect(label).not.toContain('1970');
  });
});
