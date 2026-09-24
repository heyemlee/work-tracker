import {
  useId,
  useLayoutEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { usePrefs } from '../../state/prefs';
import { displacementMap, supportsRefraction } from './refraction';

interface Options {
  /** Corner radius of the pane in px. */
  radius: number;
  /** Width of the refracting band along the edge, in px. */
  bevel?: number;
  /** Peak displacement as a fraction of the bevel. */
  strength?: number;
}

export interface LiquidGlass {
  /** Render inside the pane: the SVG filter its backdrop points at. */
  filter: ReactNode;
  /** Spread onto the pane's `style`. Empty when refraction is off. */
  style: CSSProperties | undefined;
}

/**
 * Adds refraction to an element styled with `.glass`, where the browser supports it. The pane keeps its CSS
 * blur everywhere else, and whenever the user turns refraction off or prefers reduced transparency.
 *
 * The backdrop is blurred natively first and displaced second. Blurring inside the SVG filter instead leaves
 * semi-transparent edges that let the unfiltered backdrop show through as streaks.
 */
export function useLiquidGlass(
  pane: RefObject<HTMLElement | null>,
  { radius, bevel = 16, strength = 0.9 }: Options,
): LiquidGlass {
  const id = `lg${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const wanted = usePrefs((p) => p.tweaks.refraction);
  const reducedTransparency = useMediaQuery('(prefers-reduced-transparency: reduce)');
  const enabled = wanted && supportsRefraction && !reducedTransparency;
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const element = pane.current;
    if (!element || !enabled) return;
    const observer = new ResizeObserver(([entry]) => {
      const box = entry?.borderBoxSize[0];
      if (box) setSize({ width: Math.round(box.inlineSize), height: Math.round(box.blockSize) });
    });
    observer.observe(element, { box: 'border-box' });
    return () => observer.disconnect();
  }, [pane, enabled]);

  const active = enabled && size !== null && size.width > 0 && size.height > 0;

  const map = useMemo(
    () => (active && size ? displacementMap(size.width, size.height, radius, bevel) : null),
    [active, size, radius, bevel],
  );

  if (!map || !size) return { filter: null, style: undefined };
  const filter = (
    <svg
      aria-hidden="true"
      focusable="false"
      style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}
    >
      <filter
        id={id}
        x="0"
        y="0"
        width={size.width}
        height={size.height}
        filterUnits="userSpaceOnUse"
        colorInterpolationFilters="sRGB"
      >
        <feImage
          href={map}
          x="0"
          y="0"
          width={size.width}
          height={size.height}
          preserveAspectRatio="none"
          result="map"
        />
        <feDisplacementMap
          in="SourceGraphic"
          in2="map"
          scale={bevel * strength * 2}
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>
    </svg>
  );
  const backdropFilter = `blur(var(--glass-blur)) url(#${id}) saturate(1.8)`;
  return { filter, style: { backdropFilter, WebkitBackdropFilter: backdropFilter } };
}
