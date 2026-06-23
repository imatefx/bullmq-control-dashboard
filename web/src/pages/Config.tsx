import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, Upload, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

export function ConfigPage() {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const importMut = useMutation({
    mutationFn: (cfg: unknown) => api.importConfig(cfg),
    onSuccess: (r) => {
      toast.success(`Imported ${r.connections} connection(s)`);
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(`Import failed: ${e.message}`),
  });

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      importMut.mutate(JSON.parse(text));
    } catch {
      toast.error('Invalid JSON file');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Config</h1>

      <Card>
        <CardHeader>
          <CardTitle>Export</CardTitle>
          <CardDescription>
            Download the full dashboard config as JSON. Secrets are redacted by default so the file
            is safe to share — use <code>${'{'}ENV_VAR{'}'}</code> templates in passwords to keep
            credentials out of the file entirely.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isAdmin && (
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label>Include secrets</Label>
                <p className="text-xs text-muted-foreground">
                  Include plaintext passwords in the export (not recommended)
                </p>
              </div>
              <Switch checked={includeSecrets} onCheckedChange={setIncludeSecrets} />
            </div>
          )}
          <Button asChild>
            <a href={api.exportUrl(isAdmin && includeSecrets)} download>
              <Download className="h-4 w-4" /> Download config.json
            </a>
          </Button>
        </CardContent>
      </Card>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Import</CardTitle>
            <CardDescription>
              Replace the current config with an uploaded file. Connections and per-queue settings
              are restored and re-synced immediately.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <input ref={fileRef} type="file" accept="application/json" hidden onChange={onFile} />
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={importMut.isPending}>
              {importMut.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              Import config.json
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
