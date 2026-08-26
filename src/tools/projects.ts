import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import { getUserClient } from "../auth/supabase-client.js"
import * as workspaces from "../repositories/workspaces.js"
import * as projects from "../repositories/projects.js"
import { resolveProject } from "./resolve-project.js"
import { ok, fail } from "./response.js"

const PRIORITIES = [
  { value: "none", label: "Sin prioridad" },
  { value: "low", label: "Baja" },
  { value: "medium", label: "Media" },
  { value: "high", label: "Alta" },
  { value: "urgent", label: "Urgente" },
]

const STATUS_CATEGORIES = [
  { value: "backlog", label: "Backlog" },
  { value: "todo", label: "Por hacer" },
  { value: "in_progress", label: "En progreso" },
  { value: "done", label: "Hecho" },
  { value: "cancelled", label: "Cancelado" },
]

export function registerProjectTools(server: McpServer) {
  server.registerTool(
    "list_projects",
    {
      title: "Listar proyectos",
      description: "Lista los proyectos de un workspace, identificado por su slug.",
      inputSchema: { workspaceSlug: z.string().describe("Slug del workspace, por ejemplo 'personal-ab12cd34'") },
    },
    async ({ workspaceSlug }) => {
      try {
        const { client } = await getUserClient()
        const workspace = await workspaces.getWorkspaceBySlug(client, workspaceSlug)
        if (!workspace) {
          return fail(new Error(`No se encontró (o no tenés acceso a) el workspace "${workspaceSlug}"`))
        }
        return ok(await projects.listProjectsForWorkspace(client, workspace.id))
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    "list_project_metadata",
    {
      title: "Metadatos de un proyecto",
      description:
        "Devuelve TODO lo que necesitas para crear o actualizar una incidencia en este proyecto: los tipos de incidencia disponibles (Bug, Tarea, ...), los estados del flujo de trabajo con su categoría, las etiquetas, las prioridades válidas y los miembros a los que se puede asignar. Llámalo antes de create_issue o update_issue.",
      inputSchema: {
        workspaceSlug: z.string(),
        projectKey: z.string().describe("Clave corta del proyecto, por ejemplo 'ENG'"),
      },
    },
    async ({ workspaceSlug, projectKey }) => {
      try {
        const { client } = await getUserClient()
        const { workspace, project } = await resolveProject(client, workspaceSlug, projectKey)
        const [statuses, types, labels, members] = await Promise.all([
          projects.listIssueStatuses(client, project.id),
          projects.listIssueTypes(client, project.id),
          projects.listLabels(client, project.id),
          projects.listWorkspaceMembers(client, workspace.id),
        ])
        return ok({
          project,
          workspace,
          issueTypes: types,
          statuses,
          labels,
          members,
          priorities: PRIORITIES,
          statusCategories: STATUS_CATEGORIES,
          hint: "En create_issue y update_issue puedes pasar `type`, `status`, `assignee` y `labels` por nombre (por ejemplo type:'Bug', status:'En progreso'); el servidor los resuelve a sus IDs. `status` también acepta una categoría como 'done'.",
        })
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    "list_workspace_members",
    {
      title: "Miembros del workspace",
      description:
        "Lista las personas del workspace con su userId, nombre, correo y rol. Úsalo para resolver a quién asignar una incidencia.",
      inputSchema: { workspaceSlug: z.string() },
    },
    async ({ workspaceSlug }) => {
      try {
        const { client } = await getUserClient()
        const workspace = await workspaces.getWorkspaceBySlug(client, workspaceSlug)
        if (!workspace) {
          return fail(new Error(`No se encontró (o no tenés acceso a) el workspace "${workspaceSlug}"`))
        }
        return ok(await projects.listWorkspaceMembers(client, workspace.id))
      } catch (err) {
        return fail(err)
      }
    }
  )
}
