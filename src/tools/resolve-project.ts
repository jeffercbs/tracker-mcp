import type { SupabaseClient } from "@supabase/supabase-js"

import { getProjectWithWorkspace } from "../repositories/projects.js"

export async function resolveProject(
  client: SupabaseClient,
  workspaceSlug: string,
  projectKey: string
) {
  const resolved = await getProjectWithWorkspace(client, workspaceSlug, projectKey)
  if (!resolved) {
    throw new Error(
      `No se encontró (o no tenés acceso a) el proyecto "${projectKey}" en el workspace "${workspaceSlug}"`
    )
  }
  return resolved
}
