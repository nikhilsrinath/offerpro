/**
 * EdgeOS migration · Step 1 — Extract
 *
 * Pulls everything out of Firebase into one raw JSON file, reconciling the
 * THREE places the app wrote the same data:
 *
 *   1. RTDB   organizations/{orgId}/{section}          (orgStore write path)
 *   2. Firestore flat collections  employees, fin_docs, …  tagged with orgId
 *      (orgStore.syncToFirestore, orgStore.js:112-139)
 *   3. Firestore SUBcollection  organizations/{orgId}/fin_docs
 *      (admin/index.html:595 — a fourth shape only the admin panel used)
 *
 * Plus paths orgStore never knew about:
 *   · RTDB organizations/{orgId}/hr_records   (admin/index.html:590)
 *   · RTDB memory/{orgId} and Firestore memory/{orgId}  (companyMemory.ts:151,289)
 *   · org_metadata/{orgId}  → fin_notifs, fin_recurring, hierarchy
 *
 * Reconciliation rule: for a given (section, id), the copy with the later
 * updated_at wins; ties go to Firestore, which orgStore treated as primary.
 * Every divergence is recorded in divergences.json for review — do not skip it,
 * because writes were fire-and-forget (`.catch(() => {})`, orgStore.js:384) and
 * the stores are genuinely expected to disagree.
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *   node scripts/migrate/01-extract.js --out .migration/raw
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getFirestore } from 'firebase-admin/firestore';

const KEYED_SECTIONS = [
  'employees', 'ex_employees', 'departments', 'customers',
  'expenses', 'records', 'fin_docs', 'products', 'crm_leads', 'tasks',
];
const METADATA_SECTIONS = ['fin_notifs', 'fin_recurring', 'hierarchy'];

const args = Object.fromEntries(process.argv.slice(2).flatMap((a, i, arr) =>
  a.startsWith('--') ? [[a.slice(2), arr[i + 1]]] : []));
const outDir = args.out ?? '.migration/raw';
const databaseURL = args.db ?? process.env.FIREBASE_DATABASE_URL
  ?? 'https://offerpro-892b9-default-rtdb.asia-southeast1.firebasedatabase.app';

initializeApp({
  credential: process.env.GOOGLE_APPLICATION_CREDENTIALS
    ? applicationDefault()
    : cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT ?? '{}')),
  databaseURL,
});

const rtdb = getDatabase();
const fs   = getFirestore();

const divergences = [];
const stats = { rtdbOnly: 0, firestoreOnly: 0, both: 0, conflicts: 0 };

const val = async (path) => (await rtdb.ref(path).get()).val();
const millis = (v) => {
  const t = v?.updated_at ?? v?.updatedAt ?? v?.created_at ?? v?.createdAt;
  if (!t) return 0;
  if (typeof t === 'object' && t._seconds) return t._seconds * 1000;
  const d = new Date(t); return Number.isNaN(d.getTime()) ? 0 : d.getTime();
};

/** Merge one section from every store, newest-wins, recording disagreements. */
function reconcile(orgId, section, fromRtdb = {}, fromFirestore = {}, fromSub = {}) {
  const merged = {};
  const ids = new Set([
    ...Object.keys(fromRtdb ?? {}),
    ...Object.keys(fromFirestore ?? {}),
    ...Object.keys(fromSub ?? {}),
  ]);

  for (const id of ids) {
    const candidates = [
      fromRtdb?.[id]      && { src: 'rtdb',      v: fromRtdb[id] },
      fromFirestore?.[id] && { src: 'firestore', v: fromFirestore[id] },
      fromSub?.[id]       && { src: 'subcoll',   v: fromSub[id] },
    ].filter(Boolean);

    if (candidates.length === 1) {
      candidates[0].src === 'rtdb' ? stats.rtdbOnly++ : stats.firestoreOnly++;
      merged[id] = candidates[0].v;
      continue;
    }
    stats.both++;

    candidates.sort((a, b) => {
      const d = millis(b.v) - millis(a.v);
      return d !== 0 ? d : (a.src === 'firestore' ? -1 : 1);   // tie → firestore
    });
    merged[id] = candidates[0].v;

    const differing = candidates.filter(c =>
      JSON.stringify(c.v) !== JSON.stringify(candidates[0].v));
    if (differing.length) {
      stats.conflicts++;
      divergences.push({
        orgId, section, id, winner: candidates[0].src,
        stores: Object.fromEntries(candidates.map(c => [c.src, c.v])),
      });
    }
  }
  return merged;
}

