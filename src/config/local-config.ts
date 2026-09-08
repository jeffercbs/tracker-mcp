import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { CONFIG_DIR, migrateLegacyConfigDir } from "./paths.js"

export interface LocalConfig {
  supabaseUrl: string
  supabaseAnonKey: string
  webUrl: string
}

const CONFIG_FILE = join(CONFIG_DIR, "config.json")

export const LEGACY_WEB_URL_ENV = "MY_TRACKER_WEB_URL"

export const ENV_KEYS = {
  supabaseUrl: "NEXT_PUBLIC_SUPABASE_URL",
  supabaseAnonKey: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  webUrl: "TRACKER_WEB_URL",
} as const

export function loadLocalConfig(): Partial<LocalConfig> {
  migrateLegacyConfigDir()
  if (!existsSync(CONFIG_FILE)) {
    return {}
  }

  try {
    const parsed = JSON.parse(readFileSync(CONFIG_FILE, "utf8")) as Record<string, unknown>
    const pick = (key: string) =>
      typeof parsed[key] === "string" && parsed[key] ? (parsed[key] as string) : undefined

    return {
      supabaseUrl: pick("supabaseUrl"),
      supabaseAnonKey: pick("supabaseAnonKey"),
      webUrl: pick("webUrl"),
    }
  } catch {
    return {}
  }
}

export function saveLocalConfig(config: LocalConfig) {
  migrateLegacyConfigDir()
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 })
  }

  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 })
  try {
    chmodSync(CONFIG_FILE, 0o600)
  } catch {
  }
}


