import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import { getUserClient } from "../auth/supabase-client.js"
import { webAppUrl } from "../config/web-env.js"
import * as architecture from "../repositories/architecture.js"
import { resolveProject } from "./resolve-project.js"
import { parseSpec, type ArchitectureSpec } from "./architecture-spec.js"
import {
  renderArchitectureSkill,
  SKILL_DIRECTORY,
  SKILL_FILENAME,
} from "../skill/architecture-skill.js"
import { formatArg, mdBlock, mdFields, mdJoin, mdSection, mdTable, ok, fail } from "./response.js"

const RulesSchema = z.object({
  ignoreGlobs: z.array(z.string()),
  focusGlobs: z.array(z.string()),
  notes: z.string(),
  updatedAt: z.string().nullable(),
})

const ArchitectureSummarySchema = z.object({
  projectId: z.string(),
  title: z.string(),
  summary: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  sourceBranch: z.string().nullable(),
  sourceRevision: z.string().nullable(),
  archifyVersion: z.string().nullable(),
  componentCount: z.number(),
  connectionCount: z.number(),
  generatedAt: z.string(),
})

function rulesMarkdown(rules: architecture.ArchitectureRulesDTO) {
  return mdJoin(
    mdSection(
      "Rutas a ignorar",
      rules.ignoreGlobs.length > 0
        ? rules.ignoreGlobs.map((glob) => `- \`${glob}\``).join("\n")
        : "El equipo no marcó rutas a ignorar"
    ),
    mdSection(
      "Rutas a priorizar",
      rules.focusGlobs.length > 0
        ? rules.focusGlobs.map((glob) => `- \`${glob}\``).join("\n")
        : "El equipo no marcó rutas prioritarias"
    ),
    mdSection("Instrucciones del equipo", mdBlock(rules.notes, "Sin instrucciones adicionales"))
  )
}

function specMarkdown(spec: ArchitectureSpec) {
  const components = mdTable(
    ["Id", "Tipo", "Nombre", "Detalle", "Evidencia"],
    spec.components.map((component) => [
      component.id,
      component.type,
      component.label,
      component.sublabel ?? component.tag ?? null,
      (component.sources ?? [])
        .map((source) => `${source.path}${source.line ? `:${source.line}` : ""}`)
        .join(", "),
    ]),
    "El diagrama no tiene componentes"
  )

  const connections = mdTable(
    ["Origen", "Destino", "Relación", "Variante"],
    (spec.connections ?? []).map((connection) => [
      connection.from,
      connection.to,
      connection.label ?? null,
      connection.variant ?? "default",
    ]),
    "El diagrama no tiene relaciones"
  )

  const boundaries = mdTable(
    ["Tipo", "Nombre", "Contiene"],
    (spec.boundaries ?? []).map((boundary) => [
      boundary.kind,
      boundary.label,
      boundary.wraps.join(", "),
    ]),
    "El diagrama no tiene límites"
  )

  const cards = (spec.cards ?? [])
    .map((card) => mdSection(card.title, card.items.map((item) => `- ${item}`).join("\n"), 3))
    .join("\n\n")

  return mdJoin(
    mdSection("Componentes", components),
    mdSection("Relaciones", connections),
    mdSection("Límites", boundaries),
    cards ? mdSection("Conclusiones", cards) : null
  )
}

