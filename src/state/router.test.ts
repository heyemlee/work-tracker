import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('integrated page navigation', () => {
  it('resolves direct URLs and guards both links and browser navigation', async () => {
    const target = new EventTarget();
    let location = new URL('http://127.0.0.1:5180/discover?q=engineer');
    const move = (_state: unknown, _unused: string, to: string) => {
      location = new URL(to, location);
    };
    vi.stubGlobal('window', {
      get location() {
        return location;
      },
      history: { pushState: move, replaceState: move },
      scrollTo: vi.fn(),
      addEventListener: target.addEventListener.bind(target),
    });
    const { pageOf, navigate, setLeaveGuard } = await import('./router');
    expect(pageOf('/discover/')).toBe('discovery');
    expect(pageOf('/resume-tools')).toBe('resumeTools');
    expect(navigate('/resume-tools?method=structured-output')).toBe(true);
    setLeaveGuard(() => false);
    expect(navigate('/profile')).toBe(false);
    expect(location.pathname).toBe('/resume-tools');
    location = new URL('http://127.0.0.1:5180/discover');
    target.dispatchEvent(new Event('popstate'));
    expect(location.pathname).toBe('/resume-tools');
    setLeaveGuard(null);
    expect(navigate('/profile')).toBe(true);
  });
});
