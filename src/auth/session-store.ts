import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export interface StoredSession {
  accessToken: string
  refreshToken: string
  expiresAt: number
  userId: string
  email: string
}

const CONFIG_DIR = join(homedir(), ".my-tracker-mcp")
const SESSION_FILE = join(CONFIG_DIR, "session.json")

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
  if (!existsSync(SESSION_FILE)) {
    return null
  }
  try {
    return parseSession(readFileSync(SESSION_FILE, "utf8"))
  } catch {
    return null
  }
}

export function saveSession(session: StoredSession) {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 })
  }
  writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), { mode: 0o600 })
  try {
    chmodSync(SESSION_FILE, 0o600)
  } catch {
  }
}

export function clearSession() {
  if (existsSync(SESSION_FILE)) {
    rmSync(SESSION_FILE)
  }
}
