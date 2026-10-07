import mark from '../assets/outbox.svg?raw';

/** Inline the shared, trusted SVG so the extension also works on pages that block image URLs. */
export function BrandMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={className}
      style={{ display: 'inline-flex', width: size, height: size, flexShrink: 0 }}
      dangerouslySetInnerHTML={{ __html: mark }}
    />
  );
}
