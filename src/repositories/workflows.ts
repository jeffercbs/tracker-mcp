import type { SupabaseClient } from "@supabase/supabase-js"

import { dbErrorMessage } from "./errors.js"

export interface ProjectRoleDTO {
  id: string
  name: string
  title: string
  instructions: string
  techStack: string[]
}

export interface ProjectWorkflowDTO {
  id: string
  name: string
  title: string
  description: string
  spec: unknown
  enabled: boolean
  updatedAt: string
}

const ROLE_SELECT = "id, name, title, instructions, tech_stack, color, position"

const WORKFLOW_SELECT =
  "id, name, title, description, spec, enabled, position, updated_at"

function mapRole(row: any): ProjectRoleDTO {
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    instructions: row.instructions ?? "",
    techStack: row.tech_stack ?? [],
  }
}

function mapWorkflow(row: any): ProjectWorkflowDTO {
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    description: row.description ?? "",
    spec: row.spec,
    enabled: row.enabled,
    updatedAt: row.updated_at,
  }
}

export async function listProjectWorkflows(
  client: SupabaseClient,
  projectId: string,
  options: { onlyEnabled?: boolean; names?: string[] } = {}
): Promise<ProjectWorkflowDTO[]> {
  let query = client
    .from("project_workflows")
    .select(WORKFLOW_SELECT)
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
    throw new Error(dbErrorMessage("No se pudieron cargar los flujos del proyecto", error))
  }

  return (data ?? []).map(mapWorkflow)
}

export async function listProjectRoles(
  client: SupabaseClient,
  projectId: string
): Promise<ProjectRoleDTO[]> {
  const { data, error } = await client
    .from("project_roles")
    .select(ROLE_SELECT)
    .eq("project_id", projectId)
    .order("position", { ascending: true })
    .order("title", { ascending: true })

  if (error) {
    throw new Error(dbErrorMessage("No se pudieron cargar los roles del proyecto", error))
  }

  return (data ?? []).map(mapRole)
}
