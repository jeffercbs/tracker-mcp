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
