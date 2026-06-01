import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { formatDateTime } from '@/lib/utils';

interface CallLog {
  id: string;
  callSid: string;
  duration: number;
  language: string;
  summary: string | null;
  direction: string;
  from: string | null;
  to: string | null;
  createdAt: string;
  lead: { name: string | null; phone: string } | null;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function CallLogsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['call-logs'],
    queryFn: () =>
      api
        .get<{ data: CallLog[]; total: number }>('/api/call-logs?limit=50')
        .then((r) => r.data)
        .catch(() => ({ data: [], total: 0 })),
  });

  const logs = data?.data ?? [];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Call Logs</h1>
      <div className="bg-card border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left px-4 py-3 font-medium">Lead</th>
              <th className="text-left px-4 py-3 font-medium">Direction</th>
              <th className="text-left px-4 py-3 font-medium">Duration</th>
              <th className="text-left px-4 py-3 font-medium">Language</th>
              <th className="text-left px-4 py-3 font-medium">Date</th>
              <th className="text-left px-4 py-3 font-medium">Summary</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Loading...</td></tr>
            ) : logs.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No call logs yet</td></tr>
            ) : logs.map((log) => (
              <tr key={log.id} className="border-b hover:bg-muted/30">
                <td className="px-4 py-3">{log.lead?.name ?? log.lead?.phone ?? (log.direction === 'inbound' ? log.from : log.to) ?? '—'}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${log.direction === 'inbound' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                    {log.direction}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono">{formatDuration(log.duration)}</td>
                <td className="px-4 py-3 uppercase text-xs">{log.language}</td>
                <td className="px-4 py-3 text-muted-foreground">{formatDateTime(log.createdAt)}</td>
                <td className="px-4 py-3 text-muted-foreground max-w-xs truncate">{log.summary ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
