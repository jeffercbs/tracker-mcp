import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { ENV_KEYS, type LocalConfig } from "../config/local-config.js"

export const SERVER_NAME = "my-tracker"
export const SERVER_PACKAGE = process.env.MY_TRACKER_MCP_PACKAGE?.trim() || "@jeffercbs/my-tracker-mcp"
export const PROJECT_CONFIG_FILE = ".mcp.json"

export type RegistrationScope = "project" | "user"

export interface RegistrationResult {
  scope: RegistrationScope
  target: string
  changed: boolean
  detail?: string
}

function serverEntry(config: LocalConfig) {
  return {
    command: "npx",
    args: ["-y", SERVER_PACKAGE],
    env: {
      [ENV_KEYS.supabaseUrl]: config.supabaseUrl,
      [ENV_KEYS.supabaseAnonKey]: config.supabaseAnonKey,
      [ENV_KEYS.webUrl]: config.webUrl,
    },
  }
}

function registerInProject(directory: string, config: LocalConfig): RegistrationResult {
  const file = join(directory, PROJECT_CONFIG_FILE)
  const entry = serverEntry(config)

  let document: Record<string, unknown> = {}
  if (existsSync(file)) {
    try {
      document = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>
    } catch {
      throw new Error(
        `${PROJECT_CONFIG_FILE} existe pero no es JSON válido. Arreglalo o borralo antes de volver a correr esto.`
      )
    }
  }

  const servers =
    typeof document.mcpServers === "object" && document.mcpServers !== null
      ? (document.mcpServers as Record<string, unknown>)
      : {}

  const previous = JSON.stringify(servers[SERVER_NAME] ?? null)
  servers[SERVER_NAME] = entry
  document.mcpServers = servers

  const changed = previous !== JSON.stringify(entry)
  if (changed) {
    writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`, "utf8")
  }

  return { scope: "project", target: PROJECT_CONFIG_FILE, changed }
}

function registerForUser(config: LocalConfig): RegistrationResult {
  const args = [
    "mcp",
    "add",
    SERVER_NAME,
    "-s",
    "user",
    "-e",
    `${ENV_KEYS.supabaseUrl}=${config.supabaseUrl}`,
    "-e",
    `${ENV_KEYS.supabaseAnonKey}=${config.supabaseAnonKey}`,
    "-e",
    `${ENV_KEYS.webUrl}=${config.webUrl}`,
    "--",
    "npx",
    "-y",
    SERVER_PACKAGE,
  ]

  try {
    execFileSync("claude", args, { stdio: "pipe", shell: process.platform === "win32" })
    return { scope: "user", target: "configuración de usuario de Claude Code", changed: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes("already exists")) {
      return {
        scope: "user",
        target: "configuración de usuario de Claude Code",
        changed: false,
        detail: "ya estaba registrado",
      }
    }

    throw new Error(
      `No se pudo registrar el servidor con el CLI de Claude Code (${message.split("\n")[0]}). Registralo a mano:\n\n  claude mcp add ${SERVER_NAME} -s user -e ${ENV_KEYS.supabaseUrl}=${config.supabaseUrl} -e ${ENV_KEYS.supabaseAnonKey}=<anon key> -e ${ENV_KEYS.webUrl}=${config.webUrl} -- npx -y ${SERVER_PACKAGE}`
    )
  }
}

export function registerMcpServer(input: {
  scope: RegistrationScope
  directory: string
  config: LocalConfig
}): RegistrationResult {
  return input.scope === "user"
    ? registerForUser(input.config)
    : registerInProject(input.directory, input.config)
}
