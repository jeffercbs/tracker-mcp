import type { SupabaseClient } from "@supabase/supabase-js"

import { dbErrorMessage } from "./errors.js"

export interface ProjectDTO {
  id: string
  workspaceId: string
  name: string
  key: string
  color: string
  description: string | null
  archived: boolean
  createdAt: string
}

export interface WorkspaceRef {
  id: string
  name: string
  slug: string
  kind: string
}

const PROJECT_SELECT = "id, workspace_id, name, key, color, description, archived, created_at"

function mapProject(row: any): ProjectDTO {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    key: row.key,
    color: row.color,
    description: row.description,
    archived: row.archived,
    createdAt: row.created_at,
  }
}

export async function listProjectsForWorkspace(
  client: SupabaseClient,
  workspaceId: string
): Promise<ProjectDTO[]> {
  const { data, error } = await client
    .from("projects")
    .select(PROJECT_SELECT)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true })

  if (error) {
    throw new Error(dbErrorMessage("No se pudieron cargar los proyectos", error))
  }

  return (data ?? []).map(mapProject)
}

/**
 * Resolves workspace + project in a single round trip (inner-joins on the
 * workspace's slug) instead of two sequential lookups.
 */
export async function getProjectWithWorkspace(
  client: SupabaseClient,
  workspaceSlug: string,
  projectKey: string
): Promise<{ workspace: WorkspaceRef; project: ProjectDTO } | null> {
  const { data, error } = await client
    .from("projects")
    .select(`${PROJECT_SELECT}, workspace:workspaces!inner(id, name, slug, kind)`)
    .eq("key", projectKey)
    .eq("workspace.slug", workspaceSlug)
    .maybeSingle()

  if (error || !data) {
    return null
  }

  const row = data as any
  return {
    workspace: row.workspace,
    project: mapProject(row),
  }
}

export interface IssueStatusOption {
  id: string
  name: string
  category: string
  position: number
  color: string
}

export async function listIssueStatuses(
  client: SupabaseClient,
  projectId: string
): Promise<IssueStatusOption[]> {
  const { data, error } = await client
    .from("issue_statuses")
    .select("id, name, category, position, color")
    .eq("project_id", projectId)
    .order("position", { ascending: true })

  if (error) {
    throw new Error(dbErrorMessage("No se pudieron cargar los estados", error))
  }
  return data ?? []
}

export interface IssueTypeOption {
  id: string
  name: string
  color: string
  icon: string | null
}

export async function listIssueTypes(
  client: SupabaseClient,
  projectId: string
): Promise<IssueTypeOption[]> {
  const { data, error } = await client
    .from("issue_types")
    .select("id, name, color, icon")
    .eq("project_id", projectId)
    .order("name", { ascending: true })

  if (error) {
    throw new Error(dbErrorMessage("No se pudieron cargar los tipos", error))
  }
  return data ?? []
}

export interface WorkspaceMemberOption {
  userId: string
  role: string
  fullName: string | null
  email: string
}

export async function listWorkspaceMembers(
  client: SupabaseClient,
  workspaceId: string
): Promise<WorkspaceMemberOption[]> {
  const { data, error } = await client
    .from("workspace_members")
    .select("role, user_id, profiles(full_name, email)")
    .eq("workspace_id", workspaceId)
    .eq("status", "active")

  if (error) {
    throw new Error(dbErrorMessage("No se pudieron cargar los miembros", error))
  }

  return (data ?? []).map((row: any) => ({
    userId: row.user_id,
    role: row.role,
    fullName: row.profiles?.full_name ?? null,
    email: row.profiles?.email ?? "",
  }))
}

export async function createLabel(
  client: SupabaseClient,
  input: { projectId: string; name: string; color?: string }
): Promise<LabelOption> {
  const { data, error } = await client
    .from("labels")
    .insert({ project_id: input.projectId, name: input.name, color: input.color ?? "#6366f1" })
    .select("id, name, color")
    .single()

  if (error) {
    throw new Error(dbErrorMessage("No se pudo crear la etiqueta", error))
  }
  return data
}

export interface LabelOption {
  id: string
  name: string
  color: string
}

export async function listLabels(
  client: SupabaseClient,
  projectId: string
): Promise<LabelOption[]> {
  const { data, error } = await client
    .from("labels")
    .select("id, name, color")
    .eq("project_id", projectId)

  if (error) {
    throw new Error(dbErrorMessage("No se pudieron cargar las etiquetas", error))
  }
  return data ?? []
}
