import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { onUnauthorized } from './api/client.ts';
import { shouldRetry } from './api/queries.ts';
import { ToastProvider } from './components/toast.tsx';
import { LocaleProvider } from './i18n.tsx';
import { router } from './router.tsx';
import './styles.css';
import './templates.css';
import './operations.css';
import './workforce.css';
import './navigation.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: shouldRetry, refetchOnWindowFocus: false, staleTime: 5_000 },
    mutations: { retry: false },
  },
});

// Browser history may restore a previous company's React/query state while this tab's storage has changed.
globalThis.addEventListener('pageshow', (event: PageTransitionEvent) => {
  if (event.persisted) globalThis.location.reload();
});

// AC-8: any 401 drops the session and returns to the login page.
onUnauthorized(() => {
  queryClient.clear();
  void router.navigate({ to: '/login', search: { reason: 'expired' } });
});

const rootEl = document.getElementById('root');
if (!rootEl) throw new TypeError('#root element missing in index.html');

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <LocaleProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </LocaleProvider>
    </QueryClientProvider>
  </StrictMode>,
);
