import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import { getUserClient } from "../auth/supabase-client.js"
import * as issues from "../repositories/issues.js"
import { resolveProject } from "./resolve-project.js"
import {
  resolveAssigneeId,
  resolveLabelIds,
  resolvePersonId,
  resolveStatus,
  resolveModuleId,
  resolveModuleIdsForFilter,
  resolveStatusId,
  resolveStatusIdsForFilter,
  resolveSubproject,
  resolveTypeId,
  resolveTypeIdsForFilter,
  requireSubprojectForIssue,
} from "./resolve-refs.js"
import {
  formatArg,
  mdBlock,
  mdEmpty,
  mdFields,
  mdJoin,
  mdSection,
  mdTable,
  ok,
  fail,
} from "./response.js"
import { CommentSchema, IssueDetailSchema, IssueListItemSchema } from "./schemas.js"
import {
  requireDescriptionOnCreate,
  validateIssueText,
  type IssueTextPatch,
} from "./issue-rules.js"

const priority = z
  .enum(["none", "low", "medium", "high", "urgent"])
  .describe("Prioridad de la incidencia")

const typeRef = z
  .string()
  .describe("Tipo de incidencia por nombre ('Bug', 'Tarea', ...) o por id. Ver list_project_metadata")

const statusRef = z
  .string()
  .describe(
    "Estado por nombre ('En progreso'), por categoría ('todo', 'in_progress', 'done', ...) o por id. No pases un estado de categoría 'done' mientras falte documentación: la incidencia no está terminada"
  )

const assigneeRef = z
  .string()
  .describe("Persona asignada por correo, nombre completo o userId")

const labelsRef = z
  .array(z.string())
  .describe("Etiquetas por nombre o id. Se reemplaza el conjunto completo de etiquetas")

const descriptionField = z
  .string()
  .max(2500)
  .describe(
    "Markdown, 1-3 párrafos. QUÉ pasa, EN QUÉ situación y POR QUÉ es un problema para quien usa el producto. Concreto y contextualizado, no exhaustivo: el servidor rechaza rutas de archivos, código, consultas SQL, ramas o commits, que van en resolutionNotes"
  )

const stepsField = z
  .string()
  .max(2000)
  .describe(
    "Markdown. Pasos numerados, los mínimos para reproducir el fallo en la aplicación, sin referencias a código. Incluye el dato de partida y el resultado observado frente al esperado"
  )

const businessLogicField = z
  .string()
  .max(5000)
  .describe(
    "Markdown. Las reglas que aplican a este caso: condiciones, casos borde y qué debería ocurrir en cada uno. Solo las que afectan a esta incidencia, no el manual del módulo entero"
  )

const resolutionField = z
  .string()
  .max(8000)
  .describe(
    "Markdown. La solución aplicada, resumida: causa raíz, qué se cambió y en qué archivos, y cómo se verificó. Es el ÚNICO campo donde van las referencias a código. No pegues diffs completos ni el registro de la sesión. Rellénalo antes de cerrar la incidencia"
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

function normalizeTitle(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
}

function textPatch(input: IssueTextPatch): IssueTextPatch {
  return {
    title: input.title,
    description: input.description,
    stepsToReproduce: input.stepsToReproduce,
    businessLogic: input.businessLogic,
    resolutionNotes: input.resolutionNotes,
  }
}

function warningsMarkdown(warnings: string[]): string | null {
  if (warnings.length === 0) return null
  return mdSection(
    "Avisos de documentación",
    warnings.map((warning) => `- ${warning}`).join("\n")
  )
}

/* ------------------------------------------------------------------ *
 * Renderizadores Markdown
 * ------------------------------------------------------------------ */

/**
 * Resume en lenguaje llano los filtros que se aplicaron, para que la respuesta
 * diga sobre qué se está mirando y no solo qué salió.
 */
function describeFilters(input: Record<string, unknown>): Record<string, string> {
  const labels: Record<string, string> = {
    query: "Texto",
    searchIn: "Buscado en",
    status: "Estado",
    statusCategory: "Categoría de estado",
    type: "Tipo",
    module: "Módulo",
    withoutModule: "Sin módulo",
    subproject: "Subproyecto",
    priority: "Prioridad",
    labels: "Etiquetas",
    assignee: "Asignada a",
    unassigned: "Sin asignar",
    reporter: "Reportada por",
    createdAfter: "Creada desde",
    createdBefore: "Creada hasta",
    updatedAfter: "Modificada desde",
    updatedBefore: "Modificada hasta",
    dueAfter: "Vence desde",
    dueBefore: "Vence hasta",
    hasDueDate: "Con fecha límite",
    sortBy: "Ordenado por",
    sortOrder: "Sentido",
  }

  const applied: Record<string, string> = {}
  for (const [key, label] of Object.entries(labels)) {
    const value = input[key]
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      if (value.length === 0) continue
      applied[label] = value.join(", ")
    } else if (typeof value === "boolean") {
      applied[label] = value ? "sí" : "no"
    } else {
      applied[label] = String(value)
    }
  }

  if (Object.keys(applied).length === 0) {
    applied["Filtro"] = "ninguno (todas las incidencias del proyecto)"
  }
  return applied
}

