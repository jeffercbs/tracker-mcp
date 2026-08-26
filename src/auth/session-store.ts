import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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

export function loadSession(): StoredSession | null {
  if (!existsSync(SESSION_FILE)) {
    return null
  }
  try {
    const raw = readFileSync(SESSION_FILE, "utf8")
    return JSON.parse(raw) as StoredSession
  } catch {
    return null
  }
}

export function saveSession(session: StoredSession) {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 })
  }
  writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), { mode: 0o600 })
}

export function clearSession() {
  if (existsSync(SESSION_FILE)) {
    rmSync(SESSION_FILE)
  }
}
