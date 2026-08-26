import type { SupabaseClient } from "@supabase/supabase-js"

import { dbErrorMessage } from "./errors.js"

export interface IssueListItemDTO {
  id: string
  projectId: string
  number: number
  title: string
  priority: string
  dueDate: string | null
  createdAt: string
  updatedAt: string
  assigneeId: string | null
  reporterId: string
  sprintId: string | null
  status: { id: string; name: string; category: string; color: string } | null
  type: { id: string; name: string; color: string } | null
  labels: { id: string; name: string; color: string }[]
}

export interface CommentDTO {
  id: string
  authorId: string
  body: string
  createdAt: string
}

export interface IssueDetailDTO extends IssueListItemDTO {
  description: string
  stepsToReproduce: string
  comments: CommentDTO[]
}

const LIST_SELECT = `
  id, project_id, number, title, priority, due_date, created_at, updated_at, assignee_id, reporter_id, sprint_id,
  status:issue_statuses(id, name, category, color),
  type:issue_types(id, name, color),
  issue_labels(labels(id, name, color))
`

const DETAIL_SELECT = `
  id, project_id, number, title, description, steps_to_reproduce, priority, due_date, created_at, updated_at, assignee_id, reporter_id, sprint_id,
  status:issue_statuses(id, name, category, color),
  type:issue_types(id, name, color),
  issue_labels(labels(id, name, color)),
  comments(id, author_id, body, created_at)
`

function mapIssueRow(row: any): IssueListItemDTO {
  return {
    id: row.id,
    projectId: row.project_id,
    number: row.number,
    title: row.title,
    priority: row.priority,
    dueDate: row.due_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    assigneeId: row.assignee_id,
    reporterId: row.reporter_id,
    sprintId: row.sprint_id,
    status: row.status ?? null,
    type: row.type ?? null,
    labels: (row.issue_labels ?? []).map((entry: any) => entry.labels).filter(Boolean),
  }
}

function mapComment(row: any): CommentDTO {
  return {
    id: row.id,
    authorId: row.author_id,
    body: row.body,
    createdAt: row.created_at,
  }
}

const DEFAULT_LIST_LIMIT = 50
const MAX_LIST_LIMIT = 200

export interface ListIssuesFilters {
  statusCategory?: string
  assigneeId?: string
  limit?: number
  offset?: number
}

async function statusIdsForCategory(
  client: SupabaseClient,
  projectId: string,
  category: string
): Promise<string[]> {
  const { data, error } = await client
    .from("issue_statuses")
    .select("id")
    .eq("project_id", projectId)
    .eq("category", category)

  if (error) {
    throw new Error(dbErrorMessage("No se pudieron resolver los estados del filtro", error))
  }
  return (data ?? []).map((row) => row.id)
}

export async function listIssuesForProject(
  client: SupabaseClient,
  projectId: string,
  filters?: ListIssuesFilters
): Promise<IssueListItemDTO[]> {
  const limit = Math.min(filters?.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT)
  const offset = filters?.offset ?? 0

  let query = client.from("issues").select(LIST_SELECT).eq("project_id", projectId)

  if (filters?.assigneeId) {
    query = query.eq("assignee_id", filters.assigneeId)
  }

  if (filters?.statusCategory) {
    const statusIds = await statusIdsForCategory(client, projectId, filters.statusCategory)
    if (statusIds.length === 0) {
      return []
    }
    query = query.in("status_id", statusIds)
  }

  const { data, error } = await query
    .order("number", { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) {
    throw new Error(dbErrorMessage("No se pudieron cargar las incidencias", error))
  }

  return (data ?? []).map(mapIssueRow)
}

export async function getIssueByNumber(
  client: SupabaseClient,
  projectId: string,
  number: number
): Promise<IssueDetailDTO | null> {
  const { data, error } = await client
    .from("issues")
    .select(DETAIL_SELECT)
    .eq("project_id", projectId)
    .eq("number", number)
    .order("created_at", { referencedTable: "comments", ascending: true })
    .maybeSingle()

  if (error || !data) {
    return null
  }

  const row = data as any
  return {
    ...mapIssueRow(row),
    description: row.description ?? "",
    stepsToReproduce: row.steps_to_reproduce ?? "",
    comments: (row.comments ?? []).map(mapComment),
  }
}

export async function createIssue(
  client: SupabaseClient,
  input: {
    projectId: string
    title: string
    description?: string
    stepsToReproduce?: string
    statusId?: string
    typeId?: string
    priority?: string
    assigneeId?: string
    dueDate?: string
    reporterId: string
  }
): Promise<IssueDetailDTO> {
  const { data: allocated, error: numberError } = await client.rpc("allocate_issue_number", {
    p_project_id: input.projectId,
  })

  if (numberError || allocated === null) {
    throw new Error(dbErrorMessage("No se pudo asignar el número de incidencia", numberError))
  }

  let statusId = input.statusId
  if (!statusId) {
    const { data: defaultStatus } = await client
      .from("issue_statuses")
      .select("id")
      .eq("project_id", input.projectId)
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle()
    statusId = defaultStatus?.id
  }

  const { data, error } = await client
    .from("issues")
    .insert({
      project_id: input.projectId,
      number: allocated,
      title: input.title,
      description: input.description ?? "",
      steps_to_reproduce: input.stepsToReproduce,
      status_id: statusId,
      type_id: input.typeId,
      priority: input.priority ?? "none",
      assignee_id: input.assigneeId,
      due_date: input.dueDate,
      reporter_id: input.reporterId,
    })
    .select(DETAIL_SELECT)
    .single()

  if (error) {
    throw new Error(dbErrorMessage("No se pudo crear la incidencia", error))
  }

  const row = data as any
  return {
    ...mapIssueRow(row),
    description: row.description ?? "",
    stepsToReproduce: row.steps_to_reproduce ?? "",
    comments: (row.comments ?? []).map(mapComment),
  }
}

export async function updateIssue(
  client: SupabaseClient,
  issueId: string,
  patch: {
    title?: string
    description?: string
    statusId?: string
    typeId?: string
    priority?: string
    assigneeId?: string | null
    dueDate?: string | null
  }
) {
  const update: Record<string, unknown> = {}
  if (patch.title !== undefined) update.title = patch.title
  if (patch.description !== undefined) update.description = patch.description
  if (patch.statusId !== undefined) update.status_id = patch.statusId
  if (patch.typeId !== undefined) update.type_id = patch.typeId
  if (patch.priority !== undefined) update.priority = patch.priority
  if (patch.assigneeId !== undefined) update.assignee_id = patch.assigneeId
  if (patch.dueDate !== undefined) update.due_date = patch.dueDate

  const { error } = await client.from("issues").update(update).eq("id", issueId)

  if (error) {
    throw new Error(dbErrorMessage("No se pudo actualizar la incidencia", error))
  }
}

export async function createComment(
  client: SupabaseClient,
  input: { issueId: string; authorId: string; body: string }
): Promise<CommentDTO> {
  const { data, error } = await client
    .from("comments")
    .insert({ issue_id: input.issueId, author_id: input.authorId, body: input.body })
    .select("id, author_id, body, created_at")
    .single()

  if (error) {
    throw new Error(dbErrorMessage("No se pudo publicar el comentario", error))
  }
  return mapComment(data)
}
