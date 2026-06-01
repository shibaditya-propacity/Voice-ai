import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { formatDate, getLeadQualification } from '@/lib/utils';
import { Search } from 'lucide-react';

interface Lead {
  id: string;
  name: string | null;
  phone: string;
  city: string | null;
  budget: string | null;
  propertyType: string | null;
  leadScore: number;
  createdAt: string;
}

export function LeadsPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['leads', search, page],
    queryFn: () =>
      api
        .get<{ data: Lead[]; total: number; limit: number }>(`/api/leads?search=${search}&page=${page}&limit=20`)
        .then((r) => r.data),
  });

  const leads = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Leads</h1>
      <div className="bg-card border rounded-xl">
        <div className="p-4 border-b flex gap-3 items-center">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search leads..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="w-full border rounded-md pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <span className="text-sm text-muted-foreground">{total} total leads</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left px-4 py-3 font-medium">Name</th>
                <th className="text-left px-4 py-3 font-medium">Phone</th>
                <th className="text-left px-4 py-3 font-medium">City</th>
                <th className="text-left px-4 py-3 font-medium">Budget</th>
                <th className="text-left px-4 py-3 font-medium">Type</th>
                <th className="text-left px-4 py-3 font-medium">Score</th>
                <th className="text-left px-4 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">Loading...</td></tr>
              ) : leads.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No leads found</td></tr>
              ) : leads.map((lead) => {
                const qual = getLeadQualification(lead.leadScore);
                return (
                  <tr key={lead.id} className="border-b hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">{lead.name ?? '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs">{lead.phone}</td>
                    <td className="px-4 py-3">{lead.city ?? '—'}</td>
                    <td className="px-4 py-3">{lead.budget ?? '—'}</td>
                    <td className="px-4 py-3">{lead.propertyType ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${qual.color}`}>
                        {qual.label} ({lead.leadScore})
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDate(lead.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="p-4 flex justify-center gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 border rounded text-sm disabled:opacity-50 hover:bg-accent">Prev</button>
            <span className="px-3 py-1 text-sm">{page} / {totalPages}</span>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-3 py-1 border rounded text-sm disabled:opacity-50 hover:bg-accent">Next</button>
          </div>
        )}
      </div>
    </div>
  );
}
