import { pool } from "@workspace/db";

/** Matches shared Prisma `User` table (same DB as Extension_Pro / ResumeCompiler). */
function generateCuidLike(): string {
  const ts = Date.now().toString(36);
  const r =
    Math.random().toString(36).slice(2, 12) +
    Math.random().toString(36).slice(2, 12);
  return `c${ts}${r}`.slice(0, 32);
}

export type MentorqueUser = {
  id: string;
  mentorqueUserId: string;
  email: string;
  fullName: string | null;
  /** Display name for UI */
  name: string;
  firebaseUid: string;
};

/**
 * Upsert user in Prisma `"User"` table after Firebase OAuth (same pattern as Platform `/api/users/me`).
 */
export async function getOrCreateUser(
  firebaseUid: string,
  email: string | null,
  name: string | null,
): Promise<MentorqueUser> {
  const emailSafe =
    (email && email.trim()) || `${firebaseUid}@firebase.noemail.local`;
  const fullName = name?.trim() || null;

  const existing = await pool.query<{
    id: string;
    email: string;
    fullName: string | null;
    firebaseUid: string;
  }>(
    `SELECT id, email, "fullName", "firebaseUid" FROM "User" WHERE "firebaseUid" = $1 LIMIT 1`,
    [firebaseUid],
  );

  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    await pool.query(
      `UPDATE "User" SET email = $1, "fullName" = COALESCE($2, "fullName"), "updatedAt" = NOW() WHERE id = $3`,
      [emailSafe, fullName, row.id],
    );
    const displayName = fullName ?? row.fullName;
    return {
      id: row.id,
      mentorqueUserId: row.id,
      email: emailSafe,
      fullName: displayName,
      name: displayName || emailSafe,
      firebaseUid,
    };
  }

  const id = generateCuidLike();
  const ins = await pool.query<{
    id: string;
    email: string;
    fullName: string | null;
    firebaseUid: string;
  }>(
    `INSERT INTO "User" (id, "firebaseUid", email, "fullName", "createdAt", "updatedAt", "goalPerDay", "verifiedByAdmin")
     VALUES ($1, $2, $3, $4, NOW(), NOW(), 3, false)
     RETURNING id, email, "fullName", "firebaseUid"`,
    [id, firebaseUid, emailSafe, fullName],
  );
  const r = ins.rows[0];
  return {
    id: r.id,
    mentorqueUserId: r.id,
    email: r.email,
    fullName: r.fullName,
    name: r.fullName || r.email,
    firebaseUid: r.firebaseUid,
  };
}
