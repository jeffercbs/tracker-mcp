import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import { supabaseAnonKey, supabaseUrl } from "../config/env.js"
import { loadSession, saveSession, type StoredSession } from "./session-store.js"

export class NotAuthenticatedError extends Error {
  constructor() {
    super(
      "No hay una sesión de my-tracker guardada. Corré la tool `login` (o `npm run login` en el servidor MCP) para iniciar sesión."
    )
    this.name = "NotAuthenticatedError"
  }
}

export function createAnonClient(): SupabaseClient {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function refreshIfNeeded(session: StoredSession): Promise<StoredSession> {
  const now = Math.floor(Date.now() / 1000)
  if (session.expiresAt - now > 60) {
    return session
  }

  const client = createAnonClient()
  const { data, error } = await client.auth.refreshSession({
    refresh_token: session.refreshToken,
  })

  if (error || !data.session) {
    throw new NotAuthenticatedError()
  }

  const refreshed: StoredSession = {
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    expiresAt: data.session.expires_at ?? now + 3600,
    userId: data.session.user.id,
    email: data.session.user.email ?? session.email,
  }
  saveSession(refreshed)
  return refreshed
}

export interface AuthenticatedClient {
  client: SupabaseClient
  userId: string
  email: string
}

export async function getUserClient(): Promise<AuthenticatedClient> {
  const stored = loadSession()
  if (!stored) {
    throw new NotAuthenticatedError()
  }

  const session = await refreshIfNeeded(stored)

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
      },
    },
  })

  return { client, userId: session.userId, email: session.email }
}
