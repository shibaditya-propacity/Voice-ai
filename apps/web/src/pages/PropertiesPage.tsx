import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Plus, Pencil, Trash2, X } from 'lucide-react';

interface Property {
  id: string;
  name: string;
  city: string;
  area: string;
  bhk: string;
  propertyType: string;
  price: number;
  description: string;
  amenities: string[];
  createdAt: string;
}

interface FormData {
  name: string; city: string; area: string; bhk: string;
  propertyType: string; price: string; description: string; amenities: string;
}

const emptyForm: FormData = { name: '', city: '', area: '', bhk: '', propertyType: 'APARTMENT', price: '', description: '', amenities: '' };

export function PropertiesPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);

  const { data, isLoading } = useQuery({
    queryKey: ['properties'],
    queryFn: () => api.get<{ data: Property[] }>('/api/properties?limit=100').then((r) => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/api/properties', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['properties'] }); setShowForm(false); setForm(emptyForm); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api.patch(`/api/properties/${id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['properties'] }); setShowForm(false); setEditingId(null); setForm(emptyForm); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/properties/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['properties'] }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const body = { ...form, price: Number(form.price), amenities: form.amenities.split(',').map((a) => a.trim()).filter(Boolean) };
    if (editingId) updateMutation.mutate({ id: editingId, body });
    else createMutation.mutate(body);
  };

  const handleEdit = (p: Property) => {
    setEditingId(p.id);
    setForm({ name: p.name, city: p.city, area: p.area, bhk: p.bhk, propertyType: p.propertyType, price: String(p.price), description: p.description, amenities: p.amenities.join(', ') });
    setShowForm(true);
  };

  const properties = data?.data ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Properties</h1>
        <button onClick={() => { setShowForm(true); setEditingId(null); setForm(emptyForm); }} className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:bg-primary/90">
          <Plus className="h-4 w-4" /> Add Property
        </button>
      </div>
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-card rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold">{editingId ? 'Edit' : 'Add'} Property</h2>
              <button onClick={() => setShowForm(false)}><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-3">
              {(['name', 'city', 'area', 'bhk', 'price'] as const).map((field) => (
                <div key={field}>
                  <label className="block text-sm font-medium mb-1 capitalize">{field}</label>
                  <input type={field === 'price' ? 'number' : 'text'} value={form[field]} onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))} required className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                </div>
              ))}
              <div>
                <label className="block text-sm font-medium mb-1">Property Type</label>
                <select value={form.propertyType} onChange={(e) => setForm((f) => ({ ...f, propertyType: e.target.value }))} className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary">
                  {['APARTMENT', 'VILLA', 'COMMERCIAL', 'PLOT'].map((t) => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Description</label>
                <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} required rows={3} className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Amenities (comma separated)</label>
                <input type="text" value={form.amenities} onChange={(e) => setForm((f) => ({ ...f, amenities: e.target.value }))} className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
              </div>
              <button type="submit" disabled={createMutation.isPending || updateMutation.isPending} className="w-full bg-primary text-primary-foreground rounded-md py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
                {editingId ? 'Update' : 'Create'} Property
              </button>
            </form>
          </div>
        </div>
      )}
      <div className="bg-card border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left px-4 py-3 font-medium">Name</th>
              <th className="text-left px-4 py-3 font-medium">Location</th>
              <th className="text-left px-4 py-3 font-medium">BHK / Type</th>
              <th className="text-left px-4 py-3 font-medium">Price</th>
              <th className="text-left px-4 py-3 font-medium">Added</th>
              <th className="text-left px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Loading...</td></tr>
            ) : properties.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No properties yet</td></tr>
            ) : properties.map((p) => (
              <tr key={p.id} className="border-b hover:bg-muted/30">
                <td className="px-4 py-3 font-medium">{p.name}</td>
                <td className="px-4 py-3">{p.area}, {p.city}</td>
                <td className="px-4 py-3">{p.bhk} BHK · {p.propertyType}</td>
                <td className="px-4 py-3 font-medium">{formatCurrency(p.price)}</td>
                <td className="px-4 py-3 text-muted-foreground">{formatDate(p.createdAt)}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button onClick={() => handleEdit(p)} className="p-1 hover:text-primary"><Pencil className="h-4 w-4" /></button>
                    <button onClick={() => { if (confirm('Delete this property?')) deleteMutation.mutate(p.id); }} className="p-1 hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
