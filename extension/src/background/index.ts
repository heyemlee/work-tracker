import { browser } from 'wxt/browser';
import { listen, toFrame, type BackgroundMessage } from '../messages';
import { readResume } from '../resumes';
import { outboxTokenItem } from '../storage';
import {
  fill,
  focus,
  logApplication,
  readTab,
  select,
  snapshot,
  submitAttempt,
  submitConfirmed,
  undo,
} from './card';
import { flushQueue } from './outbox';
import { dropSession } from './session';

/** Tabs whose top frame runs the content script (and so has, or can mount, the card). */
const topReady = new Set<number>();

/** Mounts the card in a tab's top frame that doesn't run the content script: a career site embedding a form. */
async function injectCard(tabId: number, allFrames: boolean): Promise<void> {
  await browser.scripting.executeScript({
    target: allFrames ? { tabId, allFrames: true } : { tabId, frameIds: [0] },
    files: ['/content-scripts/inject.js'],
  });
  topReady.add(tabId);
}

async function openCard(tabId: number): Promise<void> {
  try {
    await toFrame(tabId, 0, 'card:open', {});
  } catch {
    // Not running here yet (any site other than an applicant-tracking host): inject into every frame, then open.
    try {
      await injectCard(tabId, true);
      setTimeout(() => void toFrame(tabId, 0, 'card:open', {}).catch(() => undefined), 500);
    } catch {
      // A page extensions can't touch (the Chrome Web Store, chrome:// pages).
    }
  }
}

export function startBackground(): void {
  listen<BackgroundMessage>(
    async (message, sender) => {
      const tabId = sender.tab?.id;
      const url = sender.tab?.url ?? '';
      if (message.type === 'outbox:session') return outboxTokenItem.setValue(message.token);
      if (message.type === 'resume:read') return readResume(message.resumeId);
      if (tabId === undefined) return undefined;
      switch (message.type) {
        case 'frame:hello':
          if (message.top) topReady.add(tabId);
          else if (message.hasForm) {
            // Give the top frame a moment to announce itself before injecting a card there.
            setTimeout(() => {
              if (!topReady.has(tabId)) void injectCard(tabId, false).catch(() => undefined);
            }, 800);
          }
          return undefined;
        case 'card:state':
          return readTab(tabId, url);
        case 'card:select':
          return select(tabId, url, { accountId: message.accountId, resumeId: message.resumeId });
        case 'card:fill':
          return fill(tabId, url);
        case 'card:focus':
          return focus(tabId, message.fieldId);
        case 'card:snapshot':
          return snapshot(tabId).then((saved) => ({ saved }));
        case 'card:log':
          return logApplication(tabId, url, true);
        case 'card:undo':
          return undo(tabId, url);
        case 'card:options':
          return browser.runtime.openOptionsPage();
        case 'submit:attempt':
          return submitAttempt(tabId, url, message.answers);
        case 'submit:confirmed':
          return submitConfirmed(tabId, message.url);
      }
    },
    (message) => typeof message.type === 'string',
  );

  browser.action.onClicked.addListener((tab) => {
    if (tab.id !== undefined) void openCard(tab.id);
  });

  browser.commands.onCommand.addListener((command, tab) => {
    if (command !== 'fill-application' || tab?.id === undefined) return;
    const tabId = tab.id;
    void toFrame(tabId, 0, 'card:fill', {}).catch(() => openCard(tabId));
  });

  browser.webNavigation.onCommitted.addListener(({ tabId, frameId }) => {
    if (frameId === 0) topReady.delete(tabId);
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    topReady.delete(tabId);
    void dropSession(tabId);
  });

  // Logs queued while Outbox was unreachable go out when the browser starts.
  browser.runtime.onStartup.addListener(() => void flushQueue().catch(() => undefined));
}
