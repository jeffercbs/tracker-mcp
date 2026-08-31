import type { SupabaseClient } from "@supabase/supabase-js"

import { dbErrorMessage } from "./errors.js"

export type ProjectSkillKind = "skill" | "agent"

export interface ProjectSkillDTO {
  id: string
  kind: ProjectSkillKind
  name: string
  title: string
  description: string
  content: string
  allowedTools: string
  model: string | null
  userInvocable: boolean
  enabled: boolean
  updatedAt: string
}

const SKILL_SELECT =
  "id, kind, name, title, description, content, allowed_tools, model, user_invocable, enabled, position, updated_at"

function mapSkill(row: any): ProjectSkillDTO {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    title: row.title,
    description: row.description ?? "",
    content: row.content ?? "",
    allowedTools: row.allowed_tools ?? "",
    model: row.model,
    userInvocable: row.user_invocable,
    enabled: row.enabled,
    updatedAt: row.updated_at,
  }
}

export async function listProjectSkills(
  client: SupabaseClient,
  projectId: string,
  options: { onlyEnabled?: boolean; names?: string[] } = {}
): Promise<ProjectSkillDTO[]> {
  let query = client
    .from("project_skills")
    .select(SKILL_SELECT)
    .eq("project_id", projectId)
    .order("position", { ascending: true })
    .order("name", { ascending: true })

  if (options.onlyEnabled) {
    query = query.eq("enabled", true)
  }
  if (options.names && options.names.length > 0) {
    query = query.in("name", options.names)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(dbErrorMessage("No se pudieron cargar los skills del proyecto", error))
  }

  return (data ?? []).map(mapSkill)
}

export interface SkillImportInput {
  kind: ProjectSkillKind
  name: string
  title: string
  description: string
  content: string
  allowedTools: string
  model: string | null
  userInvocable: boolean
}

export interface SkillImportResult {
  name: string
  kind: ProjectSkillKind
  status: "creado" | "actualizado" | "ya existía"
}

export async function importProjectSkills(
  client: SupabaseClient,
  input: {
    projectId: string
    userId: string
    skills: SkillImportInput[]
    overwrite: boolean
  }
): Promise<SkillImportResult[]> {
  const existing = await listProjectSkills(client, input.projectId)
  const byKey = new Map(existing.map((skill) => [`${skill.kind}:${skill.name}`, skill]))
  const results: SkillImportResult[] = []

  for (const skill of input.skills) {
    const current = byKey.get(`${skill.kind}:${skill.name}`)

    if (current && !input.overwrite) {
      results.push({ name: skill.name, kind: skill.kind, status: "ya existía" })
      continue
    }

    const row = {
      kind: skill.kind,
      name: skill.name,
      title: skill.title,
      description: skill.description,
      content: skill.content,
      allowed_tools: skill.allowedTools,
      model: skill.model,
      user_invocable: skill.userInvocable,
      updated_by: input.userId,
    }

    if (current) {
      const { error } = await client
        .from("project_skills")
        .update({ ...row, updated_at: new Date().toISOString() })
        .eq("id", current.id)

      if (error) {
        throw new Error(dbErrorMessage(`No se pudo actualizar el skill "${skill.name}"`, error))
      }
      results.push({ name: skill.name, kind: skill.kind, status: "actualizado" })
      continue
    }

    const { error } = await client
      .from("project_skills")
      .insert({ ...row, project_id: input.projectId, created_by: input.userId })

    if (error) {
      throw new Error(dbErrorMessage(`No se pudo crear el skill "${skill.name}"`, error))
    }
    results.push({ name: skill.name, kind: skill.kind, status: "creado" })
  }

  return results
}
