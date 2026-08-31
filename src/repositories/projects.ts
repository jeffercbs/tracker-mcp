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
  /** Un proyecto agrupador no tiene tablero propio: las incidencias van en subproyectos. */
  isGroup: boolean
  createdAt: string
}

export interface WorkspaceRef {
  id: string
  name: string
  slug: string
  kind: string
}

const PROJECT_SELECT =
  "id, workspace_id, name, key, color, description, archived, is_group, created_at"

function mapProject(row: any): ProjectDTO {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    key: row.key,
    color: row.color,
    description: row.description,
    archived: row.archived,
    isGroup: row.is_group ?? false,
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

export async function createProject(
  client: SupabaseClient,
  input: {
    workspaceId: string
    name: string
    key: string
    color?: string
    description?: string
    isGroup?: boolean
    createdAt?: string
  }
): Promise<ProjectDTO> {
  const { data, error } = await client
    .from("projects")
    .insert({
      workspace_id: input.workspaceId,
      name: input.name,
      key: input.key,
      color: input.color ?? "#6366f1",
      description: input.description ?? null,
      is_group: input.isGroup ?? false,
      ...(input.createdAt !== undefined ? { created_at: input.createdAt } : {}),
    })
    .select(PROJECT_SELECT)
    .single()

  if (error || !data) {
    throw new Error(dbErrorMessage("No se pudo crear el proyecto", error))
  }
  return mapProject(data)
}

export async function updateProject(
  client: SupabaseClient,
  projectId: string,
  patch: {
    name?: string
    key?: string
    color?: string
    description?: string | null
    archived?: boolean
    isGroup?: boolean
    createdAt?: string
  }
): Promise<ProjectDTO> {
  const row: Record<string, unknown> = {}
  if (patch.name !== undefined) row.name = patch.name
  if (patch.key !== undefined) row.key = patch.key
  if (patch.color !== undefined) row.color = patch.color
  if (patch.description !== undefined) row.description = patch.description
  if (patch.archived !== undefined) row.archived = patch.archived
  if (patch.isGroup !== undefined) row.is_group = patch.isGroup
  if (patch.createdAt !== undefined) row.created_at = patch.createdAt

  if (Object.keys(row).length === 0) {
    throw new Error("No se indicó ningún campo a modificar")
  }

  const { data, error } = await client
    .from("projects")
    .update(row)
    .eq("id", projectId)
    .select(PROJECT_SELECT)
    .single()

  if (error || !data) {
    throw new Error(dbErrorMessage("No se pudo actualizar el proyecto", error))
  }
  return mapProject(data)
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

export interface IssueModuleOption {
  id: string
  name: string
  description: string | null
  color: string
}

/** Módulos del sistema con los que se clasifican las incidencias del proyecto. */
export async function listIssueModules(
  client: SupabaseClient,
  projectId: string
): Promise<IssueModuleOption[]> {
  const { data, error } = await client
    .from("issue_modules")
    .select("id, name, description, color")
    .eq("project_id", projectId)
    .order("position", { ascending: true })
    .order("name", { ascending: true })

  if (error) {
    throw new Error(dbErrorMessage("No se pudieron cargar los módulos", error))
  }
  return data ?? []
}

export async function createIssueModule(
  client: SupabaseClient,
  input: { projectId: string; name: string; description?: string; color?: string }
): Promise<IssueModuleOption> {
  const { data, error } = await client
    .from("issue_modules")
    .insert({
      project_id: input.projectId,
      name: input.name,
      description: input.description ?? null,
      color: input.color ?? "#82a53b",
    })
    .select("id, name, description, color")
    .single()

  if (error) {
    throw new Error(dbErrorMessage("No se pudo crear el módulo", error))
  }
  return data
}

export async function updateIssueModule(
  client: SupabaseClient,
  moduleId: string,
  patch: { name?: string; description?: string | null; color?: string }
): Promise<IssueModuleOption> {
  const row: Record<string, unknown> = {}
  if (patch.name !== undefined) row.name = patch.name
  if (patch.description !== undefined) row.description = patch.description
  if (patch.color !== undefined) row.color = patch.color

  if (Object.keys(row).length === 0) {
    throw new Error("No se indicó ningún campo a modificar")
  }

  const { data, error } = await client
    .from("issue_modules")
    .update(row)
    .eq("id", moduleId)
    .select("id, name, description, color")
    .single()

  if (error || !data) {
    throw new Error(dbErrorMessage("No se pudo actualizar el módulo", error))
  }
  return data
}

export interface SubprojectOption {
  id: string
  name: string
  slug: string
  description: string | null
  color: string
}

/**
 * Solo devuelve los subproyectos que la sesión puede ver: la RLS filtra por los
 * permisos por tablero, así que esta lista ya es el alcance real del usuario.
 */
export async function listSubprojects(
  client: SupabaseClient,
  projectId: string
): Promise<SubprojectOption[]> {
  const { data, error } = await client
    .from("subprojects")
    .select("id, name, slug, description, color")
    .eq("project_id", projectId)
    .order("position", { ascending: true })
    .order("name", { ascending: true })

  if (error) {
    throw new Error(dbErrorMessage("No se pudieron cargar los subproyectos", error))
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

export async function createIssueType(
  client: SupabaseClient,
  input: { projectId: string; name: string; color?: string; icon?: string | null }
): Promise<IssueTypeOption> {
  const { data, error } = await client
    .from("issue_types")
    .insert({
      project_id: input.projectId,
      name: input.name,
      color: input.color ?? "#6366f1",
      icon: input.icon ?? null,
    })
    .select("id, name, color, icon")
    .single()

  if (error) {
    throw new Error(dbErrorMessage("No se pudo crear el tipo de incidencia", error))
  }
  return data
}

export async function updateIssueType(
  client: SupabaseClient,
  typeId: string,
  patch: { name?: string; color?: string; icon?: string | null }
): Promise<IssueTypeOption> {
  const row: Record<string, unknown> = {}
  if (patch.name !== undefined) row.name = patch.name
  if (patch.color !== undefined) row.color = patch.color
  if (patch.icon !== undefined) row.icon = patch.icon

  if (Object.keys(row).length === 0) {
    throw new Error("No se indicó ningún campo a modificar")
  }

  const { data, error } = await client
    .from("issue_types")
    .update(row)
    .eq("id", typeId)
    .select("id, name, color, icon")
    .single()

  if (error || !data) {
    throw new Error(dbErrorMessage("No se pudo actualizar el tipo de incidencia", error))
  }
  return data
}

/** Siguiente hueco al final del flujo de trabajo del proyecto. */
export async function nextStatusPosition(
  client: SupabaseClient,
  projectId: string
): Promise<number> {
  const { data, error } = await client
    .from("issue_statuses")
    .select("position")
    .eq("project_id", projectId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(dbErrorMessage("No se pudieron cargar los estados", error))
  }
  return ((data as any)?.position ?? 0) + 1
}

export async function createIssueStatus(
  client: SupabaseClient,
  input: {
    projectId: string
    name: string
    category: string
    color?: string
    position?: number
  }
): Promise<IssueStatusOption> {
  const position = input.position ?? (await nextStatusPosition(client, input.projectId))

  const { data, error } = await client
    .from("issue_statuses")
    .insert({
      project_id: input.projectId,
      name: input.name,
      category: input.category,
      color: input.color ?? "#94a3b8",
      position,
    })
    .select("id, name, category, position, color")
    .single()

  if (error) {
    throw new Error(dbErrorMessage("No se pudo crear el estado", error))
  }
  return data
}

export async function updateIssueStatus(
  client: SupabaseClient,
  statusId: string,
  patch: { name?: string; category?: string; color?: string; position?: number }
): Promise<IssueStatusOption> {
  const row: Record<string, unknown> = {}
  if (patch.name !== undefined) row.name = patch.name
  if (patch.category !== undefined) row.category = patch.category
  if (patch.color !== undefined) row.color = patch.color
  if (patch.position !== undefined) row.position = patch.position

  if (Object.keys(row).length === 0) {
    throw new Error("No se indicó ningún campo a modificar")
  }

  const { data, error } = await client
    .from("issue_statuses")
    .update(row)
    .eq("id", statusId)
    .select("id, name, category, position, color")
    .single()

  if (error || !data) {
    throw new Error(dbErrorMessage("No se pudo actualizar el estado", error))
  }
  return data
}
