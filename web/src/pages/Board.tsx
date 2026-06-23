import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { api } from '@/lib/api';
import { ALL_SERVERS, useActiveServer } from '@/context/ServerContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export function BoardPage() {
  const { activeId } = useActiveServer();
  const { data: connections = [] } = useQuery({
    queryKey: ['connections'],
    queryFn: api.listConnections,
  });

  const boardId = activeId ?? ALL_SERVERS;
  const label =
    boardId === ALL_SERVERS ? 'All servers' : connections.find((c) => c.id === boardId)?.name;
  const src = `/board/${boardId}/`;

  if (connections.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          Add a connection to view its board.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Board · {label}</h1>
        <Button variant="outline" asChild>
          <a href={src} target="_blank" rel="noreferrer">
            <ExternalLink className="h-4 w-4" /> Open in new tab
          </a>
        </Button>
      </div>
      <Card className="flex-1 overflow-hidden">
        <iframe key={src} title="bull-board" src={src} className="h-full w-full border-0" />
      </Card>
    </div>
  );
}
