import type { SupabaseClient } from "@supabase/supabase-js"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { getArchitectureRules } from "../repositories/architecture.js"
import { getProjectWithWorkspace } from "../repositories/projects.js"
import { renderArchitectureSkill, SKILL_DIRECTORY, SKILL_FILENAME } from "./architecture-skill.js"

export interface SkillInstallResult {
  content: string
  relativePath: string
  absolutePath: string
  written: boolean
  unchanged: boolean
  projectName: string
  projectKey: string
  workspaceSlug: string
  hasRules: boolean
}

export async function buildProjectSkill(input: {
  client: SupabaseClient
  workspaceSlug: string
  projectKey: string
  webUrl?: string | null
}) {
  const projectKey = input.projectKey.toUpperCase()
  const resolved = await getProjectWithWorkspace(input.client, input.workspaceSlug, projectKey)

  if (!resolved) {
    throw new Error(
      `No se encontró (o no tenés acceso a) el proyecto "${projectKey}" en el workspace "${input.workspaceSlug}"`
    )
  }

  const rules = await getArchitectureRules(input.client, resolved.project.id)
  const content = renderArchitectureSkill({
    workspaceSlug: resolved.workspace.slug,
    projectKey: resolved.project.key,
    projectName: resolved.project.name,
    webUrl: input.webUrl ?? null,
    ignoreGlobs: rules.ignoreGlobs,
    focusGlobs: rules.focusGlobs,
    notes: rules.notes,
  })

  return {
    content,
    project: resolved.project,
    workspace: resolved.workspace,
    hasRules:
      rules.ignoreGlobs.length > 0 || rules.focusGlobs.length > 0 || rules.notes.trim().length > 0,
  }
}

export async function installProjectSkill(input: {
  client: SupabaseClient
  workspaceSlug: string
  projectKey: string
  directory: string
  webUrl?: string | null
  force?: boolean
  dryRun?: boolean
}): Promise<SkillInstallResult> {
  const built = await buildProjectSkill(input)

  const relativePath = `${SKILL_DIRECTORY}/${SKILL_FILENAME}`
  const absolutePath = join(input.directory, ...SKILL_DIRECTORY.split("/"), SKILL_FILENAME)

  const base = {
    content: built.content,
    relativePath,
    absolutePath,
    projectName: built.project.name,
    projectKey: built.project.key,
    workspaceSlug: built.workspace.slug,
    hasRules: built.hasRules,
  }

  if (input.dryRun) {
    return { ...base, written: false, unchanged: false }
  }

  if (existsSync(absolutePath)) {
    const current = readFileSync(absolutePath, "utf8")
    if (current === built.content) {
      return { ...base, written: false, unchanged: true }
    }

    if (!input.force) {
      throw new Error(
        `Ya existe ${relativePath} y su contenido cambió (por ejemplo, porque cambiaron las restricciones del proyecto). Volvé a correrlo con --force para reemplazarlo, o con --print para ver el contenido nuevo.`
      )
    }
  }

  mkdirSync(join(input.directory, ...SKILL_DIRECTORY.split("/")), { recursive: true })
  writeFileSync(absolutePath, built.content, "utf8")

  return { ...base, written: true, unchanged: false }
}
