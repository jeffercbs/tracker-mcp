import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import { getUserClient } from "../auth/supabase-client.js"
import * as attachments from "../repositories/attachments.js"
import * as issues from "../repositories/issues.js"
import { resolveProject } from "./resolve-project.js"
import { formatArg, mdFields, mdSection, mdTable, ok, fail } from "./response.js"
import { AttachmentSchema } from "./schemas.js"

function attachmentsTable(list: attachments.AttachmentDTO[]) {
  return mdTable(
    ["Archivo", "Tipo", "Bytes", "URL (1 hora)", "Id"],
    list.map((item) => [item.filename, item.mimeType, item.size, item.url, item.id]),
    "Esta incidencia no tiene adjuntos"
  )
}

export function registerAttachmentTools(server: McpServer) {
  server.registerTool(
    "list_issue_attachments",
    {
      title: "Listar adjuntos",
      description:
        "Lista las capturas de evidencia y demás archivos adjuntos de una incidencia. Cada uno incluye una URL firmada válida por una hora para descargarlo.",
      inputSchema: {
        workspaceSlug: z.string(),
        projectKey: z.string(),
        issueNumber: z.number().int().positive(),
        format: formatArg,
      },
      outputSchema: { attachments: z.array(AttachmentSchema) },
    },
    async ({ workspaceSlug, projectKey, issueNumber, format }) => {
      try {
        const { client } = await getUserClient()
        const { project } = await resolveProject(client, workspaceSlug, projectKey)
        const issue = await issues.findIssueRef(client, project.id, issueNumber)
        if (!issue) {
          return fail(new Error(`No se encontró la incidencia #${issueNumber} en ${projectKey}`))
        }
        const list = await attachments.listAttachmentsForIssue(client, issue.id)
        return ok(
          { attachments: list },
          {
            format,
            markdown: (data) =>
              mdSection(`Adjuntos de #${issueNumber}`, attachmentsTable(data.attachments), 1),
          }
        )
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    "add_issue_attachment",
    {
      title: "Adjuntar evidencia",
      description:
        "Sube una captura de pantalla u otro archivo como evidencia de una incidencia. SOLO se llama cuando la persona usuaria pide explícitamente que se adjunte algo: no subas capturas ni archivos por iniciativa propia. Si crees que una imagen ayudaría, ofrécela y espera a que te digan que sí. Pasa `filePath` con la ruta local del archivo, o `base64` junto con `filename` si tienes el contenido en memoria. Límite de 10MB. El servidor rechaza ficheros de credenciales (.env, claves, certificados): subir un adjunto lo comparte con todo el workspace.",
      inputSchema: {
        workspaceSlug: z.string(),
        projectKey: z.string(),
        issueNumber: z.number().int().positive(),
        filePath: z
          .string()
          .optional()
          .describe("Ruta absoluta del archivo en la máquina donde corre el servidor MCP"),
        base64: z.string().optional().describe("Contenido del archivo en base64. Requiere filename"),
        filename: z
          .string()
          .optional()
          .describe("Nombre con el que se guarda. Por defecto, el del archivo en filePath"),
        mimeType: z
          .string()
          .optional()
          .describe("Tipo MIME. Si se omite se deduce de la extensión"),
        format: formatArg,
      },
      outputSchema: { attachment: AttachmentSchema },
    },
    async (input) => {
      try {
        const { client, userId } = await getUserClient()
        const { project } = await resolveProject(client, input.workspaceSlug, input.projectKey)
        const issue = await issues.findIssueRef(client, project.id, input.issueNumber)
        if (!issue) {
          return fail(
            new Error(`No se encontró la incidencia #${input.issueNumber} en ${input.projectKey}`)
          )
        }

        const attachment = await attachments.uploadIssueAttachment(client, {
          projectId: project.id,
          issueId: issue.id,
          createdBy: userId,
          source: {
            filePath: input.filePath,
            base64: input.base64,
            filename: input.filename,
            mimeType: input.mimeType,
          },
        })
        return ok(
          { attachment },
          {
            format: input.format,
            markdown: (data) =>
              mdSection(
                "Evidencia adjuntada",
                mdFields([
                  ["Archivo", data.attachment.filename],
                  ["Tipo", data.attachment.mimeType],
                  ["Bytes", data.attachment.size],
                  ["URL (1 hora)", data.attachment.url],
                  ["Id", data.attachment.id],
                ]),
                1
              ),
          }
        )
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    "delete_issue_attachment",
    {
      title: "Eliminar adjunto",
      description:
        "Elimina un adjunto de una incidencia, tanto su registro como el archivo almacenado, y no se puede deshacer. SOLO se llama cuando la persona usuaria pide borrar ese adjunto concreto. Usa list_issue_attachments para obtener el attachmentId.",
      inputSchema: {
        attachmentId: z.uuid(),
        format: formatArg,
      },
      outputSchema: { deleted: z.string() },
    },
    async ({ attachmentId, format }) => {
      try {
        const { client } = await getUserClient()
        await attachments.deleteAttachment(client, attachmentId)
        return ok(
          { deleted: attachmentId },
          { format, markdown: (data) => `Adjunto ${data.deleted} eliminado.` }
        )
      } catch (err) {
        return fail(err)
      }
    }
  )
}
