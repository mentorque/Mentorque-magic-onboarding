import { db, sql, usersTable } from '@workspace/db';

export async function getOrCreateUser(firebaseUid: string, email: string | null, name: string | null) {
  const existingUser = await db.execute(
    sql`SELECT * FROM users WHERE firebase_uid = ${firebaseUid} LIMIT 1`
  );
  
  if (existingUser.rows.length > 0) {
    const user = existingUser.rows[0] as any;
    if (user.email !== email || user.name !== name) {
      await db.execute(
        sql`UPDATE users SET email = ${email || ''}, name = ${name || ''}, updated_at = NOW() WHERE firebase_uid = ${firebaseUid}`
      );
    }
    return user;
  }

  const result = await db.execute(
    sql`INSERT INTO users (id, firebase_uid, email, name) VALUES (gen_random_uuid()::varchar(50), ${firebaseUid}, ${email || ''}, ${name || ''}) RETURNING *`
  );

  return result.rows[0];
}