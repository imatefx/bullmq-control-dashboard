import { Routes, Route } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { useServerEvents } from '@/lib/sse';
import { OverviewPage } from '@/pages/Overview';
import { ConnectionsPage } from '@/pages/Connections';
import { QueuesPage } from '@/pages/Queues';
import { BoardPage } from '@/pages/Board';
import { ConfigPage } from '@/pages/Config';

export default function App() {
  useServerEvents();
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<OverviewPage />} />
        <Route path="/connections" element={<ConnectionsPage />} />
        <Route path="/queues" element={<QueuesPage />} />
        <Route path="/board" element={<BoardPage />} />
        <Route path="/config" element={<ConfigPage />} />
      </Routes>
    </AppShell>
  );
}
