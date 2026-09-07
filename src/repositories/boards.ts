import type { SupabaseClient } from "@supabase/supabase-js"

import { dbErrorMessage } from "./errors.js"

export type BoardKind = "sprint" | "waterfall" | "timeline"
export type BoardStatus = "planning" | "active" | "completed" | "archived"
export type BoardStageStatus = "planned" | "active" | "completed"
export type BoardSegmentKind = "main" | "overlap" | "dependency"

export interface BoardDTO {
  id: string
  projectId: string
  subprojectId: string | null
  kind: BoardKind
  name: string
  slug: string
  description: string
  status: BoardStatus
  startsAt: string | null
  endsAt: string | null
  unitCount: number
  unitLabel: string
  updatedAt: string
}

export interface BoardStageDTO {
  id: string
  boardId: string
  name: string
  goal: string
  status: BoardStageStatus
  startsAt: string | null
  endsAt: string | null
  position: number
}

export interface BoardIssueDTO {
  stageId: string
  id: string
  number: number
  title: string
  closed: boolean
  statusName: string | null
}

export interface BoardSegmentDTO {
  id: string
  stageId: string
  kind: BoardSegmentKind
  startUnit: number
  endUnit: number
}

const BOARD_SELECT =
  "id, project_id, subproject_id, kind, name, slug, description, status, starts_at, ends_at, unit_count, unit_label, position, updated_at"

const STAGE_SELECT = "id, board_id, name, goal, status, starts_at, ends_at, position"

const SEGMENT_SELECT = "id, stage_id, kind, start_unit, end_unit"

function mapBoard(row: any): BoardDTO {
  return {
    id: row.id,
    projectId: row.project_id,
    subprojectId: row.subproject_id,
    kind: row.kind,
    name: row.name,
    slug: row.slug,
    description: row.description ?? "",
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    unitCount: row.unit_count,
    unitLabel: row.unit_label,
    updatedAt: row.updated_at,
  }
}

function mapStage(row: any): BoardStageDTO {
  return {
    id: row.id,
    boardId: row.board_id,
    name: row.name,
    goal: row.goal ?? "",
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    position: row.position,
  }
}

function mapSegment(row: any): BoardSegmentDTO {
  return {
    id: row.id,
    stageId: row.stage_id,
    kind: row.kind,
    startUnit: row.start_unit,
    endUnit: row.end_unit,
  }
}

export async function listBoards(
  client: SupabaseClient,
  projectId: string,
  options: { subprojectId?: string | null } = {}
): Promise<BoardDTO[]> {
  let query = client.from("project_boards").select(BOARD_SELECT).eq("project_id", projectId)

  if (options.subprojectId === null) {
    query = query.is("subproject_id", null)
  } else if (options.subprojectId !== undefined) {
    query = query.eq("subproject_id", options.subprojectId)
  }

  const { data, error } = await query
    .order("position", { ascending: true })
    .order("created_at", { ascending: true })

  if (error) {
    throw new Error(dbErrorMessage("No se pudieron cargar los tableros", error))
  }

  return (data ?? []).map(mapBoard)
}

export async function createBoard(
  client: SupabaseClient,
  input: {
    projectId: string
    subprojectId: string | null
    kind: BoardKind
    name: string
    slug: string
    description: string
    startsAt: string | null
    endsAt: string | null
    unitCount: number
    unitLabel: string
    userId: string
  }
): Promise<BoardDTO> {
  const { data: last } = await client
    .from("project_boards")
    .select("position")
    .eq("project_id", input.projectId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data, error } = await client
    .from("project_boards")
    .insert({
      project_id: input.projectId,
      subproject_id: input.subprojectId,
      kind: input.kind,
      name: input.name,
      slug: input.slug,
      description: input.description,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      unit_count: input.unitCount,
      unit_label: input.unitLabel,
      position: ((last as any)?.position ?? -1) + 1,
      created_by: input.userId,
      updated_by: input.userId,
    })
    .select(BOARD_SELECT)
    .single()

  if (error) {
    throw new Error(dbErrorMessage("No se pudo crear el tablero", error))
  }

  return mapBoard(data)
}

export async function listStages(
  client: SupabaseClient,
  boardId: string
): Promise<BoardStageDTO[]> {
  const { data, error } = await client
    .from("board_stages")
    .select(STAGE_SELECT)
    .eq("board_id", boardId)
    .order("position", { ascending: true })

  if (error) {
    throw new Error(dbErrorMessage("No se pudieron cargar las etapas del tablero", error))
  }

  return (data ?? []).map(mapStage)
}

export async function createStages(
  client: SupabaseClient,
  boardId: string,
  stages: Array<{ name: string; goal?: string; startsAt?: string | null; endsAt?: string | null }>,
  startPosition = 0
): Promise<BoardStageDTO[]> {
  if (stages.length === 0) {
    return []
  }

  const { data, error } = await client
    .from("board_stages")
    .insert(
      stages.map((stage, index) => ({
        board_id: boardId,
        name: stage.name,
        goal: stage.goal ?? "",
        starts_at: stage.startsAt ?? null,
        ends_at: stage.endsAt ?? null,
        position: startPosition + index,
        status: startPosition + index === 0 ? "active" : "planned",
      }))
    )
    .select(STAGE_SELECT)

  if (error) {
    throw new Error(dbErrorMessage("No se pudieron crear las etapas del tablero", error))
  }

  return (data ?? []).map(mapStage)
}

