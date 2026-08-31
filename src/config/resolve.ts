import "dotenv/config"

import { ENV_KEYS, loadLocalConfig, saveLocalConfig, type LocalConfig } from "./local-config.js"
import { DEFAULT_WEB_URL } from "./defaults.js"

const CONFIG_TIMEOUT_MS = 10_000

export function resolveWebUrl(): string {
  const fromEnv = process.env[ENV_KEYS.webUrl]?.trim()
  if (fromEnv) {
    return fromEnv.replace(/\/$/, "")
  }

  const stored = loadLocalConfig().webUrl?.trim()
  return (stored || DEFAULT_WEB_URL).replace(/\/$/, "")
}

async function fetchRemoteConfig(webUrl: string): Promise<{ url: string; anonKey: string }> {
  const endpoint = `${webUrl}/api/mcp/config`
  let response: Response

  try {
    response = await fetch(endpoint, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(CONFIG_TIMEOUT_MS),
    })
  } catch (error) {
    throw new Error(
      `No se pudo contactar con my-tracker en ${endpoint} para leer su configuración pública (${
        error instanceof Error ? error.message : String(error)
      }). Comprobá la conexión, o pasá NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY por entorno.`
    )
  }

  if (!response.ok) {
    throw new Error(`my-tracker respondió ${response.status} al pedir su configuración en ${endpoint}`)
  }

  const body = (await response.json().catch(() => null)) as {
    supabaseUrl?: unknown
    supabaseAnonKey?: unknown
  } | null

  const url = typeof body?.supabaseUrl === "string" ? body.supabaseUrl.trim() : ""
  const anonKey = typeof body?.supabaseAnonKey === "string" ? body.supabaseAnonKey.trim() : ""

  if (!url || !anonKey) {
    throw new Error(`La configuración devuelta por ${endpoint} está incompleta`)
  }

  return { url, anonKey }
}

let inFlight: Promise<LocalConfig> | null = null

export async function resolveConfig(): Promise<LocalConfig> {
  const webUrl = resolveWebUrl()
  const stored = loadLocalConfig()

  const supabaseUrl = process.env[ENV_KEYS.supabaseUrl]?.trim() || stored.supabaseUrl?.trim()
  const supabaseAnonKey =
    process.env[ENV_KEYS.supabaseAnonKey]?.trim() || stored.supabaseAnonKey?.trim()

  if (supabaseUrl && supabaseAnonKey) {
    return { supabaseUrl, supabaseAnonKey, webUrl }
  }

  if (!inFlight) {
    inFlight = fetchRemoteConfig(webUrl)
      .then((remote) => {
        const config: LocalConfig = {
          supabaseUrl: remote.url,
          supabaseAnonKey: remote.anonKey,
          webUrl,
        }
        saveLocalConfig(config)
        return config
      })
      .finally(() => {
        inFlight = null
      })
  }

  return inFlight
}
