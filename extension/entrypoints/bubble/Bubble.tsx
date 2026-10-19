import { browser } from 'wxt/browser';
import { Pet } from '../../../src/ui/pet/Pet';
import type { Translate } from '../../src/ui/i18n';

/**
 * What the toolbar button shows where no card can be drawn (src/background/bubble.ts): why nothing came up on the
 * page, and the two things that need no page. Each opens in a tab: there is no page here to open a window over.
 */
export function Bubble({ t, outboxUrl, dark }: { t: Translate; outboxUrl: string; dark: boolean }) {
  const go = (open: () => Promise<unknown>) => () => void open().finally(() => window.close());
  return (
    <div className={`pane bubble${dark ? ' dark' : ''}`}>
      <header className="bubble-head">
        <Pet size={24} />
        Outbox Autofill
      </header>
      <p className="bubble-text">{t('bubble.text')}</p>
      <div className="bubble-actions">
        <button className="primary" onClick={go(() => browser.tabs.create({ url: outboxUrl }))}>
          {t('bubble.outbox')}
        </button>
        <button className="secondary" onClick={go(() => browser.runtime.openOptionsPage())}>
          {t('options')}
        </button>
      </div>
    </div>
  );
}
