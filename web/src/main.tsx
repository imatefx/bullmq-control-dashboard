import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import App from './App';
import { ServerProvider } from './context/ServerContext';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 5000 } },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ServerProvider>
        <BrowserRouter>
          <App />
          <Toaster theme="dark" position="top-right" richColors />
        </BrowserRouter>
      </ServerProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
