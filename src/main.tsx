import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { UnauthorizedError } from './data/httpRepository';
import { I18nProvider } from './i18n/I18nProvider';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    // Being signed out is an answer, not a glitch: show the sign-in screen right away.
    queries: { retry: (failures, error) => !(error instanceof UnauthorizedError) && failures < 2 },
  },
});

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <App />
      </I18nProvider>
    </QueryClientProvider>
  </StrictMode>,
);
