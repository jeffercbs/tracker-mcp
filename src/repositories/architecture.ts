import type { SupabaseClient } from "@supabase/supabase-js"

import { dbErrorMessage } from "./errors.js"

export interface ArchitectureRulesDTO {
  ignoreGlobs: string[]
  focusGlobs: string[]
  notes: string
  updatedAt: string | null
}

export interface ArchitectureDTO {
  projectId: string
  diagramType: string
  title: string
  summary: string | null
  spec: unknown
  sourceUrl: string | null
  sourceBranch: string | null
  sourceRevision: string | null
  archifyVersion: string | null
  componentCount: number
  connectionCount: number
  generatedAt: string
  updatedAt: string
}

const ARCHITECTURE_SELECT =
  "project_id, diagram_type, title, summary, spec, source_url, source_branch, source_revision, archify_version, component_count, connection_count, generated_at, updated_at"

const RULES_SELECT = "ignore_globs, focus_globs, notes, updated_at"

const DEFAULT_IGNORE_GLOBS = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/coverage/**",
  "**/*.lock",
  "**/*.min.*",
  "**/__snapshots__/**",
]

function mapArchitecture(row: any): ArchitectureDTO {
  return {
    projectId: row.project_id,
    diagramType: row.diagram_type,
    title: row.title,
    summary: row.summary,
    spec: row.spec,
    sourceUrl: row.source_url,
    sourceBranch: row.source_branch,
    sourceRevision: row.source_revision,
    archifyVersion: row.archify_version,
    componentCount: row.component_count,
    connectionCount: row.connection_count,
    generatedAt: row.generated_at,
    updatedAt: row.updated_at,
  }
}

export async function getArchitectureRules(
  client: SupabaseClient,
  projectId: string
): Promise<ArchitectureRulesDTO> {
  const { data, error } = await client
    .from("project_architecture_rules")
    .select(RULES_SELECT)
    .eq("project_id", projectId)
    .maybeSingle()

  if (error) {
    throw new Error(dbErrorMessage("No se pudieron cargar las restricciones", error))
  }

  if (!data) {
    return { ignoreGlobs: DEFAULT_IGNORE_GLOBS, focusGlobs: [], notes: "", updatedAt: null }
  }

  return {
    ignoreGlobs: data.ignore_globs ?? [],
    focusGlobs: data.focus_globs ?? [],
    notes: data.notes ?? "",
    updatedAt: data.updated_at,
  }
}

export async function getArchitecture(
  client: SupabaseClient,
  projectId: string
): Promise<ArchitectureDTO | null> {
  const { data, error } = await client
    .from("project_architecture")
    .select(ARCHITECTURE_SELECT)
    .eq("project_id", projectId)
    .maybeSingle()

  if (error) {
    throw new Error(dbErrorMessage("No se pudo cargar la arquitectura", error))
  }

  return data ? mapArchitecture(data) : null
}

export async function publishArchitecture(
  client: SupabaseClient,
  input: {
    projectId: string
    userId: string
    title: string
    summary?: string
    spec: unknown
    sourceUrl?: string
    sourceBranch?: string
    sourceRevision?: string
    archifyVersion?: string
    componentCount: number
    connectionCount: number
  }
): Promise<ArchitectureDTO> {
  const { data, error } = await client
    .from("project_architecture")
    .upsert(
      {
        project_id: input.projectId,
        diagram_type: "architecture",
        title: input.title,
        summary: input.summary ?? null,
        spec: input.spec,
        source_url: input.sourceUrl ?? null,
        source_branch: input.sourceBranch ?? null,
        source_revision: input.sourceRevision ?? null,
        archify_version: input.archifyVersion ?? null,
        component_count: input.componentCount,
        connection_count: input.connectionCount,
        generated_by: input.userId,
        generated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "project_id" }
    )
    .select(ARCHITECTURE_SELECT)
    .single()

  if (error || !data) {
    throw new Error(dbErrorMessage("No se pudo publicar la arquitectura", error))
  }

  return mapArchitecture(data)
}
