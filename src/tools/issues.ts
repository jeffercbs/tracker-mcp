import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import { getUserClient } from "../auth/supabase-client.js"
import * as issues from "../repositories/issues.js"
import { resolveProject } from "./resolve-project.js"
import {
  resolveAssigneeId,
  resolveLabelIds,
  resolveStatus,
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
    "Estado por nombre ('En progreso'), por categoría ('todo', 'in_progress', 'done', ...) o por id. No pases un estado de categoría 'done' mientras falte documentación o evidencia: la incidencia no está terminada"
  )

const assigneeRef = z
  .string()
  .describe("Persona asignada por correo, nombre completo o userId")

const labelsRef = z
  .array(z.string())
  .describe("Etiquetas por nombre o id. Se reemplaza el conjunto completo de etiquetas")

const descriptionField = z
  .string()
  .describe(
    "Markdown. QUÉ pasa y POR QUÉ es un problema, en lenguaje de producto. PROHIBIDO: rutas de archivos, nombres de funciones o clases, fragmentos de código, ramas o commits. Todo eso va en resolutionNotes"
  )

const stepsField = z
  .string()
  .describe(
    "Markdown. Pasos numerados que cualquiera pueda seguir en la aplicación para llegar al fallo, sin referencias a código"
  )

const businessLogicField = z
  .string()
  .describe(
    "Markdown. La lógica de la incidencia: reglas de negocio, condiciones, casos borde y qué debería ocurrir en cada uno. Es la referencia para decidir si el comportamiento actual es correcto"
  )

const resolutionField = z
  .string()
  .describe(
    "Markdown. La solución aplicada: causa raíz, qué se cambió, en qué archivos y cómo se verificó. Es el ÚNICO campo donde van las referencias a código. Rellénalo antes de cerrar la incidencia"
  )

function missingDocumentation(
  issue: issues.IssueDetailDTO,
  patch: {
    description?: string
    businessLogic?: string
    resolutionNotes?: string
  }
): string[] {
  const resolved = {
    description: patch.description ?? issue.description,
    businessLogic: patch.businessLogic ?? issue.businessLogic,
    resolutionNotes: patch.resolutionNotes ?? issue.resolutionNotes,
  }

  const missing: string[] = []
  if (resolved.description.trim().length === 0) missing.push("`description` (el problema)")
  if (resolved.businessLogic.trim().length === 0) {
    missing.push("`businessLogic` (las reglas y el comportamiento esperado)")
  }
  if (resolved.resolutionNotes.trim().length === 0) {
    missing.push("`resolutionNotes` (la solución aplicada)")
  }
  return missing
}

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
        "Obtiene el detalle completo de una incidencia por su número: descripción, pasos para reproducir, lógica documentada, solución aplicada, estado, tipo, etiquetas, comentarios, historial de actividad y adjuntos (con URL firmada temporal para descargarlos).",
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
        "Crea una incidencia con toda su información: título, descripción, pasos para reproducir, lógica de negocio, solución aplicada, tipo, estado, prioridad, persona asignada, etiquetas y fecha límite. Los campos `type`, `status`, `assignee` y `labels` aceptan nombres además de ids. Para adjuntar capturas de evidencia usa después add_issue_attachment.",
      inputSchema: {
        workspaceSlug: z.string(),
        projectKey: z.string(),
        title: z.string().min(1),
        description: descriptionField.optional(),
        stepsToReproduce: stepsField.optional(),
        businessLogic: businessLogicField.optional(),
        resolutionNotes: resolutionField.optional(),
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
          businessLogic: input.businessLogic,
          resolutionNotes: input.resolutionNotes,
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
        "Actualiza cualquier campo de una incidencia existente: título, descripción, pasos para reproducir, lógica de negocio, solución aplicada, tipo, estado, prioridad, persona asignada, etiquetas y fecha límite. Usa `resolutionNotes` para documentar el arreglo cuando cierres una incidencia. Solo se modifican los campos que envíes. Los cambios de estado, prioridad y asignación quedan registrados en el historial de actividad.",
      inputSchema: {
        workspaceSlug: z.string(),
        projectKey: z.string(),
        issueNumber: z.number().int().positive(),
        title: z.string().optional(),
        description: descriptionField.optional(),
        stepsToReproduce: stepsField.optional(),
        businessLogic: businessLogicField.optional(),
        resolutionNotes: resolutionField.optional(),
        type: typeRef.optional(),
        status: statusRef.optional(),
        priority: priority.optional(),
        assignee: assigneeRef.nullable().optional().describe("null para desasignar"),
        labels: labelsRef.optional().describe("Reemplaza todas las etiquetas. [] las quita todas"),
        createMissingLabels: z.boolean().optional(),
        dueDate: z.string().nullable().optional().describe("Fecha ISO o null para quitarla"),
        forceClose: z
          .boolean()
          .optional()
          .describe(
            "Cierra la incidencia aunque falte documentación. Úsalo solo si la persona usuaria lo pide explícitamente, y dile qué queda sin documentar"
          ),
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

        const status = input.status
          ? await resolveStatus(client, project.id, input.status)
          : undefined
        const statusId = status?.id

        if (status?.category === "done" && !input.forceClose) {
          const missing = missingDocumentation(issue, input)
          if (missing.length > 0) {
            return fail(
              new Error(
                `No se cerró la incidencia #${issue.number}: una incidencia no se finaliza hasta que está documentada. Falta ${missing.join(", ")}. ` +
                  "Complétalo con update_issue (y add_issue_attachment para la evidencia) y vuelve a mover el estado. " +
                  "Si la persona usuaria pide cerrarla igual, repite la llamada con forceClose:true."
              )
            )
          }
        }

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
          businessLogic: input.businessLogic,
          resolutionNotes: input.resolutionNotes,
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
