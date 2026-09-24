import clsx from 'clsx';
import { Switch as RadixSwitch } from 'radix-ui';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
}

export function IconButton({ label, className, children, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={clsx(
        'grid size-9 shrink-0 place-items-center rounded-full text-fg-2 transition-colors hover:bg-fill hover:text-fg active:bg-fill-2',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent hover:opacity-90',
  secondary: 'bg-fill text-fg hover:bg-fill-2',
  danger: 'bg-danger text-white hover:opacity-90',
  ghost: 'text-fg-2 hover:bg-fill hover:text-fg',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({ variant = 'secondary', className, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={clsx(
        'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium whitespace-nowrap transition active:scale-[0.97] disabled:opacity-40',
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...rest}
    />
  );
}

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: string;
  id?: string;
}

export function Switch({ checked, onCheckedChange, label, id }: SwitchProps) {
  return (
    <RadixSwitch.Root
      id={id}
      className="switch"
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-label={label}
    >
      <RadixSwitch.Thumb className="switch-thumb" />
    </RadixSwitch.Root>
  );
}

/** A monogram tile, in neutral gray like X's default avatars. */
export function CompanyAvatar({ name, size = 36 }: { name: string; size?: number }) {
  const initial = Array.from(name.trim())[0]?.toUpperCase() ?? '?';
  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center bg-fill-2 font-semibold text-fg-2 select-none"
      style={{ width: size, height: size, borderRadius: size * 0.28, fontSize: size * 0.42 }}
    >
      {initial}
    </span>
  );
}

export function Section({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={clsx('mt-6 first:mt-0', className)}>
      <h3 className="mb-2.5 text-[13px] font-semibold text-fg-2">{title}</h3>
      {children}
    </section>
  );
}

/** The app mark: a tray with an outgoing arrow. Inverts with the theme. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" className="shrink-0">
      <rect width="64" height="64" rx="15" fill="var(--fg)" />
      <g fill="none" stroke="var(--canvas)" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 36v5.5a4.5 4.5 0 0 0 4.5 4.5h19a4.5 4.5 0 0 0 4.5-4.5V36" />
        <path d="M32 37V17M24.5 24.5 32 17l7.5 7.5" />
      </g>
    </svg>
  );
}

export function Brand() {
  return (
    <div className="flex shrink-0 items-center gap-2 pr-1">
      <BrandMark />
      <span className="hidden text-[17px] font-semibold tracking-[-0.02em] min-[420px]:inline">Outbox</span>
    </div>
  );
}
