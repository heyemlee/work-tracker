import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // Explicit imports everywhere, so the code reads like the rest of the repository.
  imports: false,
  alias: { '@domain': '../src/domain' },
  manifest: {
    name: 'Outbox Autofill',
    description:
      'Fills job applications from a profile kept on this machine and logs each submission to Outbox.',
    // The card is injected into the top frame of any site that embeds an application form, and the service
    // worker talks to Outbox and to the Claude API.
    host_permissions: ['<all_urls>'],
    permissions: ['storage', 'unlimitedStorage', 'scripting', 'webNavigation'],
    action: { default_title: 'Outbox Autofill' },
    // The card's stylesheet, read by the card when it's injected into a career site that embeds a form; and the
    // settings page, which the card shows in a frame inside its window (it draws there only for the card: see
    // src/background/settings.ts).
    web_accessible_resources: [
      { resources: ['content-scripts/inject.css', 'options.html'], matches: ['<all_urls>'] },
    ],
    commands: {
      'fill-application': {
        suggested_key: { default: 'Alt+Shift+F' },
        description: 'Fill the application on this page',
      },
    },
  },
  vite: () => ({ plugins: [tailwindcss()] }),
});
