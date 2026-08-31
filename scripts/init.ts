#!/usr/bin/env node
import "dotenv/config"

import { relative, resolve } from "node:path"

import { resolveWebUrl } from "../src/config/resolve.js"
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
}

function parseArgs(argv: string[]): Options {
  const positional: string[] = []
  let dir = process.cwd()
  let scope: RegistrationScope = "project"
  let force = false
  let skipLogin = false

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--force") {
      force = true
    } else if (arg === "--skip-login") {
      skipLogin = true
    } else if (arg === "--dir") {
      const value = argv[++index]
      if (!value) {
        throw new Error("--dir necesita una ruta")
      }
      dir = value
    } else if (arg === "--scope") {
      const value = argv[++index]
      if (value !== "project" && value !== "user") {
        throw new Error("--scope solo acepta 'project' o 'user'")
      }
      scope = value
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
    workspaceSlug: positional[0],
    projectKey: positional[1].toUpperCase(),
    dir: resolve(dir),
    scope,
    force,
    skipLogin,
  }
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

  console.log(`Configurando ${options.workspaceSlug}/${options.projectKey} en ${options.dir}`)
  console.log(`my-tracker: ${resolveWebUrl()}`)
  console.log("")

  const email = await ensureSession(options.skipLogin)
  console.log(`1/3  Sesión: ${email}`)

  const registration = registerMcpServer({ scope: options.scope, directory: options.dir })
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
    webUrl: resolveWebUrl(),
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
