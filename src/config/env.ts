import "dotenv/config"

import { ENV_KEYS, loadLocalConfig } from "./local-config.js"

const stored = loadLocalConfig()

const STORED_BY_ENV: Record<string, string | undefined> = {
  [ENV_KEYS.supabaseUrl]: stored.supabaseUrl,
  [ENV_KEYS.supabaseAnonKey]: stored.supabaseAnonKey,
  [ENV_KEYS.webUrl]: stored.webUrl,
}

export function requireEnv(name: string): string {
  const value = process.env[name]?.trim() || STORED_BY_ENV[name]?.trim()
  if (!value) {
    throw new Error(
      `Falta la variable de entorno obligatoria: ${name}. Configurala una vez con \`my-tracker-mcp-init <workspaceSlug> <PROJECT_KEY> --supabase-url ... --anon-key ... --web-url ...\` o pasala en el entorno.`
    )
  }
  return value
}

export function requireUrlEnv(name: string): string {
  const raw = requireEnv(name)
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`La variable ${name} no contiene una URL válida: "${raw}"`)
  }

  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1"
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocal)) {
    throw new Error(`La variable ${name} debe apuntar a https:// (solo se permite http:// en localhost)`)
  }

  return url.toString().replace(/\/$/, "")
}

export const supabaseUrl = requireUrlEnv("NEXT_PUBLIC_SUPABASE_URL")
export const supabaseAnonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
