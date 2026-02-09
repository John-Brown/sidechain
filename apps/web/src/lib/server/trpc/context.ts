import { createDb, type Database, profiles } from "@annotation/db";
import { eq } from "drizzle-orm";
import type { RequestEvent } from "@sveltejs/kit";
import { DATABASE_URL } from "$env/static/private";

export interface UserInfo {
  id: string;
  displayName: string | null;
  email: string | null;
  role: "admin" | "supervisor" | "annotator";
}

export interface Context {
  db: Database;
  user: UserInfo | null;
}

let _db: Database | null = null;

function getDb(): Database {
  if (!_db) {
    if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");
    _db = createDb(DATABASE_URL);
  }
  return _db;
}

export async function createContext(event: RequestEvent): Promise<Context> {
  const db = getDb();

  // Use the Supabase server client from hooks — handles chunked cookies properly
  const { session, user: supabaseUser } = await event.locals.safeGetSession();

  if (!session || !supabaseUser) {
    return { db, user: null };
  }

  const profileSelect = {
    id: profiles.id,
    displayName: profiles.displayName,
    email: profiles.email,
    role: profiles.role,
  };

  // Look up profile
  let [profile] = await db
    .select(profileSelect)
    .from(profiles)
    .where(eq(profiles.id, supabaseUser.id))
    .limit(1);

  // Auto-create profile for new users
  if (!profile) {
    const displayName = supabaseUser.user_metadata?.full_name
      ?? supabaseUser.email?.split("@")[0]
      ?? null;

    [profile] = await db
      .insert(profiles)
      .values({
        id: supabaseUser.id,
        displayName,
        email: supabaseUser.email ?? null,
        role: "annotator",
      })
      .onConflictDoNothing()
      .returning(profileSelect);

    // In case of race condition where onConflictDoNothing returned nothing
    if (!profile) {
      [profile] = await db
        .select(profileSelect)
        .from(profiles)
        .where(eq(profiles.id, supabaseUser.id))
        .limit(1);
    }
  }

  if (!profile) {
    return { db, user: null };
  }

  // Backfill email if missing (for profiles created before email column existed)
  if (!profile.email && supabaseUser.email) {
    await db
      .update(profiles)
      .set({ email: supabaseUser.email })
      .where(eq(profiles.id, profile.id));
    profile.email = supabaseUser.email;
  }

  return {
    db,
    user: {
      id: profile.id,
      displayName: profile.displayName,
      email: profile.email,
      role: profile.role,
    },
  };
}
