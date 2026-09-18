import { supabaseAdmin } from './_lib/supabaseAdmin.js';
import { requireUser, requireOrgRole, sendError, methodIs, HttpError } from './_lib/auth.js';

/**
 * GET /api/export?org_id=…
 * Headers: Authorization: Bearer <supabase access token>
 *
 * Everything one tenant's account contains, as a single JSON document, for an
 * owner or admin of that tenant. FIX_PLAN item 9: "Customer 'Export all data' →
 * authenticated function returning every collection, excluding org_secrets."
 *
 * Why this exists, beyond a feature request: until there is an export, the only
 * copy of a customer's data is in a database they cannot reach, which makes
 * "can we leave?" unanswerable and makes any restore test a test of our backups
 * rather than of their data. It is also the GDPR/DPDP portability obligation for
 * whichever of their own records they hold as a controller.
 *
 * Deliberately NOT included:
 *
 *   org_secrets   the encrypted Gmail password. It is not the customer's data in
 *                 any useful sense — it is a credential, it would be ciphertext
 *                 without the server key, and an export that contains it turns
 *                 every downloaded file into a secret to look after.
 *   portal_tokens live credentials for documents. The audit trail of who was sent
 *                 what is in document_signatures and audit_log instead.
 *   legacy_id_map internal Firebase→Postgres plumbing, meaningless to the reader.
 *
 * Storage objects are referenced by signed URL rather than inlined: a logo and a
 * stamp are small, but signatures and PDFs are not, and a base64 payload inside
 * JSON is the difference between an export that streams and one that exhausts
 * the function's memory on a large tenant. The URLs are valid for 7 days, which
 * is stated in the manifest.
 */

// Tables keyed directly by org_id.
const ORG_TABLES = [
  'organizations', 'org_banking', 'org_settings', 'subscriptions',
  'usage_counters', 'memberships', 'departments', 'employees',
  'employee_compensation', 'tasks', 'clients', 'products', 'catalog_items',
  'expenses', 'records', 'financial_documents', 'payments',
  'recurring_invoices', 'document_signatures', 'notifications', 'invitations',
  'audit_log', 'document_counters', 'ai_company_memory',
  // The legacy pair. Still present until M9 drops them, and a customer's export
  // should not silently omit rows that are still in the database.
  'customers', 'crm_leads',
];

// Children reached through their parent rather than by org_id.
const CHILD_TABLES = {
  document_line_items: { parent: 'financial_documents', fk: 'document_id' },
};

const SIGNED_URL_TTL = 7 * 24 * 60 * 60;
const BUCKETS = ['org-branding', 'signatures', 'uploads'];

export default async function handler(req, res) {
  if (!methodIs(req, res, 'GET')) return;

  try {
    const user = await requireUser(req);
    const orgId = new URL(req.url, 'http://localhost').searchParams.get('org_id');

    // An export is the whole tenant, salaries and banking included. Only the
    // roles that can already read those tables may pull the file.
    await requireOrgRole(user.id, orgId, 'admin');

    const admin = supabaseAdmin();
    const data = {};
    const counts = {};
    const skipped = {};

    for (const table of ORG_TABLES) {
      const { data: rows, error } = await admin.from(table).select('*').eq('org_id', orgId);
      if (error) {
        // A table that does not exist yet in this environment (or was dropped by
        // a later migration) must not fail the whole export. Record it and move
        // on, so the file says what it is missing instead of being absent.
        skipped[table] = error.message;
        continue;
      }
      data[table] = rows || [];
      counts[table] = rows?.length || 0;
    }

    for (const [table, def] of Object.entries(CHILD_TABLES)) {
      const parentIds = (data[def.parent] || []).map((r) => r.id);
      if (!parentIds.length) {
        data[table] = [];
        counts[table] = 0;
        continue;
      }
      const { data: rows, error } = await admin.from(table).select('*').in(def.fk, parentIds);
      if (error) {
        skipped[table] = error.message;
        continue;
      }
      data[table] = rows || [];
      counts[table] = rows?.length || 0;
    }

    const files = await listFiles(orgId);

    // Set headers as statements, not as a chain: Node's setHeader() returns the
    // raw ServerResponse, which has no .json().
    res.setHeader('Content-Disposition',
      `attachment; filename="edgeos-export-${orgId}-${today()}.json"`);

    return res.status(200).json({
        success: true,
        manifest: {
          org_id: orgId,
          exported_at: new Date().toISOString(),
          exported_by: user.email || user.id,
          schema_note: 'One key per table. Row shapes are the Postgres columns, not the app field names.',
          row_counts: counts,
          file_urls_expire_at: new Date(Date.now() + SIGNED_URL_TTL * 1000).toISOString(),
          excluded: [
            'org_secrets — encrypted email credential, not exportable by design',
            'portal_tokens — live document credentials',
            'legacy_id_map — internal migration plumbing',
          ],
          ...(Object.keys(skipped).length ? { unavailable: skipped } : {}),
        },
        files,
        data,
      });
  } catch (err) {
    return sendError(res, err, 'api/export');
  }
}

/**
 * Every stored object belonging to this org, with a signed URL.
 *
 * Each bucket is laid out with the org id as the first path segment (0004), so
 * one list per bucket at that prefix is the whole set.
 */
async function listFiles(orgId) {
  const admin = supabaseAdmin();
  const out = {};

  for (const bucket of BUCKETS) {
    const { data: entries, error } = await admin.storage.from(bucket).list(orgId, { limit: 1000 });
    if (error || !entries?.length) {
      out[bucket] = [];
      continue;
    }

    out[bucket] = [];
    for (const entry of entries) {
      // A folder comes back with no id; recurse one level, which is as deep as
      // any of the three buckets goes (org/portal/…, org/<kind>/…).
      const isFolder = !entry.id;
      const paths = isFolder
        ? await listFolder(bucket, `${orgId}/${entry.name}`)
        : [`${orgId}/${entry.name}`];

      for (const path of paths) {
        const { data: signed } = await admin.storage.from(bucket).createSignedUrl(path, SIGNED_URL_TTL);
        out[bucket].push({ path, url: signed?.signedUrl || null });
      }
    }
  }
  return out;
}

async function listFolder(bucket, prefix) {
  const { data, error } = await supabaseAdmin().storage.from(bucket).list(prefix, { limit: 1000 });
  if (error || !data) return [];
  return data.filter((e) => e.id).map((e) => `${prefix}/${e.name}`);
}

const today = () => new Date().toISOString().slice(0, 10);
