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
  module: { id: string; name: string; color: string } | null
  subproject: { id: string; name: string; slug: string; color: string } | null
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
  module:issue_modules(id, name, color),
  subproject:subprojects(id, name, slug, color),
  issue_labels(labels(id, name, color))
`

const DETAIL_BASE_SELECT = `
  id, project_id, number, title, description, steps_to_reproduce, business_logic, resolution_notes, priority, due_date, created_at, updated_at, assignee_id, reporter_id, sprint_id,
  status:issue_statuses(id, name, category, color),
  type:issue_types(id, name, color),
  module:issue_modules(id, name, color),
  subproject:subprojects(id, name, slug, color),
  issue_labels(labels(id, name, color))
`

export interface IssueDetailOptions {
  includeComments?: boolean
  includeActivity?: boolean
  includeAttachments?: boolean
  historyLimit?: number
}

const DEFAULT_HISTORY_LIMIT = 20

function detailSelect(options: IssueDetailOptions): string {
  const parts = [DETAIL_BASE_SELECT.trim()]
  if (options.includeComments) parts.push("comments(id, author_id, body, created_at)")
  if (options.includeActivity) {
    parts.push("activity_log(id, actor_id, action, from_value, to_value, created_at)")
  }
  return parts.join(",\n  ")
}

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
    module: row.module ?? null,
    subproject: row.subproject ?? null,
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

function lastN<T>(rows: T[], limit: number): T[] {
  return rows.length > limit ? rows.slice(rows.length - limit) : rows
}

async function mapIssueDetail(
  client: SupabaseClient,
  row: any,
  options: IssueDetailOptions = {}
): Promise<IssueDetailDTO> {
  const limit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT
  return {
    ...mapIssueRow(row),
    description: row.description ?? "",
    stepsToReproduce: row.steps_to_reproduce ?? "",
    businessLogic: row.business_logic ?? "",
    resolutionNotes: row.resolution_notes ?? "",
    comments: lastN((row.comments ?? []).map(mapComment), limit),
    activity: lastN((row.activity_log ?? []).map(mapActivity), limit),
    attachments: options.includeAttachments ? await listAttachmentsForIssue(client, row.id) : [],
  }
}

const DEFAULT_LIST_LIMIT = 50
const MAX_LIST_LIMIT = 200

export type IssueSearchField =
  | "title"
  | "description"
  | "stepsToReproduce"
  | "businessLogic"
  | "resolutionNotes"

const SEARCH_COLUMNS: Record<IssueSearchField, string> = {
  title: "title",
  description: "description",
  stepsToReproduce: "steps_to_reproduce",
  businessLogic: "business_logic",
  resolutionNotes: "resolution_notes",
}

const DEFAULT_SEARCH_FIELDS: IssueSearchField[] = [
  "title",
  "description",
  "stepsToReproduce",
  "businessLogic",
  "resolutionNotes",
]

export type IssueSortField = "number" | "createdAt" | "updatedAt" | "dueDate"

const SORT_COLUMNS: Record<IssueSortField, string> = {
  number: "number",
  createdAt: "created_at",
  updatedAt: "updated_at",
  dueDate: "due_date",
}

export interface ListIssuesFilters {
  /** Texto libre. Admite % como comodín; se busca sin distinguir mayúsculas. */
  query?: string
  searchIn?: IssueSearchField[]
  statusCategory?: string
  statusIds?: string[]
  typeIds?: string[]
  moduleIds?: string[]
  /** Incidencias sin módulo asignado. Excluyente con moduleIds. */
  withoutModule?: boolean
  subprojectId?: string
  assigneeId?: string
  /** Solo incidencias sin nadie asignado. Excluyente con assigneeId. */
  unassigned?: boolean
  reporterId?: string
  priorities?: string[]
  /** Incidencias que tengan AL MENOS una de estas etiquetas. */
  labelIds?: string[]
  createdAfter?: string
  createdBefore?: string
  updatedAfter?: string
  updatedBefore?: string
  dueAfter?: string
  dueBefore?: string
  /** true: solo con fecha límite; false: solo sin fecha límite. */
  hasDueDate?: boolean
  sortBy?: IssueSortField
  sortOrder?: "asc" | "desc"
  limit?: number
  offset?: number
}

export interface ListIssuesResult {
  items: IssueListItemDTO[]
  /** Cuántas incidencias cumplen el filtro en total, más allá de esta página. */
  total: number
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

async function issueIdsWithLabels(
  client: SupabaseClient,
  projectId: string,
  labelIds: string[]
): Promise<string[]> {
  const { data, error } = await client
    .from("issue_labels")
    .select("issue_id, issues!inner(project_id)")
    .eq("issues.project_id", projectId)
    .in("label_id", labelIds)

  if (error) {
    throw new Error(dbErrorMessage("No se pudieron resolver las etiquetas del filtro", error))
  }
  return Array.from(new Set((data ?? []).map((row: any) => row.issue_id)))
}

/**
 * Una fecha suelta (YYYY-MM-DD) como cota superior se interpreta hasta el final
 * de ese día, para que "hasta el 5" incluya al 5.
 */
function endOfDay(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? `${value.trim()}T23:59:59.999Z` : value
}

/** Escapa el valor para meterlo entre comillas en un filtro `or` de PostgREST. */
function quoteFilterValue(value: string): string {
  return value.replace(/["\\]/g, (match) => `\\${match}`)
}

export async function listIssuesForProject(
  client: SupabaseClient,
  projectId: string,
  filters?: ListIssuesFilters
): Promise<ListIssuesResult> {
  const limit = Math.min(filters?.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT)
  const offset = filters?.offset ?? 0
  const empty: ListIssuesResult = { items: [], total: 0 }

  let query = client
    .from("issues")
    .select(LIST_SELECT, { count: "exact" })
    .eq("project_id", projectId)

  if (filters?.query && filters.query.trim().length > 0) {
    const term = quoteFilterValue(filters.query.trim())
    const fields = filters.searchIn?.length ? filters.searchIn : DEFAULT_SEARCH_FIELDS
    const conditions = fields
      .map((field) => `${SEARCH_COLUMNS[field]}.ilike."%${term}%"`)
      .join(",")
    query = query.or(conditions)
  }

  if (filters?.unassigned) {
    query = query.is("assignee_id", null)
  } else if (filters?.assigneeId) {
    query = query.eq("assignee_id", filters.assigneeId)
  }

  if (filters?.reporterId) {
    query = query.eq("reporter_id", filters.reporterId)
  }

  if (filters?.priorities?.length) {
    query = query.in("priority", filters.priorities)
  }

  if (filters?.typeIds?.length) {
    query = query.in("type_id", filters.typeIds)
  }

  if (filters?.withoutModule) {
    query = query.is("module_id", null)
  } else if (filters?.moduleIds?.length) {
    query = query.in("module_id", filters.moduleIds)
  }

  if (filters?.subprojectId) {
    query = query.eq("subproject_id", filters.subprojectId)
  }

  if (filters?.statusIds?.length) {
    query = query.in("status_id", filters.statusIds)
  } else if (filters?.statusCategory) {
    const statusIds = await statusIdsForCategory(client, projectId, filters.statusCategory)
    if (statusIds.length === 0) {
      return empty
    }
    query = query.in("status_id", statusIds)
  }

  if (filters?.labelIds?.length) {
    const issueIds = await issueIdsWithLabels(client, projectId, filters.labelIds)
    if (issueIds.length === 0) {
      return empty
    }
    query = query.in("id", issueIds)
  }

  if (filters?.createdAfter) query = query.gte("created_at", filters.createdAfter)
  if (filters?.createdBefore) query = query.lte("created_at", endOfDay(filters.createdBefore))
  if (filters?.updatedAfter) query = query.gte("updated_at", filters.updatedAfter)
  if (filters?.updatedBefore) query = query.lte("updated_at", endOfDay(filters.updatedBefore))
  if (filters?.dueAfter) query = query.gte("due_date", filters.dueAfter)
  if (filters?.dueBefore) query = query.lte("due_date", filters.dueBefore)

  if (filters?.hasDueDate === true) query = query.not("due_date", "is", null)
  if (filters?.hasDueDate === false) query = query.is("due_date", null)

  const sortColumn = SORT_COLUMNS[filters?.sortBy ?? "number"]
  const ascending = filters?.sortOrder === "asc"

  const { data, error, count } = await query
    .order(sortColumn, { ascending, nullsFirst: false })
    .range(offset, offset + limit - 1)

  if (error) {
    throw new Error(dbErrorMessage("No se pudieron cargar las incidencias", error))
  }

  return { items: (data ?? []).map(mapIssueRow), total: count ?? (data ?? []).length }
}

export interface IssueRef {
  id: string
  number: number
  title: string
}

export async function findIssueRef(
  client: SupabaseClient,
  projectId: string,
  number: number
): Promise<IssueRef | null> {
  const { data, error } = await client
    .from("issues")
    .select("id, number, title")
    .eq("project_id", projectId)
    .eq("number", number)
    .maybeSingle()

  if (error || !data) {
    return null
  }
  return { id: data.id, number: data.number, title: data.title }
}

export async function findIssuesByTitle(
  client: SupabaseClient,
  projectId: string,
  pattern: string,
  limit = 5
): Promise<IssueRef[]> {
  const term = pattern.trim()
  if (term.length === 0) return []

  const { data, error } = await client
    .from("issues")
    .select("id, number, title")
    .eq("project_id", projectId)
    .ilike("title", term)
    .limit(limit)

  if (error) return []
  return (data ?? []).map((row: any) => ({ id: row.id, number: row.number, title: row.title }))
}

export async function getIssueByNumber(
  client: SupabaseClient,
  projectId: string,
  number: number,
  options: IssueDetailOptions = {}
): Promise<IssueDetailDTO | null> {
  let query = client
    .from("issues")
    .select(detailSelect(options))
    .eq("project_id", projectId)
    .eq("number", number)

  if (options.includeComments) {
    query = query.order("created_at", { referencedTable: "comments", ascending: true })
  }
  if (options.includeActivity) {
    query = query.order("created_at", { referencedTable: "activity_log", ascending: true })
  }

  const { data, error } = await query.maybeSingle()

  if (error || !data) {
    return null
  }

  return mapIssueDetail(client, data, options)
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
    moduleId?: string
    subprojectId?: string
    priority?: string
    assigneeId?: string
    dueDate?: string
    labelIds?: string[]
    reporterId: string
    createdAt?: string
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
      module_id: input.moduleId,
      subproject_id: input.subprojectId,
      priority: input.priority ?? "none",
      assignee_id: input.assigneeId,
      due_date: input.dueDate,
      reporter_id: input.reporterId,
      ...(input.createdAt !== undefined ? { created_at: input.createdAt } : {}),
    })
    .select(DETAIL_BASE_SELECT)
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
    moduleId?: string | null
    subprojectId?: string
    priority?: string
    assigneeId?: string | null
    dueDate?: string | null
    createdAt?: string
    updatedAt?: string
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
  if (patch.moduleId !== undefined) update.module_id = patch.moduleId
  if (patch.subprojectId !== undefined) update.subproject_id = patch.subprojectId
  if (patch.priority !== undefined) update.priority = patch.priority
  if (patch.assigneeId !== undefined) update.assignee_id = patch.assigneeId
  if (patch.dueDate !== undefined) update.due_date = patch.dueDate
  if (patch.createdAt !== undefined) update.created_at = patch.createdAt
  if (patch.updatedAt !== undefined) update.updated_at = patch.updatedAt

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
