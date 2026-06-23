import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/** Subscribe to backend SSE and invalidate relevant queries on changes. */
export function useServerEvents() {
  const qc = useQueryClient();
  useEffect(() => {
    const es = new EventSource('/api/events');
    es.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data) as { type: string; connId?: string };
        if (evt.type === 'connection:status' || evt.type === 'config:changed') {
          qc.invalidateQueries({ queryKey: ['connections'] });
        }
        if (evt.type === 'queues:changed' && evt.connId) {
          qc.invalidateQueries({ queryKey: ['queues', evt.connId] });
          qc.invalidateQueries({ queryKey: ['connections'] });
          qc.invalidateQueries({ queryKey: ['overview'] });
        }
      } catch {
        /* ignore malformed */
      }
    };
    return () => es.close();
  }, [qc]);
}