async function firestoreByOrg(collection, orgId) {
  const snap = await fs.collection(collection).where('orgId', '==', orgId).get();
  return Object.fromEntries(snap.docs.map(d => [d.id, d.data()]));
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  console.log('\n  Extracting from Firebase…\n');

  // Organization ids from every place they were recorded.
  const orgIds = new Set();
  Object.keys((await val('organizations')) ?? {}).forEach(id => orgIds.add(id));
  (await fs.collection('organizations').get()).docs.forEach(d => orgIds.add(d.id));
  Object.values((await val('memberships')) ?? {}).forEach(m => m?.organization_id && orgIds.add(m.organization_id));
  (await fs.collection('memberships').get()).docs.forEach(d => {
    const o = d.data()?.organization_id; if (o) orgIds.add(o);
  });
  console.log(`  ${orgIds.size} organization(s) found\n`);

  // Memberships, indexed by org.
  const membershipsByOrg = new Map();
  const addMembership = (m) => {
    if (!m?.organization_id || !m?.user_id) return;
    const list = membershipsByOrg.get(m.organization_id) ?? [];
    if (!list.some(x => x.user_id === m.user_id)) list.push(m);
    membershipsByOrg.set(m.organization_id, list);
  };
  Object.values((await val('memberships')) ?? {}).forEach(addMembership);
  (await fs.collection('memberships').get()).docs.forEach(d => addMembership(d.data()));

  const organizations = {};

  for (const orgId of orgIds) {
    process.stdout.write(`  · ${orgId} `);

    const rtdbOrg = (await val(`organizations/${orgId}`)) ?? {};
    const fsOrgDoc = await fs.doc(`organizations/${orgId}`).get();
    const fsMetaDoc = await fs.doc(`org_metadata/${orgId}`).get();

    // Profile: RTDB kept it both nested under _profile and flattened at the root
    // (orgStore.js:229-233). Firestore is primary and wins field-by-field.
    const profile = {
      ...(rtdbOrg._profile ?? {}),
      ...Object.fromEntries(Object.entries(rtdbOrg).filter(
        ([, v]) => typeof v !== 'object' || v === null)),
      ...(fsOrgDoc.exists ? fsOrgDoc.data() : {}),
    };

    const org = { profile, memberships: membershipsByOrg.get(orgId) ?? [] };

    for (const section of KEYED_SECTIONS) {
      let sub = {};
      if (section === 'fin_docs') {
        // The subcollection only the admin panel ever wrote.
        const subSnap = await fs.collection(`organizations/${orgId}/fin_docs`).get().catch(() => null);
        if (subSnap) sub = Object.fromEntries(subSnap.docs.map(d => [d.id, d.data()]));
      }
      org[section] = reconcile(
        orgId, section,
        rtdbOrg[section] ?? {},
        await firestoreByOrg(section, orgId),
        sub,
      );
    }

    // Legacy RTDB path the admin panel read but orgStore never knew about.
    org.hr_records = rtdbOrg.hr_records ?? {};

    const meta = fsMetaDoc.exists ? fsMetaDoc.data() : {};
    for (const section of METADATA_SECTIONS) {
      org[section] = meta[section] ?? rtdbOrg[section] ?? (section === 'fin_recurring' ? [] : {});
    }

    // AI company memory (data preservation only).
    const fsMemory = await fs.doc(`memory/${orgId}`).get();
    org.memory = fsMemory.exists ? fsMemory.data() : ((await val(`memory/${orgId}`)) ?? {});

    organizations[orgId] = org;

    const n = KEYED_SECTIONS.reduce((a, s) => a + Object.keys(org[s]).length, 0);
    console.log(`— ${n} rows`);
  }

  writeFileSync(join(outDir, 'firebase-export.json'),
    JSON.stringify({ exportedAt: new Date().toISOString(), organizations }, null, 2));
  writeFileSync(join(outDir, 'divergences.json'), JSON.stringify(divergences, null, 2));

  console.log('\n  Store reconciliation');
  console.log(`    ${String(stats.both).padStart(7)}  present in more than one store`);
  console.log(`    ${String(stats.rtdbOnly).padStart(7)}  RTDB only`);
  console.log(`    ${String(stats.firestoreOnly).padStart(7)}  Firestore only`);
  console.log(`    ${String(stats.conflicts).padStart(7)}  DISAGREED between stores -> divergences.json`);
  if (stats.conflicts) {
    console.log('\n  Review divergences.json before loading. Writes were fire-and-forget');
    console.log('  (orgStore.js:384 `.catch(() => {})`), so disagreement is expected.\n');
  }
  console.log(`\n  Wrote ${join(outDir, 'firebase-export.json')}`);
  console.log('\n  Also run, BEFORE decommissioning the Firebase project:');
  console.log('    firebase auth:export .migration/raw/users.json --format=json \\');
  console.log('      --project offerpro-892b9');
  console.log('  and capture signerKey / saltSeparator / rounds / memCost from the');
  console.log('  console — without them, every email/password user needs a reset.\n');
  process.exit(0);
}

main().catch(e => { console.error('\n  Extract failed:', e); process.exit(1); });
