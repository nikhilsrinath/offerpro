import { ref, push, update } from 'firebase/database';
import { doc, writeBatch, collection, getDoc } from 'firebase/firestore';
import { db, firestore } from '../lib/firebase';

/**
 * Dual-write service to save onboarding data simultaneously to RTDB (legacy)
 * and Firestore (new schema) in an atomic-like behavior.
 * 
 * If Firestore write fails, we log an error so it doesn't fail the user onboarding,
 * but RTDB maintains backwards compatibility.
 */
export const saveOrganizationData = async ({ userId, email, isGoogleUser, formData }) => {
    // 1. Generate core RTDB Push IDs (Deterministic)
    const orgRef = push(ref(db, 'organizations'));
    const orgId = orgRef.key;

    const empRef = push(ref(db, `organizations/${orgId}/employees`));
    const empId = empRef.key;

    const deptRef = push(ref(db, `organizations/${orgId}/departments`));
    const deptId = deptRef.key;

    const membershipRef = push(ref(db, 'memberships'));
    const membershipId = membershipRef.key;

    const timestamp = new Date().toISOString();

    // 2. Prepare Data Payloads
    const companyEmail = isGoogleUser ? email : formData.company_email;

    // Organization Data
    const orgData = {
        id: orgId,
        company_email: companyEmail,
        company_name: formData.company_name,
        company_website: formData.company_website || null,
        industry: formData.industry,
        company_description: formData.company_description,
        country: formData.country,
        city: formData.city,
        company_size: formData.company_size,
        owner_full_name: formData.owner_full_name,
        owner_role: formData.owner_role,
        primary_contact_name: formData.primary_contact_name || null,
        document_designation: formData.document_designation,
        use_cases: formData.use_cases,
        include_logo: formData.include_logo === 'Yes',
        logo_url: formData.logo_url || null,
        account_usage: formData.account_usage,
        referral_source: formData.referral_source || null,
        created_at: timestamp,
        owner_uid: userId
    };

    // Employee Data (Note: RTDB uses studentName, Firestore uses name)
    const rtdbEmpData = {
        id: empId,
        studentName: formData.owner_full_name, // Legacy field
        email: companyEmail,
        role: formData.owner_role || 'Founder',
        department: "Founder's Office",
        offerType: 'fulltime',
        is_owner: true,
        created_at: timestamp,
    };
    
    const firestoreEmpData = {
        id: empId,
        orgId: orgId, // Attached for Firestore flats
        name: formData.owner_full_name, // Normalized field
        email: companyEmail,
        role: formData.owner_role || 'Founder',
        department: "Founder's Office",
        offerType: 'fulltime',
        is_owner: true,
        created_at: timestamp,
    };

    // Department Data
    const deptData = {
        id: deptId,
        name: "Founder's Office",
        created_at: timestamp,
    };
    const firestoreDeptData = { ...deptData, orgId: orgId };

    // Membership Data
    const membershipData = {
        organization_id: orgId,
        user_id: userId,
        role: 'owner',
        created_at: timestamp
    };

    // 3. Prepare Updates
    // Nest the employee and department inside a specific RTDB-only payload to avoid the "ancestor path" error
    const rtdbOrgData = {
        ...orgData,
        employees: {
            [empId]: rtdbEmpData
        },
        departments: {
            [deptId]: deptData
        }
    };

    // We use a multi-path update for RTDB to make it atomic
    const rtdbUpdates = {
        [`organizations/${orgId}`]: rtdbOrgData,
        [`memberships/${membershipId}`]: membershipData,
        [`users/${userId}/organizations/${orgId}`]: true
    };

    // 4. Firestore Batch
    const batch = writeBatch(firestore);
    
    // Write org profile
    const orgDocRef = doc(firestore, 'organizations', orgId);
    batch.set(orgDocRef, orgData);

    // Write employee
    const empDocRef = doc(firestore, 'employees', empId);
    batch.set(empDocRef, firestoreEmpData);

    // Write department
    const deptDocRef = doc(firestore, 'departments', deptId);
    batch.set(deptDocRef, firestoreDeptData);

    // Write membership
    const memDocRef = doc(firestore, 'memberships', membershipId);
    batch.set(memDocRef, membershipData);

    // Write user profile metadata mapping
    const userDocRef = doc(firestore, 'users', userId);
    batch.set(userDocRef, { organizations: { [orgId]: true } }, { merge: true });

    // 5. Execute Dual-Write
    // Execute RTDB atomic update
    await update(ref(db), rtdbUpdates); 

    try {
        await batch.commit(); // Atomic Firestore update
        
        // Final sanity verification
        const verificationSnap = await getDoc(orgDocRef);
        if (verificationSnap.exists()) {
            console.log(`[DualWriteService] ✅ Successfully synced and verified Org ${orgId} in Firestore.`);
        } else {
            console.error(`[DualWriteService] ⚠️ Sync claimed success but verification read failed for Org ${orgId}.`);
        }

    } catch (fsError) {
        console.error(`[CRITICAL ERROR] Failed to write Org ${orgId} to Firestore!`, fsError);
        // We do NOT throw here to preserve backwards compatibility and ensure users can use the app.
    }

    return orgId;
};
