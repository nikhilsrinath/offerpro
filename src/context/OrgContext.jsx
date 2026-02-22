import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from './AuthContext';

const OrgContext = createContext({});

export const OrgProvider = ({ children }) => {
  const { user } = useAuth();
  const [organizations, setOrganizations] = useState([]);
  const [activeOrg, setActiveOrg] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      fetchOrganizations();
    } else {
      setOrganizations([]);
      setActiveOrg(null);
      setLoading(false);
    }
  }, [user]);

  const fetchOrganizations = async () => {
    setLoading(true);
    // This assumes a 'memberships' table that joins users to organizations
    // For now, we'll implement a fallback if the table doesn't exist yet
    try {
      const { data, error } = await supabase
        .from('organizations')
        .select('*, memberships!inner(user_id)')
        .eq('memberships.user_id', user.id);

      if (error) throw error;
      setOrganizations(data);
      if (data.length > 0) setActiveOrg(data[0]);
    } catch (err) {
      console.warn("Could not fetch organizations. Make sure your database schema is set up.", err);
    } finally {
      setLoading(false);
    }
  };

  const createOrganization = async (name) => {
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .insert([{ name }])
      .select()
      .single();

    if (orgError) throw orgError;

    const { error: memError } = await supabase
      .from('memberships')
      .insert([{ organization_id: org.id, user_id: user.id, role: 'owner' }]);

    if (memError) throw memError;

    await fetchOrganizations();
    return org;
  };

  return (
    <OrgContext.Provider value={{ organizations, activeOrg, setActiveOrg, loading, createOrganization }}>
      {children}
    </OrgContext.Provider>
  );
};

export const useOrg = () => useContext(OrgContext);
