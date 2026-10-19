import clsx from 'clsx';
import { Switch as RadixSwitch } from 'radix-ui';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useArrival } from './pet/arrival';
import { Pet } from './pet/Pet';

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

/** Outbox's name and its pet. As Outbox opens, the pet waiting in the middle of the page flies here (Arrival). */
export function Brand() {
  const { flying, landings } = useArrival();
  return (
    <div className="flex shrink-0 items-center gap-2 pr-1">
      <span data-brand-pet className={clsx(flying && 'invisible')}>
        <Pet size={30} poke={landings} />
      </span>
      <span className="hidden text-[17px] font-semibold tracking-[-0.02em] min-[420px]:inline">Outbox</span>
    </div>
  );
}
