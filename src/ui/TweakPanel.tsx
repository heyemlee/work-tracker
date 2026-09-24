import clsx from 'clsx';
import { SlidersHorizontal, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useI18n } from '../i18n/context';
import { ACCENTS, DEFAULT_TWEAKS, updatePrefs, updateTweaks, usePrefs, type ThemePref } from '../state/prefs';
import { supportsRefraction } from './glass/refraction';
import { IconButton, Switch } from './primitives';
import { SegmentedControl } from './SegmentedControl';

const ACCENT_SWATCHES: Record<(typeof ACCENTS)[number], string> = {
  mono: 'linear-gradient(135deg, #1d1d1f 50%, #f5f5f7 50%)',
  blue: '#0071e3',
  indigo: '#5856d6',
  teal: '#0a8792',
};

/** Prototype-only design knobs. Shown when the URL has `?tweaks`. */
export function TweakPanel() {
  const [enabled] = useState(() => new URLSearchParams(window.location.search).has('tweaks'));
  const [open, setOpen] = useState(true);
  const { t } = useI18n();
  const tweaks = usePrefs((p) => p.tweaks);
  const theme = usePrefs((p) => p.theme);

  if (!enabled) return null;

  if (!open) {
    return (
      <IconButton
        label={t('tweaks.toggle')}
        onClick={() => setOpen(true)}
        className="glass fixed bottom-5 left-5 z-40 size-11 text-fg"
      >
        <SlidersHorizontal className="size-[18px]" />
      </IconButton>
    );
  }

  return (
    <aside className="glass glass-strong fixed bottom-5 left-5 z-40 w-[272px] rounded-[22px] p-4 text-[13px]">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">{t('tweaks.title')}</h2>
        <div className="flex items-center">
          <button
            type="button"
            onClick={() => updatePrefs({ tweaks: DEFAULT_TWEAKS })}
            className="rounded-full px-2.5 py-1 text-[12px] font-medium text-fg-2 hover:bg-fill hover:text-fg"
          >
            {t('tweaks.reset')}
          </button>
          <IconButton label={t('detail.close')} onClick={() => setOpen(false)} className="-mr-2 size-8">
            <X className="size-4" />
          </IconButton>
        </div>
      </div>

      <Field label={t('tweaks.theme')}>
        <SegmentedControl<ThemePref>
          size="sm"
          label={t('tweaks.theme')}
          layoutId="tweak-theme"
          segments={[
            { value: 'system', label: t('theme.system') },
            { value: 'light', label: t('theme.light') },
            { value: 'dark', label: t('theme.dark') },
          ]}
          value={theme}
          onChange={(value) => updatePrefs({ theme: value })}
        />
      </Field>

      <Field label={t('tweaks.accent')}>
        <div className="flex gap-2">
          {ACCENTS.map((accent) => (
            <button
              key={accent}
              type="button"
              aria-label={t(`accent.${accent}`)}
              aria-pressed={tweaks.accent === accent}
              title={t(`accent.${accent}`)}
              onClick={() => updateTweaks({ accent })}
              className={clsx(
                'size-7 rounded-full ring-offset-2 ring-offset-transparent transition',
                tweaks.accent === accent ? 'ring-2 ring-fg' : 'hover:scale-110',
              )}
              style={{
                background: ACCENT_SWATCHES[accent],
                boxShadow: 'inset 0 0 0 0.5px rgb(0 0 0 / 0.15)',
              }}
            />
          ))}
        </div>
      </Field>

      <Slider
        label={t('tweaks.blur')}
        value={tweaks.blur}
        min={0}
        max={40}
        step={1}
        unit="px"
        onChange={(blur) => updateTweaks({ blur })}
      />
      <Slider
        label={t('tweaks.tint')}
        value={tweaks.tint}
        min={0.2}
        max={1.8}
        step={0.05}
        unit="×"
        onChange={(tint) => updateTweaks({ tint })}
      />
      <Slider
        label={t('tweaks.glow')}
        value={tweaks.glow}
        min={0}
        max={1.6}
        step={0.05}
        unit="×"
        onChange={(glow) => updateTweaks({ glow })}
      />

      <div className="mt-3 flex items-center justify-between gap-3">
        <span>
          <span className="block">{t('tweaks.refraction')}</span>
          {!supportsRefraction && (
            <span className="block text-[11px] text-fg-3">{t('tweaks.unsupported')}</span>
          )}
        </span>
        <Switch
          checked={tweaks.refraction && supportsRefraction}
          onCheckedChange={(refraction) => updateTweaks({ refraction })}
          label={t('tweaks.refraction')}
        />
      </div>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-3 first:mt-0">
      <p className="mb-1.5 text-fg-2">{label}</p>
      {children}
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="mt-3 block">
      <span className="mb-1 flex justify-between text-fg-2">
        {label}
        <span className="text-fg tabular-nums">
          {step < 1 ? value.toFixed(2) : Math.round(value)}
          {unit}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-[var(--accent)]"
      />
    </label>
  );
}
