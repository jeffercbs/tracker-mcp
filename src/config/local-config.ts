import { join } from "node:path"

import { CONFIG_DIR, migrateLegacyConfigDir } from "./paths.js"
import { readSecureFile, writeSecureFile } from "./secure-store.js"

export interface LocalConfig {
  supabaseUrl: string
  supabaseAnonKey: string
  webUrl: string
}

const CONFIG_FILE = join(CONFIG_DIR, "config.json")
const CONFIG_AAD = "tracker-mcp/config"

export const LEGACY_WEB_URL_ENV = "MY_TRACKER_WEB_URL"

export const ENV_KEYS = {
  supabaseUrl: "NEXT_PUBLIC_SUPABASE_URL",
  supabaseAnonKey: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  webUrl: "TRACKER_WEB_URL",
} as const

export function loadLocalConfig(): Partial<LocalConfig> {
  migrateLegacyConfigDir()

  const read = readSecureFile(CONFIG_FILE, CONFIG_AAD)
  if (!read) return {}

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(read.raw) as Record<string, unknown>
  } catch {
    return {}
  }

  const pick = (key: string) =>
    typeof parsed[key] === "string" && parsed[key] ? (parsed[key] as string) : undefined

  const config: Partial<LocalConfig> = {
    supabaseUrl: pick("supabaseUrl"),
    supabaseAnonKey: pick("supabaseAnonKey"),
    webUrl: pick("webUrl"),
  }

  if (read.legacy && config.supabaseUrl && config.supabaseAnonKey && config.webUrl) {
    saveLocalConfig(config as LocalConfig)
  }

  return config
}

export function saveLocalConfig(config: LocalConfig) {
  migrateLegacyConfigDir()
  writeSecureFile(CONFIG_FILE, CONFIG_AAD, JSON.stringify(config))
}
