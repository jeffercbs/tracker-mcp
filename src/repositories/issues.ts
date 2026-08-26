import type { SupabaseClient } from "@supabase/supabase-js"

import { dbErrorMessage } from "./errors.js"
import { listAttachmentsForIssue, type AttachmentDTO } from "./attachments.js"

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

export interface ActivityEntryDTO {
  id: string
  actorId: string | null
  action: string
  fromValue: string | null
  toValue: string | null
  createdAt: string
}

export interface IssueDetailDTO extends IssueListItemDTO {
  description: string
  stepsToReproduce: string
  businessLogic: string
  resolutionNotes: string
  comments: CommentDTO[]
  activity: ActivityEntryDTO[]
  attachments: AttachmentDTO[]
}

const LIST_SELECT = `
  id, project_id, number, title, priority, due_date, created_at, updated_at, assignee_id, reporter_id, sprint_id,
  status:issue_statuses(id, name, category, color),
  type:issue_types(id, name, color),
  issue_labels(labels(id, name, color))
`

const DETAIL_SELECT = `
  id, project_id, number, title, description, steps_to_reproduce, business_logic, resolution_notes, priority, due_date, created_at, updated_at, assignee_id, reporter_id, sprint_id,
  status:issue_statuses(id, name, category, color),
  type:issue_types(id, name, color),
  issue_labels(labels(id, name, color)),
  comments(id, author_id, body, created_at),
  activity_log(id, actor_id, action, from_value, to_value, created_at)
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

function mapActivity(row: any): ActivityEntryDTO {
  return {
    id: row.id,
    actorId: row.actor_id,
    action: row.action,
    fromValue: row.from_value,
    toValue: row.to_value,
    createdAt: row.created_at,
  }
}

async function mapIssueDetail(
  client: SupabaseClient,
  row: any
): Promise<IssueDetailDTO> {
  return {
    ...mapIssueRow(row),
    description: row.description ?? "",
    stepsToReproduce: row.steps_to_reproduce ?? "",
    businessLogic: row.business_logic ?? "",
    resolutionNotes: row.resolution_notes ?? "",
    comments: (row.comments ?? []).map(mapComment),
    activity: (row.activity_log ?? []).map(mapActivity),
    attachments: await listAttachmentsForIssue(client, row.id),
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
    .order("created_at", { referencedTable: "activity_log", ascending: true })
    .maybeSingle()

  if (error || !data) {
    return null
  }

  return mapIssueDetail(client, data)
}

export async function createIssue(
  client: SupabaseClient,
  input: {
    projectId: string
    title: string
    description?: string
    stepsToReproduce?: string
    businessLogic?: string
    resolutionNotes?: string
    statusId?: string
    typeId?: string
    priority?: string
    assigneeId?: string
    dueDate?: string
    labelIds?: string[]
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
      business_logic: input.businessLogic,
      resolution_notes: input.resolutionNotes,
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

  if (input.labelIds && input.labelIds.length > 0) {
    await setIssueLabels(client, row.id, input.labelIds)
    const refreshed = await getIssueByNumber(client, input.projectId, row.number)
    if (refreshed) {
      return refreshed
    }
  }

  return mapIssueDetail(client, row)
}

export async function setIssueLabels(
  client: SupabaseClient,
  issueId: string,
  labelIds: string[]
) {
  const { error: deleteError } = await client
    .from("issue_labels")
    .delete()
    .eq("issue_id", issueId)

  if (deleteError) {
    throw new Error(dbErrorMessage("No se pudieron limpiar las etiquetas", deleteError))
  }

  if (labelIds.length === 0) {
    return
  }

  const { error } = await client
    .from("issue_labels")
    .insert(labelIds.map((labelId) => ({ issue_id: issueId, label_id: labelId })))

  if (error) {
    throw new Error(dbErrorMessage("No se pudieron asignar las etiquetas", error))
  }
}

export async function updateIssue(
  client: SupabaseClient,
  issueId: string,
  actorId: string,
  patch: {
    title?: string
    description?: string
    stepsToReproduce?: string
    businessLogic?: string
    resolutionNotes?: string
    statusId?: string
    typeId?: string | null
    priority?: string
    assigneeId?: string | null
    dueDate?: string | null
  }
) {
  const update: Record<string, unknown> = {}
  if (patch.title !== undefined) update.title = patch.title
  if (patch.description !== undefined) update.description = patch.description
  if (patch.stepsToReproduce !== undefined) update.steps_to_reproduce = patch.stepsToReproduce
  if (patch.businessLogic !== undefined) update.business_logic = patch.businessLogic
  if (patch.resolutionNotes !== undefined) update.resolution_notes = patch.resolutionNotes
  if (patch.statusId !== undefined) update.status_id = patch.statusId
  if (patch.typeId !== undefined) update.type_id = patch.typeId
  if (patch.priority !== undefined) update.priority = patch.priority
  if (patch.assigneeId !== undefined) update.assignee_id = patch.assigneeId
  if (patch.dueDate !== undefined) update.due_date = patch.dueDate

  if (Object.keys(update).length === 0) {
    return
  }

  const { data: before } = await client
    .from("issues")
    .select("status_id, priority, assignee_id")
    .eq("id", issueId)
    .maybeSingle()

  const { error } = await client.from("issues").update(update).eq("id", issueId)

  if (error) {
    throw new Error(dbErrorMessage("No se pudo actualizar la incidencia", error))
  }

  if (!before) {
    return
  }

  const activityRows: Array<{
    issue_id: string
    actor_id: string
    action: string
    from_value: string | null
    to_value: string | null
  }> = []

  if (patch.statusId !== undefined && patch.statusId !== before.status_id) {
    activityRows.push({
      issue_id: issueId,
      actor_id: actorId,
      action: "status_changed",
      from_value: before.status_id,
      to_value: patch.statusId,
    })
  }

  if (patch.priority !== undefined && patch.priority !== before.priority) {
    activityRows.push({
      issue_id: issueId,
      actor_id: actorId,
      action: "priority_changed",
      from_value: before.priority,
      to_value: patch.priority,
    })
  }

  if (patch.assigneeId !== undefined && patch.assigneeId !== before.assignee_id) {
    activityRows.push({
      issue_id: issueId,
      actor_id: actorId,
      action: "assignee_changed",
      from_value: before.assignee_id,
      to_value: patch.assigneeId,
    })
  }

  if (activityRows.length > 0) {
    await client.from("activity_log").insert(activityRows)
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
