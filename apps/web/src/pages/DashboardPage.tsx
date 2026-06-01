import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Users, Phone, Calendar, TrendingUp } from 'lucide-react';

interface DashboardStats {
  totalLeads: number;
  totalCalls: number;
  totalVisits: number;
  hotLeads: number;
}

function StatCard({ title, value, icon: Icon, color }: { title: string; value: number; icon: React.ElementType; color: string }) {
  return (
    <div className="bg-card border rounded-xl p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="text-3xl font-bold mt-1">{value}</p>
        </div>
        <div className={`h-12 w-12 rounded-lg flex items-center justify-center ${color}`}>
          <Icon className="h-6 w-6" />
        </div>
      </div>
    </div>
  );
}

export function DashboardPage() {
  const { data: leadsData } = useQuery({
    queryKey: ['leads-summary'],
    queryFn: () => api.get<{ total: number }>('/api/leads?limit=1').then((r) => r.data),
  });
  const { data: callsData } = useQuery({
    queryKey: ['calls-summary'],
    queryFn: () => api.get<{ total: number }>('/api/call-logs?limit=1').then((r) => r.data),
  });
  const { data: visitsData } = useQuery({
    queryKey: ['visits-summary'],
    queryFn: () => api.get<{ total: number }>('/api/site-visits?limit=1').then((r) => r.data),
  });
  const { data: hotLeadsData } = useQuery({
    queryKey: ['hot-leads'],
    queryFn: () =>
      api
        .get<{ data: Array<{ leadScore: number }> }>('/api/leads?limit=100')
        .then((r) => ({ total: r.data.data?.filter((l) => l.leadScore >= 80).length ?? 0 })),
  });

  const stats: DashboardStats = {
    totalLeads: leadsData?.total ?? 0,
    totalCalls: callsData?.total ?? 0,
    totalVisits: visitsData?.total ?? 0,
    hotLeads: hotLeadsData?.total ?? 0,
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        <StatCard title="Total Leads" value={stats.totalLeads} icon={Users} color="bg-blue-100 text-blue-600" />
        <StatCard title="Total Calls" value={stats.totalCalls} icon={Phone} color="bg-green-100 text-green-600" />
        <StatCard title="Site Visits" value={stats.totalVisits} icon={Calendar} color="bg-purple-100 text-purple-600" />
        <StatCard title="Hot Leads" value={stats.hotLeads} icon={TrendingUp} color="bg-red-100 text-red-600" />
      </div>
      <div className="bg-card border rounded-xl p-6">
        <h2 className="text-lg font-semibold mb-4">Platform Overview</h2>
        <p className="text-muted-foreground text-sm">
          AI Property Consultant "Raj Mehta" is active and handling calls in English, Hindi, and Marathi.
          The system automatically qualifies leads, matches properties, and schedules site visits.
        </p>
      </div>
    </div>
  );
}
