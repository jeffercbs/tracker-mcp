import type { SupabaseClient } from "@supabase/supabase-js"

import { dbErrorMessage } from "./errors.js"

export interface NoteDTO {
  id: string
  workspaceId: string
  projectId: string | null
  issueId: string | null
  authorId: string
  title: string
  content: string
  pinned: boolean
  visibility: string
  color: string
  createdAt: string
  updatedAt: string
}

const NOTE_SELECT =
  "id, workspace_id, project_id, issue_id, author_id, title, content, pinned, visibility, color, created_at, updated_at"

const DEFAULT_LIST_LIMIT = 50
const MAX_LIST_LIMIT = 200

function mapNote(row: any): NoteDTO {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    issueId: row.issue_id,
    authorId: row.author_id,
    title: row.title,
    content: row.content,
    pinned: row.pinned,
    visibility: row.visibility,
    color: row.color,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function listNotesForProject(
  client: SupabaseClient,
  projectId: string,
  limit = DEFAULT_LIST_LIMIT
): Promise<NoteDTO[]> {
  const { data, error } = await client
    .from("notes")
    .select(NOTE_SELECT)
    .eq("project_id", projectId)
    .is("issue_id", null)
    .order("pinned", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(Math.min(limit, MAX_LIST_LIMIT))

  if (error) {
    throw new Error(dbErrorMessage("No se pudieron cargar las notas", error))
  }
  return (data ?? []).map(mapNote)
}

export async function listNotesForIssue(
  client: SupabaseClient,
  issueId: string,
  limit = DEFAULT_LIST_LIMIT
): Promise<NoteDTO[]> {
  const { data, error } = await client
    .from("notes")
    .select(NOTE_SELECT)
    .eq("issue_id", issueId)
    .order("pinned", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(Math.min(limit, MAX_LIST_LIMIT))

  if (error) {
    throw new Error(dbErrorMessage("No se pudieron cargar las notas", error))
  }
  return (data ?? []).map(mapNote)
}

export async function getNote(client: SupabaseClient, noteId: string): Promise<NoteDTO | null> {
  const { data, error } = await client.from("notes").select(NOTE_SELECT).eq("id", noteId).maybeSingle()

  if (error || !data) {
    return null
  }
  return mapNote(data)
}

export async function createNote(
  client: SupabaseClient,
  input: {
    workspaceId: string
    projectId: string
    issueId?: string
    authorId: string
    title: string
    content?: string
    visibility?: string
  }
): Promise<NoteDTO> {
  const { data, error } = await client
    .from("notes")
    .insert({
      workspace_id: input.workspaceId,
      project_id: input.projectId,
      issue_id: input.issueId,
      author_id: input.authorId,
      title: input.title,
      content: input.content ?? "",
      ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
    })
    .select(NOTE_SELECT)
    .single()

  if (error) {
    throw new Error(dbErrorMessage("No se pudo crear la nota", error))
  }
  return mapNote(data)
}

export async function updateNote(
  client: SupabaseClient,
  noteId: string,
  patch: { title?: string; content?: string; pinned?: boolean; visibility?: string }
) {
  const { error } = await client
    .from("notes")
    .update({
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.content !== undefined ? { content: patch.content } : {}),
      ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
      ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
    })
    .eq("id", noteId)

  if (error) {
    throw new Error(dbErrorMessage("No se pudo actualizar la nota", error))
  }
}