function issuesTable(list: issues.IssueListItemDTO[]) {
  return mdTable(
    ["#", "Título", "Estado", "Tipo", "Módulo", "Prioridad", "Etiquetas", "Vence"],
    list.map((issue) => [
      issue.number,
      issue.title,
      issue.status ? `${issue.status.name} (${issue.status.category})` : null,
      issue.type?.name,
      issue.module?.name,
      issue.priority,
      issue.labels.map((label) => label.name).join(", "),
      issue.dueDate,
    ]),
    "No hay incidencias que cumplan el filtro"
  )
}

function issueMarkdown(
  issue: issues.IssueDetailDTO,
  parts: Set<string> = new Set(["comments", "activity", "attachments"])
) {
  return mdJoin(
    `# #${issue.number} — ${issue.title}`,
    mdFields([
      ["Estado", issue.status ? `${issue.status.name} (${issue.status.category})` : null],
      ["Tipo", issue.type?.name],
      ["Módulo", issue.module?.name],
      ["Subproyecto", issue.subproject?.name],
      ["Prioridad", issue.priority],
      ["Asignada a", issue.assigneeId],
      ["Reportada por", issue.reporterId],
      ["Etiquetas", issue.labels.map((label) => label.name).join(", ")],
      ["Vence", issue.dueDate],
      ["Creada", issue.createdAt],
      ["Actualizada", issue.updatedAt],
    ]),
    mdSection("Descripción", mdBlock(issue.description, "Sin describir")),
    mdSection("Pasos para reproducir", mdBlock(issue.stepsToReproduce, "Sin pasos documentados")),
    mdSection("Lógica de negocio", mdBlock(issue.businessLogic, "Sin documentar")),
    mdSection("Solución aplicada", mdBlock(issue.resolutionNotes, "Sin documentar")),
    parts.has("comments")
      ? mdSection(
          "Comentarios",
          issue.comments.length > 0
            ? issue.comments
                .map(
                  (comment) => `- **${comment.createdAt}** — ${comment.body.replace(/\r?\n/g, " ")}`
                )
                .join("\n")
            : mdEmpty("Sin comentarios")
        )
      : null,
    parts.has("attachments")
      ? mdSection(
          "Adjuntos",
          mdTable(
            ["Archivo", "Tipo", "Tamaño", "URL"],
            issue.attachments.map((attachment) => [
              attachment.filename,
              attachment.mimeType,
              attachment.size,
              attachment.url,
            ]),
            "Sin adjuntos"
          )
        )
      : null,
    parts.has("activity")
      ? mdSection(
          "Historial",
          mdTable(
            ["Fecha", "Acción", "De", "A"],
            issue.activity.map((entry) => [
              entry.createdAt,
              entry.action,
              entry.fromValue,
              entry.toValue,
            ]),
            "Sin actividad registrada"
          )
        )
      : null
  )
}

