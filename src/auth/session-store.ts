import { existsSync, rmSync } from "node:fs"
import { join } from "node:path"

import { CONFIG_DIR, migrateLegacyConfigDir } from "../config/paths.js"
import { readSecureFile, writeSecureFile } from "../config/secure-store.js"

export interface StoredSession {
  accessToken: string
  refreshToken: string
  expiresAt: number
  userId: string
  email: string
}

const SESSION_FILE = join(CONFIG_DIR, "session.json")
const SESSION_AAD = "tracker-mcp/session"

function parseSession(raw: string): StoredSession | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }

  if (typeof value !== "object" || value === null) return null
  const candidate = value as Record<string, unknown>

  const accessToken = candidate.accessToken
  const refreshToken = candidate.refreshToken
  const userId = candidate.userId
  if (
    typeof accessToken !== "string" ||
    accessToken.length === 0 ||
    typeof refreshToken !== "string" ||
    refreshToken.length === 0 ||
    typeof userId !== "string" ||
    userId.length === 0
  ) {
    return null
  }

  return {
    accessToken,
    refreshToken,
    userId,
    expiresAt: typeof candidate.expiresAt === "number" ? candidate.expiresAt : 0,
    email: typeof candidate.email === "string" ? candidate.email : "",
  }
}

export function loadSession(): StoredSession | null {
  migrateLegacyConfigDir()

  const read = readSecureFile(SESSION_FILE, SESSION_AAD)
  if (!read) return null

  const session = parseSession(read.raw)
  if (!session) return null

  if (read.legacy) {
    saveSession(session)
  }

  return session
}

export function saveSession(session: StoredSession) {
  migrateLegacyConfigDir()
  writeSecureFile(SESSION_FILE, SESSION_AAD, JSON.stringify(session))
}

export function clearSession() {
  migrateLegacyConfigDir()
  if (existsSync(SESSION_FILE)) {
    rmSync(SESSION_FILE)
  }
}
