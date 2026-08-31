#!/usr/bin/env node
import "dotenv/config"

import { relative, resolve } from "node:path"

import {
  ENV_KEYS,
  loadLocalConfig,
  localConfigPath,
  saveLocalConfig,
  applyToEnv,
  type LocalConfig,
} from "../src/config/local-config.js"
import { registerMcpServer, type RegistrationScope } from "../src/setup/register-mcp.js"

function usage(): string {
  return [
    "Uso: my-tracker-mcp-init <workspaceSlug> <PROJECT_KEY> [opciones]",
    "",
    "Deja este repositorio listo de una vez: registra el servidor MCP, inicia",
    "sesión si hace falta e instala el skill de arquitectura del proyecto.",
    "",
    "  --scope project|user   Dónde registrar el servidor MCP (por defecto: project, un .mcp.json en el repo)",
    "  --dir <ruta>           Raíz del repositorio (por defecto, el directorio actual)",
    "  --supabase-url <url>   NEXT_PUBLIC_SUPABASE_URL (solo la primera vez)",
    "  --anon-key <clave>     NEXT_PUBLIC_SUPABASE_ANON_KEY (solo la primera vez)",
    "  --web-url <url>        MY_TRACKER_WEB_URL (solo la primera vez)",
    "  --force                Reemplaza el skill si ya existe",
    "  --skip-login           No abre el navegador aunque no haya sesión",
  ].join("\n")
}

interface Options {
  workspaceSlug: string
  projectKey: string
  dir: string
  scope: RegistrationScope
  force: boolean
  skipLogin: boolean
  supabaseUrl?: string
  anonKey?: string
  webUrl?: string
}

function parseArgs(argv: string[]): Options {
  const positional: string[] = []
  const options: Partial<Options> = { dir: process.cwd(), scope: "project", force: false, skipLogin: false }

  const take = (argv: string[], index: number, flag: string) => {
    const value = argv[index]
    if (!value) {
      throw new Error(`${flag} necesita un valor`)
    }
    return value
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--force") {
      options.force = true
    } else if (arg === "--skip-login") {
      options.skipLogin = true
    } else if (arg === "--dir") {
      options.dir = take(argv, ++index, "--dir")
    } else if (arg === "--scope") {
      const value = take(argv, ++index, "--scope")
      if (value !== "project" && value !== "user") {
        throw new Error("--scope solo acepta 'project' o 'user'")
      }
      options.scope = value
    } else if (arg === "--supabase-url") {
      options.supabaseUrl = take(argv, ++index, "--supabase-url")
    } else if (arg === "--anon-key") {
      options.anonKey = take(argv, ++index, "--anon-key")
    } else if (arg === "--web-url") {
      options.webUrl = take(argv, ++index, "--web-url")
    } else if (arg === "--help" || arg === "-h") {
      console.log(usage())
      process.exit(0)
    } else {
      positional.push(arg)
    }
  }

  if (positional.length < 2) {
    throw new Error(usage())
  }

  return {
    ...(options as Options),
    workspaceSlug: positional[0],
    projectKey: positional[1].toUpperCase(),
    dir: resolve(options.dir!),
  }
}

function resolveConfig(options: Options): { config: LocalConfig; fresh: boolean } {
  const stored = loadLocalConfig()

  const supabaseUrl = options.supabaseUrl ?? process.env[ENV_KEYS.supabaseUrl] ?? stored.supabaseUrl
  const supabaseAnonKey =
    options.anonKey ?? process.env[ENV_KEYS.supabaseAnonKey] ?? stored.supabaseAnonKey
  const webUrl = options.webUrl ?? process.env[ENV_KEYS.webUrl] ?? stored.webUrl

  const missing: string[] = []
  if (!supabaseUrl) missing.push("--supabase-url")
  if (!supabaseAnonKey) missing.push("--anon-key")
  if (!webUrl) missing.push("--web-url")

  if (!supabaseUrl || !supabaseAnonKey || !webUrl) {
    throw new Error(
      [
        `Falta la configuración de my-tracker: ${missing.join(", ")}.`,
        "",
        "Solo hace falta la primera vez; después queda guardada en",
        localConfigPath(),
        "",
        "Ejemplo:",
        `  my-tracker-mcp-init ${options.workspaceSlug} ${options.projectKey} \\`,
        "    --supabase-url https://xxxx.supabase.co \\",
        "    --anon-key <la anon key pública de my-tracker> \\",
        "    --web-url https://tracker.jeffercbs.com",
      ].join("\n")
    )
  }

  const config: LocalConfig = { supabaseUrl, supabaseAnonKey, webUrl }
  const fresh =
    stored.supabaseUrl !== supabaseUrl ||
    stored.supabaseAnonKey !== supabaseAnonKey ||
    stored.webUrl !== webUrl

  return { config, fresh }
}

async function ensureSession(skipLogin: boolean): Promise<string> {
  const { loadSession } = await import("../src/auth/session-store.js")

  if (loadSession()) {
    const { getUserClient } = await import("../src/auth/supabase-client.js")
    try {
      const { email } = await getUserClient()
      return email
    } catch {
    }
  }

  if (skipLogin) {
    throw new Error(
      "No hay sesión de my-tracker y se pidió --skip-login. Corré `my-tracker-mcp-login` antes."
    )
  }

  const { performBrowserLogin } = await import("../src/auth/auth-flow.js")
  console.log("Abriendo el navegador para autorizar my-tracker-mcp...")
  const result = await performBrowserLogin({
    onAuthorizeUrl: (url) => console.log(`   Si no se abre solo, entrá a: ${url}`),
  })

  return result.email
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const { config, fresh } = resolveConfig(options)

  applyToEnv(config)
  if (fresh) {
    saveLocalConfig(config)
  }

  console.log(`Configurando ${options.workspaceSlug}/${options.projectKey} en ${options.dir}`)
  console.log("")

  const email = await ensureSession(options.skipLogin)
  console.log(`1/3  Sesión: ${email}`)

  const registration = registerMcpServer({
    scope: options.scope,
    directory: options.dir,
    config,
  })
  console.log(
    `2/3  Servidor MCP: ${registration.target}${
      registration.changed ? "" : ` (${registration.detail ?? "sin cambios"})`
    }`
  )

  const { getUserClient } = await import("../src/auth/supabase-client.js")
  const { installProjectSkill } = await import("../src/skill/install.js")
  const { client } = await getUserClient()

  const skill = await installProjectSkill({
    client,
    workspaceSlug: options.workspaceSlug,
    projectKey: options.projectKey,
    directory: options.dir,
    webUrl: config.webUrl,
    force: options.force,
  })

  console.log(
    `3/3  Skill: ${relative(options.dir, skill.absolutePath)}${skill.unchanged ? " (sin cambios)" : ""}`
  )
  console.log("")
  console.log(`Listo — ${skill.projectName} (${skill.projectKey})`)
  console.log("Reiniciá la sesión del agente para que cargue el servidor y el skill.")

  if (!skill.hasRules) {
    console.log("")
    console.log(
      "Todavía no hay restricciones definidas para este proyecto. Conviene fijarlas en su página de arquitectura antes de generar el mapa."
    )
  }
}

main().catch((err) => {
  console.error(err.message ?? err)
  process.exit(1)
})
