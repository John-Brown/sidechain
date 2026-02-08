import { createDb, type Database, profiles } from "@annotation/db";
import { eq } from "drizzle-orm";
import type { RequestEvent } from "@sveltejs/kit";

export interface UserInfo {
  id: string;
  displayName: string | null;
  role: "admin" | "supervisor" | "annotator";
}

export interface Context {
  db: Database;
  user: UserInfo | null;
}

let _db: Database | null = null;

function getDb(): Database {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    _db = createDb(url);
  }
  return _db;
}

async function verifySupabaseJwt(token: string): Promise<{ sub: string } | null> {
  const SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;

  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_SERVICE_KEY,
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { id?: string };
    if (!data.id) return null;
    return { sub: data.id };
  } catch {
    return null;
  }
}

function extractToken(event: RequestEvent): string | null {
  const authHeader = event.request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  // Fall back to cookie-based auth (Supabase stores tokens in cookies)
  const accessToken = event.cookies.get("sb-access-token");
  if (accessToken) return accessToken;

  // Check for the standard supabase auth cookie pattern
  const allCookies = event.request.headers.get("cookie") ?? "";
  const match = allCookies.match(/sb-[^-]+-auth-token=([^;]+)/);
  if (match) {
    try {
      const parsed = JSON.parse(decodeURIComponent(match[1])) as { access_token?: string };
      return parsed.access_token ?? null;
    } catch {
      return null;
    }
  }

  return null;
}

export async function createContext(event: RequestEvent): Promise<Context> {
  const db = getDb();
  const token = extractToken(event);

  if (!token) {
    return { db, user: null };
  }

  const payload = await verifySupabaseJwt(token);
  if (!payload) {
    return { db, user: null };
  }

  const [profile] = await db
    .select({
      id: profiles.id,
      displayName: profiles.displayName,
      role: profiles.role,
    })
    .from(profiles)
    .where(eq(profiles.id, payload.sub))
    .limit(1);

  if (!profile) {
    return { db, user: null };
  }

  return {
    db,
    user: {
      id: profile.id,
      displayName: profile.displayName,
      role: profile.role,
    },
  };
}
