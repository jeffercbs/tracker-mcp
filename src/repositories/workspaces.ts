import type { SupabaseClient } from "@supabase/supabase-js"

import { dbErrorMessage } from "./errors.js"

export interface WorkspaceSummary {
  id: string
  name: string
  slug: string
  kind: string
  role: string
}

export async function listWorkspacesForUser(
  client: SupabaseClient,
  userId: string
): Promise<WorkspaceSummary[]> {
  const { data, error } = await client
    .from("workspace_members")
    .select("role, workspaces(id, name, slug, kind)")
    .eq("user_id", userId)
    .eq("status", "active")

  if (error) {
    throw new Error(dbErrorMessage("No se pudieron cargar los workspaces", error))
  }

  // Los workspaces "personal" que crea el trigger de registro ya no forman
  // parte del producto: solo un superadministrador crea workspaces.
  return (data ?? [])
    .filter((row: any) => row.workspaces && row.workspaces.kind === "company")
    .map((row: any) => ({
      id: row.workspaces.id,
      name: row.workspaces.name,
      slug: row.workspaces.slug,
      kind: row.workspaces.kind,
      role: row.role,
    }))
}

export async function getWorkspaceBySlug(
  client: SupabaseClient,
  slug: string
): Promise<{ id: string; name: string; slug: string; kind: string } | null> {
  const { data, error } = await client
    .from("workspaces")
    .select("id, name, slug, kind")
    .eq("slug", slug)
    .maybeSingle()

  if (error || !data) {
    return null
  }
  return data
}
