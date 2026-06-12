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

  const fetchOrganizationIds = async () => {
    const orgIds = new Set(orgStore.getLocalOrgIds(user.uid));

    try {
      const membershipsQuery = query(collection(firestore, 'memberships'), where('user_id', '==', user.uid));
      const membershipsSnap = await getDocs(membershipsQuery);
      membershipsSnap.docs.forEach((membershipDoc) => {
        const orgId = membershipDoc.data()?.organization_id;
        if (orgId) orgIds.add(orgId);
      });
    } catch (err) {
      console.warn("Could not fetch Firestore memberships:", err.message);
    }

    try {
      const userDocSnap = await getDoc(doc(firestore, 'users', user.uid));
      const firestoreOrgs = userDocSnap.exists() ? userDocSnap.data()?.organizations || {} : {};
      Object.keys(firestoreOrgs).forEach((orgId) => orgIds.add(orgId));
    } catch (err) {
      console.warn("Could not fetch Firestore user orgs:", err.message);
    }

    try {
      const legacyOrgsSnap = await get(ref(db, `users/${user.uid}/organizations`));
      if (legacyOrgsSnap.exists()) {
        Object.keys(legacyOrgsSnap.val() || {}).forEach((orgId) => orgIds.add(orgId));
      }
    } catch (err) {
      console.warn("Could not fetch legacy user orgs:", err.message);
    }

    return [...orgIds];
  };

  const fetchOrganizations = async () => {
    setLoading(true);
    try {
      const organizationIds = await fetchOrganizationIds();

      if (organizationIds.length === 0) {
        const localOrg = orgStore.ensureLocalOrg(user.uid, user.email);
        setOrganizations([localOrg]);
        setActiveOrg(localOrg);
        setLoading(false);
        return;
      }

      const orgs = [];

      for (const orgId of organizationIds) {
        // Load entire org data via orgStore (which we'll refactor next to hit Firestore)
        await orgStore.load(orgId);
        const profile = orgStore.getProfile();
        
        if (Object.keys(profile || {}).length > 0) {
          orgStore.registerLocalOrg(user.uid, orgId);
          orgs.push({
            id: orgId,
            name: profile.company_name || profile.name || 'Local Workspace',
            ...profile,
          });
        }
      }

      const nextOrgs = orgs.length > 0 ? orgs : [orgStore.ensureLocalOrg(user.uid, user.email)];
      setOrganizations(nextOrgs);
      if (nextOrgs.length > 0) {
        setActiveOrg(nextOrgs[0]);
        // Ensure orgStore is pointed at the active org
        await orgStore.load(nextOrgs[0].id);
      }
    } catch (err) {
      console.warn("Could not fetch organizations:", err);
      const localOrg = orgStore.ensureLocalOrg(user.uid, user.email);
      setOrganizations([localOrg]);
      setActiveOrg(localOrg);
    } finally {
      setLoading(false);
    }
  };

  const createOrganization = async (name) => {
    const timestamp = new Date().toISOString();
    let orgRef = null;
    try {
      orgRef = push(ref(db, 'organizations'));
    } catch {
      orgRef = null;
    }
    const orgId = orgRef?.key || orgStore.localOrgIdForUser(user.uid);
    const orgData = {
      id: orgId,
      company_name: name,
      company_email: user.email,
      owner_uid: user.uid,
      created_at: timestamp
    };

    let membershipRef = null;
    try {
      membershipRef = push(ref(db, 'memberships'));
    } catch {
      membershipRef = null;
    }
    const membershipId = membershipRef?.key || `local_membership_${user.uid}`;
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
    orgStore.registerLocalOrg(user.uid, orgId);
    await orgStore.load(orgId);
    await orgStore.updateProfile(orgData);
    setOrganizations([{ id: orgId, name: orgData.company_name, ...orgData }]);
    setActiveOrg({ id: orgId, name: orgData.company_name, ...orgData });

    update(ref(db), rtdbUpdates).catch((err) => {
      console.warn("[OrgContext] RTDB org sync failed:", err.message);
    });

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

    return orgData;
  };

  const updateOrganization = async (orgId, updates) => {
    await orgStore.updateProfile(updates);
    const updatedOrg = {
      ...(activeOrg || {}),
      id: orgId,
      name: updates.company_name || activeOrg?.name || activeOrg?.company_name || 'Local Workspace',
      ...updates,
    };
    setActiveOrg(updatedOrg);
    setOrganizations((prev) => {
      const next = prev.length > 0 ? prev : [updatedOrg];
      return next.map((org) => (org.id === orgId ? { ...org, ...updatedOrg } : org));
    });
  };

  return (
    <OrgContext.Provider value={{ organizations, activeOrg, setActiveOrg, loading, createOrganization, updateOrganization, fetchOrganizations }}>
      {children}
    </OrgContext.Provider>
  );
};

export const useOrg = () => useContext(OrgContext);