export async function nextStagePosition(
  client: SupabaseClient,
  boardId: string
): Promise<number> {
  const { data } = await client
    .from("board_stages")
    .select("position")
    .eq("board_id", boardId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle()

  return ((data as any)?.position ?? -1) + 1
}

export async function updateStage(
  client: SupabaseClient,
  stageId: string,
  patch: {
    name?: string
    goal?: string
    status?: BoardStageStatus
    startsAt?: string | null
    endsAt?: string | null
  }
) {
  const update: Record<string, unknown> = {}
  if (patch.name !== undefined) update.name = patch.name
  if (patch.goal !== undefined) update.goal = patch.goal
  if (patch.status !== undefined) update.status = patch.status
  if (patch.startsAt !== undefined) update.starts_at = patch.startsAt
  if (patch.endsAt !== undefined) update.ends_at = patch.endsAt

  if (Object.keys(update).length === 0) {
    return
  }

  const { error } = await client.from("board_stages").update(update).eq("id", stageId)

  if (error) {
    throw new Error(dbErrorMessage("No se pudo actualizar la etapa", error))
  }
}

export async function listBoardIssues(
  client: SupabaseClient,
  boardId: string
): Promise<BoardIssueDTO[]> {
  const { data, error } = await client
    .from("board_stage_issues")
    .select(
      "stage_id, position, issue:issues(id, number, title, closed_at, status:issue_statuses(name, category))"
    )
    .eq("board_id", boardId)
    .order("position", { ascending: true })

  if (error) {
    throw new Error(dbErrorMessage("No se pudieron cargar las incidencias del tablero", error))
  }

  return (data ?? [])
    .filter((row: any) => row.issue)
    .map((row: any) => ({
      stageId: row.stage_id,
      id: row.issue.id,
      number: row.issue.number,
      title: row.issue.title,
      closed:
        row.issue.closed_at !== null ||
        row.issue.status?.category === "done" ||
        row.issue.status?.category === "cancelled",
      statusName: row.issue.status?.name ?? null,
    }))
}

export async function assignIssuesToStage(
  client: SupabaseClient,
  input: { boardId: string; stageId: string; issueIds: string[] }
) {
  const { data: last } = await client
    .from("board_stage_issues")
    .select("position")
    .eq("stage_id", input.stageId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle()

  const start = ((last as any)?.position ?? -1) + 1

  const { error } = await client.from("board_stage_issues").upsert(
    input.issueIds.map((issueId, index) => ({
      board_id: input.boardId,
      stage_id: input.stageId,
      issue_id: issueId,
      position: start + index,
    })),
    { onConflict: "board_id,issue_id" }
  )

  if (error) {
    throw new Error(dbErrorMessage("No se pudieron añadir las incidencias al tablero", error))
  }
}

export async function removeIssuesFromBoard(
  client: SupabaseClient,
  boardId: string,
  issueIds: string[]
) {
  const { error } = await client
    .from("board_stage_issues")
    .delete()
    .eq("board_id", boardId)
    .in("issue_id", issueIds)

  if (error) {
    throw new Error(dbErrorMessage("No se pudieron quitar las incidencias del tablero", error))
  }
}

export async function listSegments(
  client: SupabaseClient,
  boardId: string
): Promise<BoardSegmentDTO[]> {
  const { data, error } = await client
    .from("board_stage_segments")
    .select(SEGMENT_SELECT)
    .eq("board_id", boardId)
    .order("start_unit", { ascending: true })

  if (error) {
    throw new Error(dbErrorMessage("No se pudo cargar el cronograma", error))
  }

  return (data ?? []).map(mapSegment)
}

export async function createSegment(
  client: SupabaseClient,
  input: {
    boardId: string
    stageId: string
    kind: BoardSegmentKind
    startUnit: number
    endUnit: number
  }
): Promise<BoardSegmentDTO> {
  const { data, error } = await client
    .from("board_stage_segments")
    .insert({
      board_id: input.boardId,
      stage_id: input.stageId,
      kind: input.kind,
      start_unit: input.startUnit,
      end_unit: input.endUnit,
    })
    .select(SEGMENT_SELECT)
    .single()

  if (error) {
    throw new Error(dbErrorMessage("No se pudo crear el tramo del cronograma", error))
  }

  return mapSegment(data)
}

export async function deleteSegmentsInRange(
  client: SupabaseClient,
  input: { boardId: string; stageId: string; startUnit: number; endUnit: number }
): Promise<number> {
  const { data, error } = await client
    .from("board_stage_segments")
    .delete()
    .eq("board_id", input.boardId)
    .eq("stage_id", input.stageId)
    .lte("start_unit", input.endUnit)
    .gte("end_unit", input.startUnit)
    .select("id")

  if (error) {
    throw new Error(dbErrorMessage("No se pudieron borrar los tramos del cronograma", error))
  }

  return (data ?? []).length
}
