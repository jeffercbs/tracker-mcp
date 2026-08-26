import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import { getUserClient } from "../auth/supabase-client.js"
import * as issues from "../repositories/issues.js"
import * as notes from "../repositories/notes.js"
import { resolveProject } from "./resolve-project.js"
import { ok, fail } from "./response.js"

export function registerNoteTools(server: McpServer) {
  server.registerTool(
    "list_notes",
    {
      title: "Listar notas",
      description: "Lista las notas de un proyecto (o de una incidencia específica dentro del proyecto).",
      inputSchema: {
        workspaceSlug: z.string(),
        projectKey: z.string(),
        issueNumber: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Si se da, lista las notas de esa incidencia en vez de las del proyecto"),
        limit: z.number().int().positive().max(200).optional().describe("Máximo de resultados (default 50, tope 200)"),
      },
    },
    async ({ workspaceSlug, projectKey, issueNumber, limit }) => {
      try {
        const { client } = await getUserClient()
        const { project } = await resolveProject(client, workspaceSlug, projectKey)
        if (issueNumber) {
          const issue = await issues.getIssueByNumber(client, project.id, issueNumber)
          if (!issue) {
            return fail(new Error(`No se encontró la incidencia #${issueNumber} en ${projectKey}`))
          }
          return ok(await notes.listNotesForIssue(client, issue.id, limit))
        }
        return ok(await notes.listNotesForProject(client, project.id, limit))
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    "get_note",
    {
      title: "Obtener nota",
      description: "Obtiene una nota por su id.",
      inputSchema: { noteId: z.string().uuid() },
    },
    async ({ noteId }) => {
      try {
        const { client } = await getUserClient()
        const note = await notes.getNote(client, noteId)
        if (!note) {
          return fail(new Error(`No se encontró (o no tenés acceso a) la nota ${noteId}`))
        }
        return ok(note)
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    "create_note",
    {
      title: "Crear nota",
      description:
        "Crea una nota en un proyecto, opcionalmente asociada a una incidencia. Es el sitio para todo el material de una incidencia que no cabe en sus cuatro campos fijos (description, stepsToReproduce, businessLogic, resolutionNotes): decisiones técnicas descartadas y por qué, consultas SQL de diagnóstico, análisis de impacto, pendientes derivados, notas de despliegue o contexto de una investigación. Pasa siempre `issueNumber` cuando la nota pertenezca a una incidencia, para que no quede suelta en el proyecto. Una nota por tema.",
      inputSchema: {
        workspaceSlug: z.string(),
        projectKey: z.string(),
        issueNumber: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Incidencia a la que pertenece la nota. Pásalo siempre que exista una"),
        title: z.string().min(1).describe("Título que se entienda leyéndolo en una lista"),
        content: z.string().optional().describe("Contenido en Markdown"),
        visibility: z
          .enum(["private", "shared"])
          .optional()
          .describe("'shared' (recomendado) la ve el workspace; 'private' solo el autor"),
      },
    },
    async (input) => {
      try {
        const { client, userId } = await getUserClient()
        const { workspace, project } = await resolveProject(client, input.workspaceSlug, input.projectKey)

        let issueId: string | undefined
        if (input.issueNumber) {
          const issue = await issues.getIssueByNumber(client, project.id, input.issueNumber)
          if (!issue) {
            return fail(new Error(`No se encontró la incidencia #${input.issueNumber} en ${input.projectKey}`))
          }
          issueId = issue.id
        }

        const note = await notes.createNote(client, {
          workspaceId: workspace.id,
          projectId: project.id,
          issueId,
          authorId: userId,
          title: input.title,
          content: input.content,
          visibility: input.visibility,
        })
        return ok(note)
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    "update_note",
    {
      title: "Actualizar nota",
      description: "Actualiza el título, contenido, estado de fijado o visibilidad de una nota existente.",
      inputSchema: {
        noteId: z.string().uuid(),
        title: z.string().optional(),
        content: z.string().optional(),
        pinned: z.boolean().optional(),
        visibility: z.enum(["private", "shared"]).optional(),
      },
    },
    async ({ noteId, ...patch }) => {
      try {
        const { client } = await getUserClient()
        await notes.updateNote(client, noteId, patch)
        const updated = await notes.getNote(client, noteId)
        return ok(updated)
      } catch (err) {
        return fail(err)
      }
    }
  )
}
