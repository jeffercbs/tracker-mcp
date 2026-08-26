import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import { getUserClient } from "../auth/supabase-client.js"
import * as issues from "../repositories/issues.js"
import { resolveProject } from "./resolve-project.js"
import { ok, fail } from "./response.js"

export function registerIssueTools(server: McpServer) {
  server.registerTool(
    "list_issues",
    {
      title: "Listar incidencias",
      description:
        "Lista las incidencias (issues) de un proyecto, con filtros opcionales y paginación. Devuelve como máximo 50 por página salvo que pidas otro `limit`.",
      inputSchema: {
        workspaceSlug: z.string(),
        projectKey: z.string(),
        statusCategory: z
          .enum(["backlog", "todo", "in_progress", "done", "cancelled"])
          .optional()
          .describe("Filtra por categoría de estado"),
        assigneeId: z.string().uuid().optional().describe("Filtra por id de usuario asignado"),
        limit: z.number().int().positive().max(200).optional().describe("Máximo de resultados (default 50, tope 200)"),
        offset: z.number().int().min(0).optional().describe("Cuántos resultados saltar, para paginar"),
      },
    },
    async ({ workspaceSlug, projectKey, statusCategory, assigneeId, limit, offset }) => {
      try {
        const { client } = await getUserClient()
        const { project } = await resolveProject(client, workspaceSlug, projectKey)
        return ok(
          await issues.listIssuesForProject(client, project.id, {
            statusCategory,
            assigneeId,
            limit,
            offset,
          })
        )
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    "get_issue",
    {
      title: "Obtener incidencia",
      description: "Obtiene el detalle de una incidencia por su número dentro del proyecto, incluyendo comentarios.",
      inputSchema: {
        workspaceSlug: z.string(),
        projectKey: z.string(),
        issueNumber: z.number().int().positive(),
      },
    },
    async ({ workspaceSlug, projectKey, issueNumber }) => {
      try {
        const { client } = await getUserClient()
        const { project } = await resolveProject(client, workspaceSlug, projectKey)
        const issue = await issues.getIssueByNumber(client, project.id, issueNumber)
        if (!issue) {
          return fail(new Error(`No se encontró la incidencia #${issueNumber} en ${projectKey}`))
        }
        return ok(issue)
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    "create_issue",
    {
      title: "Crear incidencia",
      description:
        "Crea una nueva incidencia (issue) en un proyecto. Usa list_project_metadata primero para obtener statusId/typeId válidos si querés fijarlos.",
      inputSchema: {
        workspaceSlug: z.string(),
        projectKey: z.string(),
        title: z.string().min(1),
        description: z.string().optional(),
        stepsToReproduce: z.string().optional(),
        statusId: z.string().uuid().optional(),
        typeId: z.string().uuid().optional(),
        priority: z.enum(["none", "low", "medium", "high", "urgent"]).optional(),
        assigneeId: z.string().uuid().optional(),
        dueDate: z.string().optional().describe("Fecha ISO (YYYY-MM-DD)"),
      },
    },
    async (input) => {
      try {
        const { client, userId } = await getUserClient()
        const { project } = await resolveProject(client, input.workspaceSlug, input.projectKey)
        const issue = await issues.createIssue(client, {
          projectId: project.id,
          title: input.title,
          description: input.description,
          stepsToReproduce: input.stepsToReproduce,
          statusId: input.statusId,
          typeId: input.typeId,
          priority: input.priority,
          assigneeId: input.assigneeId,
          dueDate: input.dueDate,
          reporterId: userId,
        })
        return ok(issue)
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    "update_issue",
    {
      title: "Actualizar incidencia",
      description:
        "Actualiza campos de una incidencia existente (título, descripción, estado, tipo, prioridad, asignado, fecha límite).",
      inputSchema: {
        workspaceSlug: z.string(),
        projectKey: z.string(),
        issueNumber: z.number().int().positive(),
        title: z.string().optional(),
        description: z.string().optional(),
        statusId: z.string().uuid().optional(),
        typeId: z.string().uuid().optional(),
        priority: z.enum(["none", "low", "medium", "high", "urgent"]).optional(),
        assigneeId: z.string().uuid().nullable().optional(),
        dueDate: z.string().nullable().optional(),
      },
    },
    async (input) => {
      try {
        const { client } = await getUserClient()
        const { project } = await resolveProject(client, input.workspaceSlug, input.projectKey)
        const issue = await issues.getIssueByNumber(client, project.id, input.issueNumber)
        if (!issue) {
          return fail(new Error(`No se encontró la incidencia #${input.issueNumber} en ${input.projectKey}`))
        }
        await issues.updateIssue(client, issue.id, {
          title: input.title,
          description: input.description,
          statusId: input.statusId,
          typeId: input.typeId,
          priority: input.priority,
          assigneeId: input.assigneeId,
          dueDate: input.dueDate,
        })
        const updated = await issues.getIssueByNumber(client, project.id, input.issueNumber)
        return ok(updated)
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    "add_issue_comment",
    {
      title: "Comentar incidencia",
      description: "Agrega un comentario a una incidencia existente.",
      inputSchema: {
        workspaceSlug: z.string(),
        projectKey: z.string(),
        issueNumber: z.number().int().positive(),
        body: z.string().min(1),
      },
    },
    async ({ workspaceSlug, projectKey, issueNumber, body }) => {
      try {
        const { client, userId } = await getUserClient()
        const { project } = await resolveProject(client, workspaceSlug, projectKey)
        const issue = await issues.getIssueByNumber(client, project.id, issueNumber)
        if (!issue) {
          return fail(new Error(`No se encontró la incidencia #${issueNumber} en ${projectKey}`))
        }
        const comment = await issues.createComment(client, { issueId: issue.id, authorId: userId, body })
        return ok(comment)
      } catch (err) {
        return fail(err)
      }
    }
  )
}
