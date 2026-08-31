import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import { supabaseAnonKey, supabaseUrl } from "../config/env.js"
import { clearSession, loadSession, saveSession, type StoredSession } from "./session-store.js"

export class NotAuthenticatedError extends Error {
  constructor(detail?: string) {
    super(
      (detail ? `${detail} ` : "") +
        "No hay una sesión de my-tracker válida. Corré la tool `login` (o `npm run login` en el servidor MCP) para iniciar sesión."
    )
    this.name = "NotAuthenticatedError"
  }
}

export function createAnonClient(): SupabaseClient {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

let refreshInFlight: Promise<StoredSession> | null = null

async function doRefresh(session: StoredSession): Promise<StoredSession> {
  const client = createAnonClient()
  const { data, error } = await client.auth.refreshSession({
    refresh_token: session.refreshToken,
  })

  if (error || !data.session) {
    clearSession()
    throw new NotAuthenticatedError("La sesión guardada caducó o fue revocada.")
  }

  const refreshed: StoredSession = {
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    expiresAt: data.session.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
    userId: data.session.user.id,
    email: data.session.user.email ?? session.email,
  }
  saveSession(refreshed)
  return refreshed
}

async function refreshIfNeeded(session: StoredSession): Promise<StoredSession> {
  const now = Math.floor(Date.now() / 1000)
  if (session.expiresAt - now > 60) {
    return session
  }

  if (!refreshInFlight) {
    refreshInFlight = doRefresh(session).finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
}

export interface AuthenticatedClient {
  client: SupabaseClient
  userId: string
  email: string
}

let cached: { accessToken: string; value: AuthenticatedClient } | null = null

export async function getUserClient(): Promise<AuthenticatedClient> {
  const stored = loadSession()
  if (!stored) {
    throw new NotAuthenticatedError()
  }

  const session = await refreshIfNeeded(stored)

  if (cached?.accessToken === session.accessToken) {
    return cached.value
  }

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    },
  })

  const value: AuthenticatedClient = { client, userId: session.userId, email: session.email }
  cached = { accessToken: session.accessToken, value }
  return value
}
