import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import { getUserClient } from "../auth/supabase-client.js"
import * as workspaces from "../repositories/workspaces.js"
import * as projects from "../repositories/projects.js"
import { resolveProject } from "./resolve-project.js"
import { ok, fail } from "./response.js"

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
        "Lista los estados, tipos de incidencia y etiquetas disponibles en un proyecto. Úsalo antes de crear o actualizar una incidencia para conocer los IDs válidos.",
      inputSchema: {
        workspaceSlug: z.string(),
        projectKey: z.string().describe("Clave corta del proyecto, por ejemplo 'ENG'"),
      },
    },
    async ({ workspaceSlug, projectKey }) => {
      try {
        const { client } = await getUserClient()
        const { project } = await resolveProject(client, workspaceSlug, projectKey)
        const [statuses, types, labels] = await Promise.all([
          projects.listIssueStatuses(client, project.id),
          projects.listIssueTypes(client, project.id),
          projects.listLabels(client, project.id),
        ])
        return ok({ project, statuses, types, labels })
      } catch (err) {
        return fail(err)
      }
    }
  )
}
