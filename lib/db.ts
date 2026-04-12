import { sql } from "@vercel/postgres";

export { sql };

// ── Schema migration (run once on first deploy) ────────────────────────────

export async function ensureSchema() {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email         TEXT UNIQUE NOT NULL,
      name          TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL CHECK (role IN ('admin','editor','viewer')),
      tabs          TEXT[] NOT NULL DEFAULT '{}',
      is_active     BOOLEAN NOT NULL DEFAULT true,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS saved_plans (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name         TEXT NOT NULL,
      notes        TEXT,
      type         TEXT NOT NULL CHECK (type IN ('appointments','canvass')),
      created_by   UUID NOT NULL REFERENCES users(id),
      visibility   TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','shared','link')),
      share_token  TEXT UNIQUE,
      inputs       JSONB NOT NULL,
      result       JSONB NOT NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS audit_log (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
      user_name     TEXT,
      action        TEXT NOT NULL,
      resource_type TEXT,
      resource_id   TEXT,
      resource_name TEXT,
      metadata      JSONB,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

// ── Audit helper ───────────────────────────────────────────────────────────

export async function writeAudit({
  userId,
  userName,
  action,
  resourceType,
  resourceId,
  resourceName,
  metadata,
}: {
  userId?: string | null;
  userName?: string | null;
  action: string;
  resourceType?: string;
  resourceId?: string;
  resourceName?: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    await sql`
      INSERT INTO audit_log (user_id, user_name, action, resource_type, resource_id, resource_name, metadata)
      VALUES (
        ${userId ?? null},
        ${userName ?? null},
        ${action},
        ${resourceType ?? null},
        ${resourceId ?? null},
        ${resourceName ?? null},
        ${metadata ? JSON.stringify(metadata) : null}
      )
    `;
  } catch {
    // Audit failures must never break the main flow
    console.error("Audit write failed for action:", action);
  }
}
