import React, { createContext, useContext, useEffect, useState } from 'react';
import { ref, get, push, set, update } from 'firebase/database';
import { db } from '../lib/firebase';
import { useAuth } from './AuthContext';
import { orgStore } from '../services/orgStore';

const OrgContext = createContext({});

export const OrgProvider = ({ children }) => {
  const { user, needsOnboarding } = useAuth();
  const [organizations, setOrganizations] = useState([]);
  const [activeOrg, setActiveOrg] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user && !needsOnboarding) {
      fetchOrganizations();
    } else {
      setOrganizations([]);
      setActiveOrg(null);
      orgStore.clear();
      setLoading(false);
    }
  }, [user, needsOnboarding]);

  const fetchOrganizations = async () => {
    setLoading(true);
    try {
      const userOrgsRef = ref(db, `users/${user.uid}/organizations`);
      const snapshot = await get(userOrgsRef);

      if (!snapshot.exists()) {
        setOrganizations([]);
        setActiveOrg(null);
        setLoading(false);
        return;
      }

      const orgIds = Object.keys(snapshot.val());
      const orgs = [];

      for (const orgId of orgIds) {
        // Load entire org data via orgStore (fetches from Firebase, caches in localStorage)
        const orgData = await orgStore.load(orgId);
        const profile = orgStore.getProfile();
        if (profile.company_name || profile.owner_uid) {
          orgs.push({
            id: orgId,
            name: profile.company_name,
            ...profile,
          });
        }
      }

      setOrganizations(orgs);
      if (orgs.length > 0) {
        setActiveOrg(orgs[0]);
        // Ensure orgStore is pointed at the active org
        await orgStore.load(orgs[0].id);
      }
    } catch (err) {
      console.warn("Could not fetch organizations:", err);
    } finally {
      setLoading(false);
    }
  };

  const createOrganization = async (name) => {
    const orgRef = push(ref(db, 'organizations'));
    const orgId = orgRef.key;

    const orgData = {
      id: orgId,
      company_name: name,
      company_email: user.email,
      owner_uid: user.uid,
      created_at: new Date().toISOString()
    };

    await set(orgRef, orgData);

    const membershipRef = push(ref(db, 'memberships'));
    await set(membershipRef, {
      organization_id: orgId,
      user_id: user.uid,
      role: 'owner',
      created_at: new Date().toISOString()
    });

    await set(ref(db, `users/${user.uid}/organizations/${orgId}`), true);
    await fetchOrganizations();
    return orgData;
  };

  const updateOrganization = async (orgId, updates) => {
    // Update Firebase + orgStore cache
    await orgStore.updateProfile(updates);
    await fetchOrganizations();
  };

  return (
    <OrgContext.Provider value={{ organizations, activeOrg, setActiveOrg, loading, createOrganization, updateOrganization, fetchOrganizations }}>
      {children}
    </OrgContext.Provider>
  );
};

export const useOrg = () => useContext(OrgContext);
