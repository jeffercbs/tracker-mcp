import type { SupabaseClient } from "@supabase/supabase-js"

import * as projects from "../repositories/projects.js"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuid(value: string) {
  return UUID_RE.test(value)
}

function normalize(value: string) {
  return value.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "")
}

function pick<T extends { id: string; name: string }>(
  options: T[],
  value: string,
  what: string
): T {
  if (isUuid(value)) {
    const byId = options.find((option) => option.id === value)
    if (byId) return byId
    throw new Error(
      `No existe ${what} con id "${value}". Disponibles: ${options.map((o) => `${o.name} (${o.id})`).join(", ") || "ninguno"}`
    )
  }

  const target = normalize(value)
  const exact = options.filter((option) => normalize(option.name) === target)
  if (exact.length === 1) return exact[0]

  const partial = options.filter((option) => normalize(option.name).includes(target))
  if (partial.length === 1) return partial[0]

  if (partial.length > 1) {
    throw new Error(
      `"${value}" coincide con varios ${what}: ${partial.map((o) => o.name).join(", ")}. Sé más específico o usa el id.`
    )
  }

  throw new Error(
    `No se encontró ${what} "${value}". Disponibles: ${options.map((o) => o.name).join(", ") || "ninguno"}`
  )
}

export async function resolveStatus(
  client: SupabaseClient,
  projectId: string,
  value: string
): Promise<projects.IssueStatusOption> {
  const statuses = await projects.listIssueStatuses(client, projectId)
  if (isUuid(value)) {
    return pick(statuses, value, "un estado")
  }

  const target = normalize(value)
  const byCategory = statuses.filter((status) => normalize(status.category) === target)
  if (byCategory.length === 1) {
    return byCategory[0]
  }

  return pick(statuses, value, "un estado")
}

export async function resolveStatusId(
  client: SupabaseClient,
  projectId: string,
  value: string
): Promise<string> {
  return (await resolveStatus(client, projectId, value)).id
}

export async function resolveTypeId(
  client: SupabaseClient,
  projectId: string,
  value: string
): Promise<string> {
  const types = await projects.listIssueTypes(client, projectId)
  return pick(types, value, "un tipo de incidencia").id
}

export async function resolveLabelIds(
  client: SupabaseClient,
  projectId: string,
  values: string[],
  createMissing: boolean
): Promise<string[]> {
  let labels = await projects.listLabels(client, projectId)
  const resolved: string[] = []

  for (const value of values) {
    const target = normalize(value)
    const existing = labels.find(
      (label) => label.id === value || normalize(label.name) === target
    )

    if (existing) {
      resolved.push(existing.id)
      continue
    }

    if (!createMissing) {
      throw new Error(
        `No se encontró la etiqueta "${value}". Disponibles: ${labels.map((l) => l.name).join(", ") || "ninguna"}. Usa createMissingLabels:true para crearla.`
      )
    }

    const created = await projects.createLabel(client, { projectId, name: value.trim() })
    labels = [...labels, created]
    resolved.push(created.id)
  }

  return Array.from(new Set(resolved))
}

export async function resolveAssigneeId(
  client: SupabaseClient,
  workspaceId: string,
  value: string
): Promise<string> {
  const members = await projects.listWorkspaceMembers(client, workspaceId)
  const target = normalize(value)

  const match = members.filter(
    (member) =>
      member.userId === value ||
      normalize(member.email) === target ||
      (member.fullName ? normalize(member.fullName) === target : false)
  )
  if (match.length === 1) return match[0].userId

  const partial = members.filter(
    (member) =>
      normalize(member.email).includes(target) ||
      (member.fullName ? normalize(member.fullName).includes(target) : false)
  )
  if (partial.length === 1) return partial[0].userId

  if (partial.length > 1) {
    throw new Error(
      `"${value}" coincide con varios miembros: ${partial.map((m) => m.email).join(", ")}. Sé más específico o usa el userId.`
    )
  }

  throw new Error(
    `No se encontró el miembro "${value}". Disponibles: ${members.map((m) => m.email).join(", ") || "ninguno"}`
  )
}
