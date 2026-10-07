import { describe, expect, it } from 'vitest';
import { isDark } from './scheme';

describe('isDark', () => {
  it('reads the page’s side from the first background that is painted', () => {
    expect(isDark(['rgb(255, 255, 255)'])).toBe(false);
    expect(isDark(['rgb(18, 18, 20)'])).toBe(true);
    expect(isDark(['rgba(0, 0, 0, 0)', 'rgb(13, 17, 23)'])).toBe(true);
    expect(isDark(['rgba(0, 0, 0, 0)', 'rgb(250, 250, 250)'])).toBe(false);
  });

  it('takes the modern notation too', () => {
    expect(isDark(['rgb(10 10 10 / 0.9)'])).toBe(true);
    expect(isDark(['rgb(10 10 10 / 0.1)', 'rgb(245 245 247)'])).toBe(false);
  });

  it('says nothing for a page that paints no background', () => {
    expect(isDark(['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)'])).toBeNull();
    expect(isDark(['oklch(0.2 0 0)'])).toBeNull();
    expect(isDark([])).toBeNull();
  });
});
