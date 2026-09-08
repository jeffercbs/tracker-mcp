import { existsSync, renameSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const LEGACY_CONFIG_DIR = join(homedir(), ".my-tracker-mcp")

export const CONFIG_DIR = join(homedir(), ".tracker-mcp")

let migrated = false

export function migrateLegacyConfigDir() {
  if (migrated) return
  migrated = true

  if (existsSync(CONFIG_DIR) || !existsSync(LEGACY_CONFIG_DIR)) {
    return
  }

  try {
    renameSync(LEGACY_CONFIG_DIR, CONFIG_DIR)
  } catch {
  }
}
