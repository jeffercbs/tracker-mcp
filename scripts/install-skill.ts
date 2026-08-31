#!/usr/bin/env node
import { relative, resolve } from "node:path"

import { SKILL_DIRECTORY, SKILL_FILENAME } from "../src/skill/architecture-skill.js"

function usage(): string {
  return [
    "Uso: my-tracker-mcp-skill <workspaceSlug> <PROJECT_KEY> [opciones]",
    "",
    "Escribe el skill de arquitectura del proyecto en este repositorio",
    `(${SKILL_DIRECTORY}/${SKILL_FILENAME}). Para dejar además registrado el`,
    "servidor MCP y la sesión, usá `my-tracker-mcp-init`.",
    "",
    "  --dir <ruta>   Raíz del repositorio (por defecto, el directorio actual)",
    "  --force        Sobrescribe el skill si ya existe",
    "  --print        Solo imprime el contenido, sin escribir nada",
  ].join("\n")
}

interface Options {
  workspaceSlug: string
  projectKey: string
  dir: string
  force: boolean
  print: boolean
}

function parseArgs(argv: string[]): Options {
  const positional: string[] = []
  let dir = process.cwd()
  let force = false
  let print = false

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--force") {
      force = true
    } else if (arg === "--print") {
      print = true
    } else if (arg === "--dir") {
      const value = argv[++index]
      if (!value) {
        throw new Error("--dir necesita una ruta")
      }
      dir = value
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
    force,
    print,
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))

  const { getUserClient } = await import("../src/auth/supabase-client.js")
  const { installProjectSkill } = await import("../src/skill/install.js")
  const { client } = await getUserClient()

  const skill = await installProjectSkill({
    client,
    workspaceSlug: options.workspaceSlug,
    projectKey: options.projectKey,
    directory: options.dir,
    webUrl: process.env.MY_TRACKER_WEB_URL?.trim() || null,
    force: options.force,
    dryRun: options.print,
  })

  if (options.print) {
    console.log(skill.content)
    return
  }

  console.log(
    skill.unchanged
      ? `El skill en ${relative(options.dir, skill.absolutePath)} ya estaba al día`
      : `Skill escrito en ${relative(options.dir, skill.absolutePath)}`
  )
  console.log(
    `Proyecto: ${skill.projectName} (${skill.projectKey}) · workspace ${skill.workspaceSlug}`
  )
  console.log("")
  console.log("Reiniciá la sesión del agente para que lo cargue.")

  if (!skill.hasRules) {
    console.log(
      "Todavía no hay restricciones definidas: conviene fijarlas en la página de arquitectura del proyecto antes de generar el mapa."
    )
  }
}

main().catch((err) => {
  console.error(err.message ?? err)
  process.exit(1)
})