export function registerIssueTools(server: McpServer) {
  server.registerTool(
    "list_issues",
    {
      title: "Listar y buscar incidencias",
      description:
        "Lista las incidencias (issues) de un proyecto y las filtra. Se puede buscar por palabra clave en el texto (`query`), por estado, tipo, prioridad, etiquetas, persona asignada, autor que la reportó, y por rangos de fecha de creación, actualización o vencimiento. Todos los filtros se combinan con Y. Devuelve como máximo 50 por página salvo que pidas otro `limit`, y siempre el total de coincidencias para saber si hay que paginar.",
      inputSchema: {
        workspaceSlug: z.string(),
        projectKey: z.string(),
        query: z
          .string()
          .optional()
          .describe(
            "Palabra o frase a buscar en el texto de la incidencia. No distingue mayúsculas; es una coincidencia de subcadena, y `%` funciona como comodín ('pago%caja'). Por defecto busca en título, descripción, pasos, lógica de negocio y solución"
          ),
        searchIn: z
          .array(
            z.enum(["title", "description", "stepsToReproduce", "businessLogic", "resolutionNotes"])
          )
          .optional()
          .describe("Campos donde buscar `query`. Por defecto, todos"),
        status: z
          .array(z.string())
          .optional()
          .describe(
            "Estados por nombre ('QA'), por categoría ('todo', 'done', ...) o por id. Una categoría incluye todos sus estados. Varios valores suman resultados"
          ),
        statusCategory: z
          .enum(["backlog", "todo", "in_progress", "done", "cancelled"])
          .optional()
          .describe("Atajo para filtrar por una única categoría de estado"),
        type: z
          .array(z.string())
          .optional()
          .describe("Tipos de incidencia por nombre ('Bug') o por id. Varios valores suman resultados"),
        priority: z
          .array(z.enum(["none", "low", "medium", "high", "urgent"]))
          .optional()
          .describe("Prioridades a incluir"),
        labels: z
          .array(z.string())
          .optional()
          .describe("Etiquetas por nombre o id. Devuelve las incidencias que tengan AL MENOS una"),
        module: z
          .array(z.string())
          .optional()
          .describe("Módulos del sistema por nombre o id"),
        withoutModule: z
          .boolean()
          .optional()
          .describe("true para traer solo las que no tienen módulo. Ignora `module`"),
        subproject: z
          .string()
          .optional()
          .describe(
            "Limita a un tablero del proyecto agrupador, por nombre o id. Si se omite se listan todos los que puedes ver"
          ),
        assignee: z
          .string()
          .optional()
          .describe("Persona asignada, por correo, nombre completo, userId o 'me' para ti"),
        unassigned: z
          .boolean()
          .optional()
          .describe("true para traer solo las que no tienen a nadie asignado. Ignora `assignee`"),
        reporter: z
          .string()
          .optional()
          .describe("Autor que reportó la incidencia, por correo, nombre completo, userId o 'me'"),
        createdAfter: z
          .string()
          .optional()
          .describe("Creadas desde esta fecha, inclusive (YYYY-MM-DD o fecha-hora ISO, en UTC)"),
        createdBefore: z
          .string()
          .optional()
          .describe("Creadas hasta esta fecha, inclusive (una fecha suelta cubre el día entero)"),
        updatedAfter: z.string().optional().describe("Modificadas desde esta fecha, inclusive"),
        updatedBefore: z.string().optional().describe("Modificadas hasta esta fecha, inclusive"),
        dueAfter: z.string().optional().describe("Con fecha límite desde esta fecha, inclusive"),
        dueBefore: z
          .string()
          .optional()
          .describe(
            "Con fecha límite hasta esta fecha, inclusive. Para las vencidas, pasa la fecha de hoy"
          ),
        hasDueDate: z
          .boolean()
          .optional()
          .describe("true: solo las que tienen fecha límite; false: solo las que no la tienen"),
        sortBy: z
          .enum(["number", "createdAt", "updatedAt", "dueDate"])
          .optional()
          .describe("Campo de ordenación (default 'number')"),
        sortOrder: z
          .enum(["asc", "desc"])
          .optional()
          .describe("Sentido de la ordenación (default 'desc', las más recientes primero)"),
        limit: z
          .number()
          .int()
          .positive()
          .max(200)
          .optional()
          .describe("Máximo de resultados (default 50, tope 200)"),
        offset: z.number().int().min(0).optional().describe("Cuántos resultados saltar, para paginar"),
        format: formatArg,
      },
      outputSchema: {
        issues: z.array(IssueListItemSchema),
        total: z.number().describe("Coincidencias totales del filtro, más allá de esta página"),
        appliedFilters: z.record(z.string(), z.string()).describe("Filtros efectivamente aplicados"),
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

        const [statusIds, typeIds, moduleIds, subprojectId, labelIds, assigneeId, reporterId] =
          await Promise.all([
          input.status?.length
            ? resolveStatusIdsForFilter(client, project.id, input.status)
            : undefined,
          input.type?.length ? resolveTypeIdsForFilter(client, project.id, input.type) : undefined,
          input.module?.length
            ? resolveModuleIdsForFilter(client, project.id, input.module)
            : undefined,
          input.subproject
            ? resolveSubproject(client, project.id, input.subproject).then((s) => s.id)
            : undefined,
          input.labels?.length
            ? resolveLabelIds(client, project.id, input.labels, false)
            : undefined,
          input.assignee && !input.unassigned
            ? resolvePersonId(client, workspace.id, input.assignee, userId)
            : undefined,
          input.reporter ? resolvePersonId(client, workspace.id, input.reporter, userId) : undefined,
        ])

        const { items, total } = await issues.listIssuesForProject(client, project.id, {
          query: input.query,
          searchIn: input.searchIn,
          statusCategory: input.statusCategory,
          statusIds,
          typeIds,
          moduleIds,
          withoutModule: input.withoutModule,
          subprojectId,
          labelIds,
          assigneeId,
          unassigned: input.unassigned,
          reporterId,
          priorities: input.priority,
          createdAfter: input.createdAfter,
          createdBefore: input.createdBefore,
          updatedAfter: input.updatedAfter,
          updatedBefore: input.updatedBefore,
          dueAfter: input.dueAfter,
          dueBefore: input.dueBefore,
          hasDueDate: input.hasDueDate,
          sortBy: input.sortBy,
          sortOrder: input.sortOrder,
          limit: input.limit,
          offset: input.offset,
        })

        const offset = input.offset ?? 0
        const appliedFilters = describeFilters(input)

        return ok(
          { issues: items, total, appliedFilters },
          {
            format: input.format,
            markdown: (data) =>
              mdJoin(
                `# Incidencias de ${input.projectKey}`,
                mdFields([
                  ...Object.entries(data.appliedFilters),
                  [
                    "Resultados",
                    `${data.issues.length} de ${data.total}${offset > 0 ? ` (desde el ${offset + 1})` : ""}`,
                  ],
                ]),
                issuesTable(data.issues),
                data.total > offset + data.issues.length
                  ? `_Quedan ${data.total - offset - data.issues.length} más: repite con offset:${offset + data.issues.length}._`
                  : null
              ),
          }
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
        "Obtiene una incidencia por su número: descripción, pasos para reproducir, lógica documentada, solución aplicada, estado, tipo y etiquetas. Los comentarios, el historial de actividad y los adjuntos solo se traen si los pides con `include`, para no llenar la respuesta de material que casi nunca se usa.",
      inputSchema: {
        workspaceSlug: z.string(),
        projectKey: z.string(),
        issueNumber: z.number().int().positive(),
        include: z
          .array(z.enum(["comments", "activity", "attachments"]))
          .optional()
          .describe(
            "Partes adicionales a incluir. Por defecto no se incluye ninguna: pide solo la que vayas a usar"
          ),
        historyLimit: z
          .number()
          .int()
          .positive()
          .max(100)
          .optional()
          .describe("Máximo de comentarios y entradas de historial, los más recientes (default 20)"),
        format: formatArg,
      },
      outputSchema: { issue: IssueDetailSchema },
    },
    async ({ workspaceSlug, projectKey, issueNumber, include, historyLimit, format }) => {
      try {
        const { client } = await getUserClient()
        const { project } = await resolveProject(client, workspaceSlug, projectKey)
        const parts = new Set(include ?? [])
        const issue = await issues.getIssueByNumber(client, project.id, issueNumber, {
          includeComments: parts.has("comments"),
          includeActivity: parts.has("activity"),
          includeAttachments: parts.has("attachments"),
          historyLimit,
        })
        if (!issue) {
          return fail(new Error(`No se encontró la incidencia #${issueNumber} en ${projectKey}`))
        }
        return ok(
          { issue },
          { format, markdown: (data) => issueMarkdown(data.issue, parts) }
        )
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
        "Crea una incidencia. SOLO se llama cuando la persona usuaria pide crear una incidencia: no abras incidencias por iniciativa propia por algo que hayas visto de paso, ni desdobles una petición en varias sin que te lo pidan. Si detectas algo que merece una incidencia, dilo y espera a que te lo confirmen. `description` es obligatoria y se rechaza si trae rutas de archivo, código o commits: eso va en `resolutionNotes`. Los campos `type`, `status`, `module`, `subproject`, `assignee` y `labels` aceptan nombres además de ids. Si el proyecto es una AGRUPACIÓN, `subproject` es obligatorio: consulta list_project_metadata.",
      inputSchema: {
        workspaceSlug: z.string(),
        projectKey: z.string(),
        title: z.string().min(1),
        description: descriptionField.optional(),
        stepsToReproduce: stepsField.optional(),
        businessLogic: businessLogicField.optional(),
        resolutionNotes: resolutionField.optional(),
        type: typeRef.optional(),
        module: z
          .string()
          .optional()
          .describe("Módulo del sistema al que pertenece, por nombre o id"),
        subproject: z
          .string()
          .optional()
          .describe(
            "Subproyecto (tablero) al que va la incidencia. Obligatorio si el proyecto es una agrupación."
          ),
        status: statusRef.optional().describe("Si se omite, se usa el primer estado del flujo"),
        priority: priority.optional(),
        assignee: assigneeRef.optional(),
        labels: labelsRef.optional(),
        createMissingLabels: z
          .boolean()
          .optional()
          .describe("Crea las etiquetas que no existan en vez de fallar (default false)"),
        dueDate: z.string().optional().describe("Fecha ISO (YYYY-MM-DD)"),
        createdAt: z
          .string()
          .optional()
          .describe(
            "Fecha de creación a fijar (YYYY-MM-DD o fecha-hora ISO), por ejemplo para migrar datos históricos. Por defecto, ahora"
          ),
        allowDuplicate: z
          .boolean()
          .optional()
          .describe(
            "Crea la incidencia aunque ya exista otra con el mismo título. Úsalo solo si la persona usuaria confirma que efectivamente son dos incidencias distintas"
          ),
        format: formatArg,
      },
      outputSchema: {
        issue: IssueDetailSchema,
        warnings: z.array(z.string()).describe("Avisos sobre la documentación de la incidencia"),
      },
    },
    async (input) => {
      try {
        requireDescriptionOnCreate(input.description)
        const warnings = validateIssueText(textPatch(input))

        const { client, userId } = await getUserClient()
        const { workspace, project } = await resolveProject(
          client,
          input.workspaceSlug,
          input.projectKey
        )

        if (!input.allowDuplicate) {
          const target = normalizeTitle(input.title)
          const duplicates = (
            await issues.findIssuesByTitle(client, project.id, input.title)
          ).filter((candidate) => normalizeTitle(candidate.title) === target)

          if (duplicates.length > 0) {
            return fail(
              new Error(
                `Ya existe una incidencia con ese título en ${input.projectKey}: ${duplicates
                  .map((duplicate) => `#${duplicate.number}`)
                  .join(", ")}. Actualízala con update_issue en vez de duplicarla. ` +
                  "Si de verdad son incidencias distintas, repite con allowDuplicate:true."
              )
            )
          }
        }

        const [statusId, typeId, moduleId, subprojectId, assigneeId, labelIds] = await Promise.all([
          input.status ? resolveStatusId(client, project.id, input.status) : undefined,
          input.type ? resolveTypeId(client, project.id, input.type) : undefined,
          input.module ? resolveModuleId(client, project.id, input.module) : undefined,
          requireSubprojectForIssue(client, project, input.subproject),
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
          moduleId,
          subprojectId,
          priority: input.priority,
          assigneeId,
          labelIds,
          dueDate: input.dueDate,
          reporterId: userId,
          createdAt: input.createdAt,
        })
        return ok(
          { issue, warnings },
          {
            format: input.format,
            markdown: (data) =>
              mdJoin(issueMarkdown(data.issue, new Set()), warningsMarkdown(data.warnings)),
          }
        )
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
        "Actualiza cualquier campo de una incidencia existente: título, descripción, pasos para reproducir, lógica de negocio, solución aplicada, tipo, módulo, subproyecto, estado, prioridad, persona asignada, etiquetas, fecha límite, fecha de creación (`createdAt`) y fecha de última actualización (`updatedAt`, para migraciones o correcciones, o para fijar la fecha real en la que se completó/verificó/resolvió una incidencia al cerrarla). Usa `resolutionNotes` para documentar el arreglo cuando cierres una incidencia. Solo se modifican los campos que envíes. Los cambios de estado, prioridad y asignación quedan registrados en el historial de actividad.",
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
        module: z
          .string()
          .nullable()
          .optional()
          .describe("Módulo del sistema, por nombre o id. null para quitarlo"),
        subproject: z
          .string()
          .optional()
          .describe("Mueve la incidencia a otro tablero del proyecto agrupador"),
        status: statusRef.optional(),
        priority: priority.optional(),
        assignee: assigneeRef.nullable().optional().describe("null para desasignar"),
        labels: labelsRef.optional().describe("Reemplaza todas las etiquetas. [] las quita todas"),
        createMissingLabels: z.boolean().optional(),
        dueDate: z.string().nullable().optional().describe("Fecha ISO o null para quitarla"),
        createdAt: z
          .string()
          .optional()
          .describe(
            "Corrige la fecha de creación de la incidencia (YYYY-MM-DD o fecha-hora ISO). Úsalo solo para migraciones o correcciones puntuales, no como flujo normal"
          ),
        updatedAt: z
          .string()
          .optional()
          .describe(
            "Corrige la fecha de última actualización (YYYY-MM-DD o fecha-hora ISO). Útil para fijar la fecha real en la que se completó, verificó o resolvió la incidencia cuando se está cerrando (junto con `status`). Úsalo solo para migraciones o correcciones puntuales, no como flujo normal: si se omite, queda la fecha/hora en la que se hizo este cambio"
          ),
        forceClose: z
          .boolean()
          .optional()
          .describe(
            "Cierra la incidencia aunque falte documentación. Úsalo solo si la persona usuaria lo pide explícitamente, y dile qué queda sin documentar"
          ),
        format: formatArg,
      },
      outputSchema: {
        issue: IssueDetailSchema,
        warnings: z.array(z.string()).describe("Avisos sobre la documentación de la incidencia"),
      },
    },
    async (input) => {
      try {
        const warnings = validateIssueText(textPatch(input))

        const { client, userId } = await getUserClient()
        const { workspace, project } = await resolveProject(
          client,
          input.workspaceSlug,
          input.projectKey
        )
        const ref = await issues.findIssueRef(client, project.id, input.issueNumber)
        if (!ref) {
          return fail(
            new Error(`No se encontró la incidencia #${input.issueNumber} en ${input.projectKey}`)
          )
        }

        const [status, typeId, moduleId, subprojectId, assigneeId] = await Promise.all([
          input.status ? resolveStatus(client, project.id, input.status) : undefined,
          input.type ? resolveTypeId(client, project.id, input.type) : undefined,
          input.module === undefined || input.module === null
            ? (input.module as null | undefined)
            : resolveModuleId(client, project.id, input.module),
          input.subproject
            ? resolveSubproject(client, project.id, input.subproject).then((sub) => sub.id)
            : undefined,
          input.assignee === undefined || input.assignee === null
            ? (input.assignee as null | undefined)
            : resolveAssigneeId(client, workspace.id, input.assignee),
        ])
        const statusId = status?.id

        if (status?.category === "done" && !input.forceClose) {
          const current = await issues.getIssueByNumber(client, project.id, input.issueNumber)
          const missing = current ? missingDocumentation(current, input) : []
          if (missing.length > 0) {
            return fail(
              new Error(
                `No se cerró la incidencia #${ref.number}: una incidencia no se finaliza hasta que está documentada. Falta ${missing.join(", ")}. ` +
                  "Complétalo con update_issue y vuelve a mover el estado. " +
                  "Si la persona usuaria pide cerrarla igual, repite la llamada con forceClose:true."
              )
            )
          }
        }

        await issues.updateIssue(client, ref.id, userId, {
          title: input.title,
          description: input.description,
          stepsToReproduce: input.stepsToReproduce,
          businessLogic: input.businessLogic,
          resolutionNotes: input.resolutionNotes,
          statusId,
          typeId,
          moduleId,
          subprojectId,
          priority: input.priority,
          assigneeId,
          dueDate: input.dueDate,
          createdAt: input.createdAt,
          updatedAt: input.updatedAt,
        })

        if (input.labels) {
          const labelIds = await resolveLabelIds(
            client,
            project.id,
            input.labels,
            input.createMissingLabels ?? false
          )
          await issues.setIssueLabels(client, ref.id, labelIds)
        }

        const updated = await issues.getIssueByNumber(client, project.id, input.issueNumber)
        if (!updated) {
          return fail(
            new Error(`No se pudo releer la incidencia #${input.issueNumber} tras actualizarla`)
          )
        }
        return ok(
          { issue: updated, warnings },
          {
            format: input.format,
            markdown: (data) =>
              mdJoin(issueMarkdown(data.issue, new Set()), warningsMarkdown(data.warnings)),
          }
        )
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    "add_issue_comment",
    {
      title: "Comentar incidencia",
      description:
        "Agrega un comentario a una incidencia existente. SOLO se llama cuando la persona usuaria pide explícitamente que se comente: no dejes comentarios por iniciativa propia para narrar tu avance o resumir lo que hiciste. Esa información va en `resolutionNotes` con update_issue.",
      inputSchema: {
        workspaceSlug: z.string(),
        projectKey: z.string(),
        issueNumber: z.number().int().positive(),
        body: z.string().min(1),
        format: formatArg,
      },
      outputSchema: { comment: CommentSchema },
    },
    async ({ workspaceSlug, projectKey, issueNumber, body, format }) => {
      try {
        const { client, userId } = await getUserClient()
        const { project } = await resolveProject(client, workspaceSlug, projectKey)
        const issue = await issues.findIssueRef(client, project.id, issueNumber)
        if (!issue) {
          return fail(new Error(`No se encontró la incidencia #${issueNumber} en ${projectKey}`))
        }
        const comment = await issues.createComment(client, {
          issueId: issue.id,
          authorId: userId,
          body,
        })
        return ok(
          { comment },
          {
            format,
            markdown: (data) =>
              mdSection(
                `Comentario agregado a #${issueNumber}`,
                mdJoin(
                  mdFields([
                    ["Fecha", data.comment.createdAt],
                    ["Id", data.comment.id],
                  ]),
                  data.comment.body
                ),
                1
              ),
          }
        )
      } catch (err) {
        return fail(err)
      }
    }
  )
}
