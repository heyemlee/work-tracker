import { browser } from 'wxt/browser';
import { onJobBoard } from '../hosts';
import { listen, toFrame, type BackgroundMessage } from '../messages';
import { readResume } from '../resumes';
import { outboxTokenItem } from '../storage';
import {
  asApplication,
  fill,
  focus,
  logApplication,
  pageHolds,
  readTab,
  saveJob,
  select,
  snapshot,
  submitAttempt,
  submitConfirmed,
  undo,
} from './card';
import { bridgeStatus, fromOutbox, readResumeForOutbox } from './bridge';
import { showBubble } from './bubble';
import { dropFixedSnapshots } from './fixed';
import { forgetTab, openCard, showForm } from './inject';
import { flushQueue, syncProfile } from './outbox';
import { enterPreview, openPreview, previewOf } from './preview';
import { loadProfile, storeProfile } from './profile';
import { dropSession } from './session';
import { deleteEverything, enterSettings, openSettings, settingsStatus } from './settings';
import { dropTickets } from './tickets';

export function startBackground(): void {
  listen<BackgroundMessage>(
    async (message, sender) => {
      const tabId = sender.tab?.id;
      const url = sender.tab?.url ?? '';
      if (message.type === 'outbox:session') return outboxTokenItem.setValue(message.token);
      if (message.type === 'resume:read') return readResume(message.resumeId);
      if (message.type === 'profile:load') return loadProfile();
      if (message.type === 'profile:save') return storeProfile(tabId, message.profile);
      if (message.type === 'settings:status') return settingsStatus();
      if (message.type === 'settings:deleteAll') return deleteEverything();
      if (message.type === 'bridge:status' || message.type === 'resume:parse') {
        if (!fromOutbox(sender.url)) return undefined;
        return message.type === 'bridge:status'
          ? bridgeStatus()
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
        case 'frame:held':
          return pageHolds(tabId, url, sender.frameId ?? 0, { at: message.at, fields: message.fields });
        case 'card:state':
          return readTab(tabId, url, message.moved === true);
        case 'card:select':
          return select(tabId, url, { accountId: message.accountId, resumeId: message.resumeId });
        case 'card:fill':
          return fill(tabId, url);
        case 'card:asForm':
          return asApplication(tabId, url);
        case 'card:focus':
          return focus(tabId, message.fieldId);
        case 'card:snapshot':
          return snapshot(tabId).then((saved) => ({ saved }));
        case 'card:log':
          return logApplication(tabId, url, true);
        case 'card:save':
          return saveJob(tabId, url);
        case 'card:undo':
          return undo(tabId, url);
        case 'card:options':
          return browser.runtime.openOptionsPage();
        case 'settings:open':
          return openSettings(tabId);
        case 'settings:enter': {
          const allowed = enterSettings(tabId, message.ticket);
          if (allowed) void toFrame(tabId, 0, 'settings:shown', {}).catch(() => undefined);
          return allowed;
        }
        case 'settings:close':
          return toFrame(tabId, 0, 'settings:close', {}).catch(() => undefined);
        case 'preview:open':
          return openPreview(tabId, message.resumeId);
        case 'preview:enter': {
          const resumeId = enterPreview(tabId, message.ticket);
          if (resumeId === null) return 'refused';
          // Said before the PDF is read: the card's window holds a page that draws, whatever Outbox takes to answer.
          void toFrame(tabId, 0, 'preview:shown', {}).catch(() => undefined);
          return previewOf(resumeId);
        }
        case 'preview:close':
          return toFrame(tabId, 0, 'preview:close', {}).catch(() => undefined);
        case 'submit:attempt':
          return submitAttempt(tabId, url, message.answers, message.emails);
        case 'submit:confirmed':
          return submitConfirmed(tabId, message.url);
      }
    },
    (message) => typeof message.type === 'string',
  );

  // The card, on any page that takes one; where the browser lets none be drawn, the button says so itself.
  const ask = async (tabId: number) => {
    if (!(await openCard(tabId))) await showBubble(tabId);
  };

  browser.action.onClicked.addListener((tab) => {
    if (tab.id !== undefined) void ask(tab.id);
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    forgetTab(tabId);
    dropTickets(tabId);
    void dropSession(tabId);
  });

  // Reports this build fixes leave the list when the build comes in: installed, updated, or reloaded on
  // chrome://extensions.
  browser.runtime.onInstalled.addListener(() => {
    void dropFixedSnapshots().catch(() => undefined);
  });

  // Logs queued while Outbox was unreachable go out when the browser starts.
  browser.runtime.onStartup.addListener(() => {
    void flushQueue().catch(() => undefined);
    void syncProfile().catch(() => undefined);
    void dropFixedSnapshots().catch(() => undefined);
  });
}
