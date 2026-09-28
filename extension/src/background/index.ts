import { browser } from 'wxt/browser';
import { onJobBoard } from '../hosts';
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
import { fromOutbox, readiness, readResumeForOutbox } from './bridge';
import { forgetTab, openCard, showForm } from './inject';
import { flushQueue, syncProfile } from './outbox';
import { dropSession } from './session';

export function startBackground(): void {
  listen<BackgroundMessage>(
    async (message, sender) => {
      const tabId = sender.tab?.id;
      const url = sender.tab?.url ?? '';
      if (message.type === 'outbox:session') return outboxTokenItem.setValue(message.token);
      if (message.type === 'resume:read') return readResume(message.resumeId);
      if (message.type === 'bridge:status' || message.type === 'resume:parse') {
        if (!fromOutbox(sender.url)) return undefined;
        return message.type === 'bridge:status'
          ? readiness()
          : readResumeForOutbox(message.pdf, message.text);
      }
      if (tabId === undefined) return undefined;
      switch (message.type) {
        case 'frame:hello':
          // Nothing to do yet: a frame reports its form once the form has fields (frame:form).
          return undefined;
        case 'frame:form':
          // A job board's own apply flow, or Outbox itself: there the card waits for the toolbar button.
          if (onJobBoard(url) || fromOutbox(url)) return undefined;
          return showForm(tabId, sender.frameId ?? 0);
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
    // The card answers when it's there and fills; otherwise the shortcut opens it, as the toolbar button does.
    void toFrame(tabId, 0, 'card:fill', {})
      .catch(() => false)
      .then((filling) => {
        if (!filling) return openCard(tabId);
      });
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    forgetTab(tabId);
    void dropSession(tabId);
  });

  // Logs queued while Outbox was unreachable go out when the browser starts.
  browser.runtime.onStartup.addListener(() => {
    void flushQueue().catch(() => undefined);
    void syncProfile().catch(() => undefined);
  });
}
