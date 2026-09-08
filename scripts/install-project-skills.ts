#!/usr/bin/env node
import { resolve } from "node:path"

function usage(): string {
  return [
    "Uso: tracker-mcp-skills <workspaceSlug> <PROJECT_KEY> [opciones]",
    "",
    "Escribe en este repositorio los skills y subagentes activos que el equipo",
    "definió en my-tracker para ese proyecto.",
    "",
    "  --dir <ruta>    Raíz del repositorio (por defecto, el directorio actual)",
    "  --root <ruta>   Carpeta de destino dentro del repo (por defecto .claude)",
    "  --only <a,b>    Solo estos skills, por su nombre técnico",
    "  --force         Sobrescribe los ficheros que hayan cambiado",
    "  --print         Solo lista lo que haría, sin escribir nada",
  ].join("\n")
}

interface Options {
  workspaceSlug: string
  projectKey: string
  dir: string
  root: string
  only: string[]
  force: boolean
  print: boolean
}

function parseArgs(argv: string[]): Options {
  const positional: string[] = []
  let dir = process.cwd()
  let root = ".claude"
  let only: string[] = []
  let force = false
  let print = false

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--force") {
      force = true
    } else if (arg === "--print") {
      print = true
    } else if (arg === "--dir") {
      dir = argv[++index] ?? dir
    } else if (arg === "--root") {
      root = argv[++index] ?? root
    } else if (arg === "--only") {
      only = (argv[++index] ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
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
    root,
    only,
    force,
    print,
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))

  const { getUserClient } = await import("../src/auth/supabase-client.js")
  const { listProjectSkills } = await import("../src/repositories/skills.js")
  const { toSkillFiles, writeSkillFiles } = await import("../src/skill/project-skills.js")
  const { getProjectWithWorkspace } = await import("../src/repositories/projects.js")

  const { client } = await getUserClient()
  const resolved = await getProjectWithWorkspace(client, options.workspaceSlug, options.projectKey)

  if (!resolved) {
    throw new Error(
      `No se encontró (o no tenés acceso a) el proyecto "${options.projectKey}" en el workspace "${options.workspaceSlug}"`
    )
  }

  const list = await listProjectSkills(client, resolved.project.id, {
    onlyEnabled: true,
    names: options.only.length > 0 ? options.only : undefined,
  })

  if (list.length === 0) {
    console.log(`El proyecto ${options.projectKey} no tiene skills activos que instalar.`)
    return
  }

  const files = toSkillFiles(list, options.root)

  if (options.print) {
    for (const file of files) {
      console.log(file.path)
    }
    return
  }

  const results = writeSkillFiles(files, options.dir, options.force)

  for (const result of results) {
    const state = result.written
      ? "escrito"
      : result.unchanged
        ? "sin cambios"
        : "CONFLICTO (usá --force para reemplazarlo)"
    console.log(`${state.padEnd(12)} ${result.path}`)
  }

  const conflicts = results.filter((result) => result.conflict).length
  console.log("")
  console.log(
    `${results.filter((r) => r.written).length} escritos, ${results.filter((r) => r.unchanged).length} sin cambios, ${conflicts} en conflicto.`
  )
  console.log("Reiniciá la sesión del agente para que los cargue.")

  if (conflicts > 0) {
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error(err.message ?? err)
  process.exit(1)
})
