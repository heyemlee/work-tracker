import clsx from 'clsx';
import { useRef, type ReactNode } from 'react';
import { useLiquidGlass } from './useLiquidGlass';

interface GlassPaneProps {
  /** Corner radius in px; the class names should round the pane to match. */
  radius: number;
  bevel?: number;
  className?: string;
  children: ReactNode;
}

/** A `.glass` pane with refraction where the browser supports it. */
export function GlassPane({ radius, bevel, className, children }: GlassPaneProps) {
  const paneRef = useRef<HTMLDivElement>(null);
  const glass = useLiquidGlass(paneRef, { radius, bevel });
  return (
    <div ref={paneRef} style={glass.style} className={clsx('glass', className)}>
      {glass.filter}
      {children}
    </div>
  );
}