export function registerArchitectureTools(server: McpServer) {
  server.registerTool(
    "get_architecture_rules",
    {
      title: "Restricciones de la arquitectura",
      description:
        "Devuelve las restricciones que el equipo definió en my-tracker para el diagrama de arquitectura de un proyecto: rutas a ignorar, rutas a priorizar e instrucciones en lenguaje natural. Llamala SIEMPRE antes de recorrer el repositorio para generar o regenerar la arquitectura, y respetá lo que devuelva: lo ignorado no debe aparecer en el diagrama ni en el análisis.",
      inputSchema: {
        workspaceSlug: z.string(),
        projectKey: z.string(),
        format: formatArg,
      },
      outputSchema: { rules: RulesSchema },
    },
    async ({ workspaceSlug, projectKey, format }) => {
      try {
        const { client } = await getUserClient()
        const { project } = await resolveProject(client, workspaceSlug, projectKey)
        const rules = await architecture.getArchitectureRules(client, project.id)

        return ok(
          { rules },
          {
            format,
            markdown: (data) =>
              mdSection(`Restricciones de ${projectKey}`, rulesMarkdown(data.rules), 1),
          }
        )
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    "get_project_architecture",
    {
      title: "Obtener la arquitectura del proyecto",
      description:
        "Devuelve el mapa de arquitectura publicado de un proyecto: componentes, relaciones, límites y conclusiones, con la revisión de git desde la que se generó. Úsala para entender el sistema antes de trabajar en una incidencia, en vez de recorrer el repositorio entero.",
      inputSchema: {
        workspaceSlug: z.string(),
        projectKey: z.string(),
        includeSpec: z
          .boolean()
          .optional()
          .describe(
            "Si es true, incluye además la especificación JSON completa. Por defecto false: el resumen ya trae componentes y relaciones"
          ),
        format: formatArg,
      },
      outputSchema: {
        architecture: ArchitectureSummarySchema.nullable(),
        spec: z.record(z.string(), z.unknown()).optional(),
      },
    },
    async ({ workspaceSlug, projectKey, includeSpec, format }) => {
      try {
        const { client } = await getUserClient()
        const { project } = await resolveProject(client, workspaceSlug, projectKey)
        const record = await architecture.getArchitecture(client, project.id)

        if (!record) {
          return ok(
            { architecture: null },
            {
              format,
              markdown: () =>
                `El proyecto ${projectKey} todavía no tiene arquitectura publicada. Generala con el skill archify y publicala con \`publish_project_architecture\`.`,
            }
          )
        }

        const summary = {
          projectId: record.projectId,
          title: record.title,
          summary: record.summary,
          sourceUrl: record.sourceUrl,
          sourceBranch: record.sourceBranch,
          sourceRevision: record.sourceRevision,
          archifyVersion: record.archifyVersion,
          componentCount: record.componentCount,
          connectionCount: record.connectionCount,
          generatedAt: record.generatedAt,
        }

        const parsed = architectureSpecOrNull(record.spec)
        const payload = includeSpec
          ? { architecture: summary, spec: record.spec as Record<string, unknown> }
          : { architecture: summary }

        return ok(payload, {
            format,
            markdown: () =>
              mdJoin(
                mdSection(`Arquitectura de ${projectKey}`, `# ${record.title}`, 1),
                mdFields([
                  ["Resumen", record.summary],
                  ["Repositorio", record.sourceUrl],
                  ["Rama", record.sourceBranch],
                  ["Revisión", record.sourceRevision],
                  ["Componentes", record.componentCount],
                  ["Relaciones", record.connectionCount],
                  ["Generada", record.generatedAt],
                ]),
                parsed ? specMarkdown(parsed) : "La especificación guardada no se pudo interpretar."
              ),
        })
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    "get_architecture_skill",
    {
      title: "Skill de arquitectura del proyecto",
      description:
        "Devuelve el contenido del skill `tracker-architecture` ya apuntando a este proyecto, y la ruta donde va dentro del repositorio. Úsala cuando pidan instalar, incluir o actualizar el skill de arquitectura en un repositorio: escribí el contenido tal cual en la ruta que indica y avisá que hay que reiniciar la sesión del agente para que lo cargue.",
      inputSchema: {
        workspaceSlug: z.string(),
        projectKey: z.string(),
        format: formatArg,
      },
      outputSchema: {
        path: z.string(),
        content: z.string(),
      },
    },
    async ({ workspaceSlug, projectKey, format }) => {
      try {
        const { client } = await getUserClient()
        const { workspace, project } = await resolveProject(client, workspaceSlug, projectKey)
        const rules = await architecture.getArchitectureRules(client, project.id)

        const content = renderArchitectureSkill({
          workspaceSlug: workspace.slug,
          projectKey: project.key,
          projectName: project.name,
          webUrl: webAppUrl,
          ignoreGlobs: rules.ignoreGlobs,
          focusGlobs: rules.focusGlobs,
          notes: rules.notes,
        })

        return ok(
          { path: `${SKILL_DIRECTORY}/${SKILL_FILENAME}`, content },
          {
            format,
            markdown: (data) =>
              mdJoin(
                mdSection(
                  `Skill de arquitectura de ${project.key}`,
                  `Escribí este contenido en \`${data.path}\` dentro del repositorio y reiniciá la sesión del agente.`,
                  1
                ),
                "```markdown",
                data.content,
                "```"
              ),
          }
        )
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    "publish_project_architecture",
    {
      title: "Publicar la arquitectura del proyecto",
      description:
        "Publica en my-tracker el diagrama de arquitectura de un proyecto y reemplaza el anterior. Recibe una especificación JSON de tipo `architecture` de archify, ya validada con `node bin/archify.mjs validate architecture <spec>.json --quality showcase --json`. Antes de generarla, leé `get_architecture_rules` y respetá las restricciones del equipo. No la llames por iniciativa propia: solo cuando te pidan generar o actualizar la arquitectura.",
      inputSchema: {
        workspaceSlug: z.string(),
        projectKey: z.string(),
        spec: z
          .union([z.string(), z.record(z.string(), z.unknown())])
          .describe(
            "La especificación de archify, como objeto JSON o como el texto del archivo .json validado"
          ),
        summary: z
          .string()
          .max(600)
          .optional()
          .describe("Una o dos frases sobre qué muestra el diagrama y qué quedó fuera"),
        sourceUrl: z
          .string()
          .url()
          .optional()
          .describe("URL del repositorio del que se generó, por ejemplo el de GitHub"),
        sourceBranch: z.string().max(120).optional().describe("Rama desde la que se generó"),
        sourceRevision: z
          .string()
          .regex(/^[a-fA-F0-9]{7,40}$/)
          .optional()
          .describe("Commit exacto desde el que se generó (`git rev-parse HEAD`)"),
        archifyVersion: z.string().max(20).optional().describe("Versión del skill archify usada"),
        format: formatArg,
      },
      outputSchema: { architecture: ArchitectureSummarySchema },
    },
    async ({
      workspaceSlug,
      projectKey,
      spec,
      summary,
      sourceUrl,
      sourceBranch,
      sourceRevision,
      archifyVersion,
      format,
    }) => {
      try {
        const { client, userId } = await getUserClient()
        const { project } = await resolveProject(client, workspaceSlug, projectKey)
        const { spec: parsed, raw } = parseSpec(spec)

        const record = await architecture.publishArchitecture(client, {
          projectId: project.id,
          userId,
          title: parsed.meta.title,
          summary,
          spec: raw,
          sourceUrl: sourceUrl ?? parsed.meta.repository?.url,
          sourceBranch,
          sourceRevision: sourceRevision ?? parsed.meta.repository?.revision,
          archifyVersion,
          componentCount: parsed.components.length,
          connectionCount: (parsed.connections ?? []).length,
        })

        return ok(
          {
            architecture: {
              projectId: record.projectId,
              title: record.title,
              summary: record.summary,
              sourceUrl: record.sourceUrl,
              sourceBranch: record.sourceBranch,
              sourceRevision: record.sourceRevision,
              archifyVersion: record.archifyVersion,
              componentCount: record.componentCount,
              connectionCount: record.connectionCount,
              generatedAt: record.generatedAt,
            },
          },
          {
            format,
            markdown: (data) =>
              mdSection(
                `Arquitectura publicada en ${projectKey}`,
                mdFields([
                  ["Título", data.architecture.title],
                  ["Componentes", data.architecture.componentCount],
                  ["Relaciones", data.architecture.connectionCount],
                  ["Revisión", data.architecture.sourceRevision],
                  ["Publicada", data.architecture.generatedAt],
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
}

function architectureSpecOrNull(value: unknown): ArchitectureSpec | null {
  try {
    return parseSpec(value).spec
  } catch {
    return null
  }
}
