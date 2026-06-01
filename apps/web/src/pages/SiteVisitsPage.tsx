import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import { cn } from '@/lib/utils';

interface SiteVisit {
  id: string;
  visitDate: string;
  status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';
  lead: { name: string | null; phone: string };
  property: { name: string; city: string; area: string };
}

const statusColors: Record<string, string> = {
  SCHEDULED: 'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-red-100 text-red-700',
};

export function SiteVisitsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['site-visits'],
    queryFn: () => api.get<{ data: SiteVisit[]; total: number }>('/api/site-visits?limit=50').then((r) => r.data),
  });

  const visits = data?.data ?? [];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Site Visits</h1>
      <div className="bg-card border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left px-4 py-3 font-medium">Lead</th>
              <th className="text-left px-4 py-3 font-medium">Property</th>
              <th className="text-left px-4 py-3 font-medium">Visit Date</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">Loading...</td></tr>
            ) : visits.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No site visits scheduled</td></tr>
            ) : visits.map((v) => (
              <tr key={v.id} className="border-b hover:bg-muted/30">
                <td className="px-4 py-3">{v.lead.name ?? v.lead.phone}</td>
                <td className="px-4 py-3">{v.property.name}, {v.property.area}</td>
                <td className="px-4 py-3">{formatDateTime(v.visitDate)}</td>
                <td className="px-4 py-3">
                  <span className={cn('px-2 py-1 rounded-full text-xs font-medium', statusColors[v.status])}>
                    {v.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
