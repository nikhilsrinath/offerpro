import React, { createContext, useContext, useEffect, useState } from 'react';
import { ref, get, push, set, update } from 'firebase/database';
import { doc, getDoc, getDocs, collection, query, where, setDoc, writeBatch } from 'firebase/firestore';
import { db, firestore } from '../lib/firebase';
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
      // Fetch memberships from Firestore where user_id matches
      const membershipsQuery = query(collection(firestore, 'memberships'), where('user_id', '==', user.uid));
      const membershipsSnap = await getDocs(membershipsQuery);

      if (membershipsSnap.empty) {
        setOrganizations([]);
        setActiveOrg(null);
        setLoading(false);
        return;
      }

      const orgs = [];
      const membershipData = membershipsSnap.docs.map(doc => doc.data());

      for (const mem of membershipData) {
        const orgId = mem.organization_id;
        if (!orgId) continue;

        // Load entire org data via orgStore (which we'll refactor next to hit Firestore)
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

    const timestamp = new Date().toISOString();
    const orgData = {
      id: orgId,
      company_name: name,
      company_email: user.email,
      owner_uid: user.uid,
      created_at: timestamp
    };

    const membershipRef = push(ref(db, 'memberships'));
    const membershipId = membershipRef.key;
    const membershipData = {
      organization_id: orgId,
      user_id: user.uid,
      role: 'owner',
      created_at: timestamp
    };

    // Dual-Write (RTDB)
    const rtdbUpdates = {
      [`organizations/${orgId}`]: orgData,
      [`memberships/${membershipId}`]: membershipData,
      [`users/${user.uid}/organizations/${orgId}`]: true
    };
    await update(ref(db), rtdbUpdates);

    // Dual-Write (Firestore)
    try {
      const batch = writeBatch(firestore);
      batch.set(doc(firestore, 'organizations', orgId), orgData);
      batch.set(doc(firestore, 'memberships', membershipId), membershipData);
      batch.set(doc(firestore, 'users', user.uid), { organizations: { [orgId]: true } }, { merge: true });
      await batch.commit();
    } catch (err) {
      console.error("[OrgContext] Firestore dual-write failed:", err);
    }

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
