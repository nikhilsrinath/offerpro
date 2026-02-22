import { supabase } from '../lib/supabaseClient';

export const storageService = {
  getAll: async (orgId, type) => {
    let query = supabase
      .from('records')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (orgId) query = query.eq('organization_id', orgId);
    if (type) query = query.eq('type', type);

    const { data, error } = await query;
    if (error) {
      console.warn("Table 'records' might not exist yet. Check database schema.", error);
      return [];
    }
    return data;
  },

  save: async (recordData, type, orgId, userId) => {
    const { data, error } = await supabase
      .from('records')
      .insert([{
        data: recordData,
        title: type === 'offer' 
          ? recordData.studentName 
          : type === 'certificate' 
            ? recordData.recipientName 
            : type === 'mou'
              ? `${recordData.partyAName} & ${recordData.partyBName}`
              : `Inv: ${recordData.clientName} (${recordData.invoiceNumber})`
      }])
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  delete: async (id) => {
    const { error } = await supabase
      .from('records')
      .delete()
      .eq('id', id);

    if (error) throw error;
  },

  exportToCSV: (records) => {
    if (!records || records.length === 0) return;

    const headers = [
      'Type', 'Title', 'Date Created'
    ];

    const rows = records.map(r => [
      r.type.toUpperCase(),
      r.title,
      new Date(r.created_at).toLocaleDateString()
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `business_records_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
};
