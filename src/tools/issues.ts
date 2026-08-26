import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import { getUserClient } from "../auth/supabase-client.js"
import * as issues from "../repositories/issues.js"
import { resolveProject } from "./resolve-project.js"
import {
  resolveAssigneeId,
  resolveLabelIds,
  resolveStatusId,
  resolveTypeId,
} from "./resolve-refs.js"
import { ok, fail } from "./response.js"

const priority = z
  .enum(["none", "low", "medium", "high", "urgent"])
  .describe("Prioridad de la incidencia")

const typeRef = z
  .string()
  .describe("Tipo de incidencia por nombre ('Bug', 'Tarea', ...) o por id. Ver list_project_metadata")

const statusRef = z
  .string()
  .describe(
    "Estado por nombre ('En progreso'), por categoría ('todo', 'in_progress', 'done', ...) o por id"
  )

const assigneeRef = z
  .string()
  .describe("Persona asignada por correo, nombre completo o userId")

const labelsRef = z
  .array(z.string())
  .describe("Etiquetas por nombre o id. Se reemplaza el conjunto completo de etiquetas")

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
        limit: z
          .number()
          .int()
          .positive()
          .max(200)
          .optional()
          .describe("Máximo de resultados (default 50, tope 200)"),
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
      description:
        "Obtiene el detalle completo de una incidencia por su número: descripción, pasos para reproducir, estado, tipo, etiquetas, comentarios, historial de actividad y adjuntos (con URL firmada temporal para descargarlos).",
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
        "Crea una incidencia con toda su información: título, descripción, pasos para reproducir, tipo, estado, prioridad, persona asignada, etiquetas y fecha límite. Los campos `type`, `status`, `assignee` y `labels` aceptan nombres además de ids. Para adjuntar capturas de evidencia usa después add_issue_attachment.",
      inputSchema: {
        workspaceSlug: z.string(),
        projectKey: z.string(),
        title: z.string().min(1),
        description: z.string().optional().describe("Qué ocurre y por qué es un problema"),
        stepsToReproduce: z
          .string()
          .optional()
          .describe("Pasos numerados para reproducir el problema, uno por línea"),
        type: typeRef.optional(),
        status: statusRef.optional().describe("Si se omite, se usa el primer estado del flujo"),
        priority: priority.optional(),
        assignee: assigneeRef.optional(),
        labels: labelsRef.optional(),
        createMissingLabels: z
          .boolean()
          .optional()
          .describe("Crea las etiquetas que no existan en vez de fallar (default false)"),
        dueDate: z.string().optional().describe("Fecha ISO (YYYY-MM-DD)"),
      },
    },
    async (input) => {
      try {
        const { client, userId } = await getUserClient()
        const { workspace, project } = await resolveProject(
          client,
          input.workspaceSlug,
          input.projectKey
        )

        const [statusId, typeId, assigneeId, labelIds] = await Promise.all([
          input.status ? resolveStatusId(client, project.id, input.status) : undefined,
          input.type ? resolveTypeId(client, project.id, input.type) : undefined,
          input.assignee ? resolveAssigneeId(client, workspace.id, input.assignee) : undefined,
          input.labels
            ? resolveLabelIds(client, project.id, input.labels, input.createMissingLabels ?? false)
            : undefined,
        ])

        const issue = await issues.createIssue(client, {
          projectId: project.id,
          title: input.title,
          description: input.description,
          stepsToReproduce: input.stepsToReproduce,
          statusId,
          typeId,
          priority: input.priority,
          assigneeId,
          labelIds,
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
        "Actualiza cualquier campo de una incidencia existente: título, descripción, pasos para reproducir, tipo, estado, prioridad, persona asignada, etiquetas y fecha límite. Solo se modifican los campos que envíes. Los cambios de estado, prioridad y asignación quedan registrados en el historial de actividad.",
      inputSchema: {
        workspaceSlug: z.string(),
        projectKey: z.string(),
        issueNumber: z.number().int().positive(),
        title: z.string().optional(),
        description: z.string().optional(),
        stepsToReproduce: z.string().optional(),
        type: typeRef.optional(),
        status: statusRef.optional(),
        priority: priority.optional(),
        assignee: assigneeRef.nullable().optional().describe("null para desasignar"),
        labels: labelsRef.optional().describe("Reemplaza todas las etiquetas. [] las quita todas"),
        createMissingLabels: z.boolean().optional(),
        dueDate: z.string().nullable().optional().describe("Fecha ISO o null para quitarla"),
      },
    },
    async (input) => {
      try {
        const { client, userId } = await getUserClient()
        const { workspace, project } = await resolveProject(
          client,
          input.workspaceSlug,
          input.projectKey
        )
        const issue = await issues.getIssueByNumber(client, project.id, input.issueNumber)
        if (!issue) {
          return fail(
            new Error(`No se encontró la incidencia #${input.issueNumber} en ${input.projectKey}`)
          )
        }

        const statusId = input.status
          ? await resolveStatusId(client, project.id, input.status)
          : undefined
        const typeId = input.type ? await resolveTypeId(client, project.id, input.type) : undefined
        const assigneeId =
          input.assignee === undefined
            ? undefined
            : input.assignee === null
              ? null
              : await resolveAssigneeId(client, workspace.id, input.assignee)

        await issues.updateIssue(client, issue.id, userId, {
          title: input.title,
          description: input.description,
          stepsToReproduce: input.stepsToReproduce,
          statusId,
          typeId,
          priority: input.priority,
          assigneeId,
          dueDate: input.dueDate,
        })

        if (input.labels) {
          const labelIds = await resolveLabelIds(
            client,
            project.id,
            input.labels,
            input.createMissingLabels ?? false
          )
          await issues.setIssueLabels(client, issue.id, labelIds)
        }

        return ok(await issues.getIssueByNumber(client, project.id, input.issueNumber))
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
        const comment = await issues.createComment(client, {
          issueId: issue.id,
          authorId: userId,
          body,
        })
        return ok(comment)
      } catch (err) {
        return fail(err)
      }
    }
  )
}
