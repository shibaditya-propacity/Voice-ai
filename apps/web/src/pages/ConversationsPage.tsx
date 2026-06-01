import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import { MessageSquare } from 'lucide-react';

interface Conversation {
  id: string;
  leadId: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  content: string;
  language: string;
  createdAt: string;
}

interface Lead {
  id: string;
  name: string | null;
  phone: string;
}

export function ConversationsPage() {
  const [selectedLeadId, setSelectedLeadId] = useState<string>('');

  const { data: leadsData } = useQuery({
    queryKey: ['leads-list'],
    queryFn: () => api.get<{ data: Lead[] }>('/api/leads?limit=100').then((r) => r.data),
  });

  const { data: convsData, isLoading } = useQuery({
    queryKey: ['conversations', selectedLeadId],
    queryFn: () => api.get<{ data: Conversation[] }>(`/api/conversations/${selectedLeadId}`).then((r) => r.data),
    enabled: !!selectedLeadId,
  });

  const leads = leadsData?.data ?? [];
  const conversations = convsData?.data ?? [];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Conversations</h1>
      <div className="flex gap-4 mb-6">
        <select
          value={selectedLeadId}
          onChange={(e) => setSelectedLeadId(e.target.value)}
          className="border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary w-72"
        >
          <option value="">Select a lead to view conversation</option>
          {leads.map((l) => (
            <option key={l.id} value={l.id}>{l.name ?? l.phone}</option>
          ))}
        </select>
      </div>
      {!selectedLeadId ? (
        <div className="bg-card border rounded-xl p-12 text-center text-muted-foreground">
          <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>Select a lead to view their conversation transcript</p>
        </div>
      ) : isLoading ? (
        <div className="text-center py-8 text-muted-foreground">Loading...</div>
      ) : conversations.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">No conversations found for this lead</div>
      ) : (
        <div className="space-y-3 max-w-3xl">
          {conversations.map((conv) => (
            <div key={conv.id} className={`flex gap-3 ${conv.role === 'USER' ? 'justify-start' : 'justify-end'}`}>
              <div className={`max-w-[75%] rounded-xl px-4 py-3 text-sm ${
                conv.role === 'USER'
                  ? 'bg-muted text-foreground'
                  : 'bg-primary text-primary-foreground'
              }`}>
                <p>{conv.content}</p>
                <p className={`text-xs mt-1 ${conv.role === 'USER' ? 'text-muted-foreground' : 'text-primary-foreground/70'}`}>
                  {conv.role === 'USER' ? 'Customer' : 'Raj Mehta'} · {formatDateTime(conv.createdAt)} · {conv.language.toUpperCase()}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
