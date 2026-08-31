import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import { getUserClient } from "../auth/supabase-client.js"
import * as issues from "../repositories/issues.js"
import * as notes from "../repositories/notes.js"
import { resolveProject } from "./resolve-project.js"
import { resolveSubproject } from "./resolve-refs.js"
import { formatArg, mdBlock, mdFields, mdJoin, mdSection, mdTable, ok, fail } from "./response.js"
import { NoteSchema } from "./schemas.js"

function notesTable(list: notes.NoteDTO[]) {
  return mdTable(
    ["Título", "Visibilidad", "Fijada", "Actualizada", "Id"],
    list.map((note) => [note.title, note.visibility, note.pinned ? "sí" : "no", note.updatedAt, note.id]),
    "No hay notas"
  )
}

function noteMarkdown(note: notes.NoteDTO) {
  return mdJoin(
    `# ${note.title}`,
    mdFields([
      ["Visibilidad", note.visibility],
      ["Fijada", note.pinned ? "sí" : "no"],
      ["Incidencia", note.issueId],
      ["Creada", note.createdAt],
      ["Actualizada", note.updatedAt],
      ["Id", note.id],
    ]),
    mdBlock(note.content, "Nota sin contenido")
  )
}

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
        format: formatArg,
      },
      outputSchema: { notes: z.array(NoteSchema) },
    },
    async ({ workspaceSlug, projectKey, issueNumber, limit, format }) => {
      try {
        const { client } = await getUserClient()
        const { project } = await resolveProject(client, workspaceSlug, projectKey)
        if (issueNumber) {
          const issue = await issues.findIssueRef(client, project.id, issueNumber)
          if (!issue) {
            return fail(new Error(`No se encontró la incidencia #${issueNumber} en ${projectKey}`))
          }
          const list = await notes.listNotesForIssue(client, issue.id, limit)
          return ok(
            { notes: list },
            {
              format,
              markdown: (data) =>
                mdSection(`Notas de #${issueNumber}`, notesTable(data.notes), 1),
            }
          )
        }
        const list = await notes.listNotesForProject(client, project.id, limit)
        return ok(
          { notes: list },
          { format, markdown: (data) => mdSection(`Notas de ${projectKey}`, notesTable(data.notes), 1) }
        )
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
      inputSchema: { noteId: z.uuid(), format: formatArg },
      outputSchema: { note: NoteSchema },
    },
    async ({ noteId, format }) => {
      try {
        const { client } = await getUserClient()
        const note = await notes.getNote(client, noteId)
        if (!note) {
          return fail(new Error(`No se encontró (o no tenés acceso a) la nota ${noteId}`))
        }
        return ok({ note }, { format, markdown: (data) => noteMarkdown(data.note) })
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
        "Crea una nota en un proyecto, opcionalmente asociada a una incidencia. SOLO se llama cuando la persona usuaria pide explícitamente que se cree una nota: no crees notas por iniciativa propia para dejar constancia de tu trabajo. Si crees que hace falta una, ofrécela y espera a que te digan que sí. Cuando te la pidan, es el sitio para el material que no cabe en los cuatro campos fijos de la incidencia (decisiones técnicas descartadas, consultas SQL de diagnóstico, análisis de impacto, pendientes derivados, notas de despliegue o contexto de una investigación). Pasa siempre `issueNumber` cuando la nota pertenezca a una incidencia, para que no quede suelta en el proyecto. Una nota por tema.",
      inputSchema: {
        workspaceSlug: z.string(),
        projectKey: z.string(),
        issueNumber: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Incidencia a la que pertenece la nota. Pásalo siempre que exista una"),
        subproject: z
          .string()
          .optional()
          .describe(
            "Subproyecto al que se refiere el recurso, por nombre o id. Los recursos son del proyecto: esto solo indica de qué tablero hablan"
          ),
        title: z.string().min(1).describe("Título que se entienda leyéndolo en una lista"),
        content: z
          .string()
          .max(20000)
          .optional()
          .describe(
            "Contenido en Markdown. Una nota por tema y al grano: si el material cabe en los cuatro campos de la incidencia, va ahí y no en una nota"
          ),
        visibility: z
          .enum(["private", "shared"])
          .optional()
          .describe("'shared' (recomendado) la ve el workspace; 'private' solo el autor"),
        format: formatArg,
      },
      outputSchema: { note: NoteSchema },
    },
    async (input) => {
      try {
        const { client, userId } = await getUserClient()
        const { workspace, project } = await resolveProject(client, input.workspaceSlug, input.projectKey)

        let issueId: string | undefined
        if (input.issueNumber) {
          const issue = await issues.findIssueRef(client, project.id, input.issueNumber)
          if (!issue) {
            return fail(new Error(`No se encontró la incidencia #${input.issueNumber} en ${input.projectKey}`))
          }
          issueId = issue.id
        }

        const subprojectId = input.subproject
          ? (await resolveSubproject(client, project.id, input.subproject)).id
          : undefined

        const note = await notes.createNote(client, {
          workspaceId: workspace.id,
          projectId: project.id,
          subprojectId,
          issueId,
          authorId: userId,
          title: input.title,
          content: input.content,
          visibility: input.visibility,
        })
        return ok({ note }, { format: input.format, markdown: (data) => noteMarkdown(data.note) })
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
        noteId: z.uuid(),
        title: z.string().optional(),
        content: z.string().optional(),
        pinned: z.boolean().optional(),
        visibility: z.enum(["private", "shared"]).optional(),
        format: formatArg,
      },
      outputSchema: { note: NoteSchema },
    },
    async ({ noteId, format, ...patch }) => {
      try {
        const { client } = await getUserClient()
        await notes.updateNote(client, noteId, patch)
        const updated = await notes.getNote(client, noteId)
        if (!updated) {
          return fail(new Error(`No se pudo releer la nota ${noteId} tras actualizarla`))
        }
        return ok({ note: updated }, { format, markdown: (data) => noteMarkdown(data.note) })
      } catch (err) {
        return fail(err)
      }
    }
  )
}
