import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import { getUserClient } from "../auth/supabase-client.js"
import * as workspaces from "../repositories/workspaces.js"
import * as projects from "../repositories/projects.js"
import { resolveProject } from "./resolve-project.js"
import { resolveModuleId, resolveStatus, resolveTypeId } from "./resolve-refs.js"
import {
  formatArg,
  mdFields,
  mdJoin,
  mdSection,
  mdTable,
  ok,
  fail,
} from "./response.js"
import {
  IssueModuleSchema,
  IssueStatusSchema,
  IssueTypeSchema,
  LabelSchema,
  SubprojectSchema,
  MemberSchema,
  OptionSchema,
  ProjectSchema,
  WorkspaceSchema,
} from "./schemas.js"

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

const statusCategory = z
  .enum(["backlog", "todo", "in_progress", "done", "cancelled"])
  .describe(
    "Categoría del estado, que es lo que da su significado al flujo: 'backlog', 'todo', 'in_progress', 'done' o 'cancelled'. Las incidencias en un estado de categoría 'done' se consideran cerradas"
  )

const colorArg = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "El color debe ser hexadecimal, por ejemplo '#ef4444'")
  .describe("Color hexadecimal con el que se pinta en la aplicación, por ejemplo '#ef4444'")

/* ------------------------------------------------------------------ *
 * Renderizadores Markdown
 * ------------------------------------------------------------------ */

function typesTable(types: projects.IssueTypeOption[]) {
  return mdTable(
    ["Nombre", "Color", "Icono", "Id"],
    types.map((type) => [type.name, type.color, type.icon, type.id]),
    "Este proyecto no tiene tipos de incidencia"
  )
}

function statusesTable(statuses: projects.IssueStatusOption[]) {
  return mdTable(
    ["#", "Nombre", "Categoría", "Color", "Id"],
    statuses.map((status) => [
      status.position,
      status.name,
      status.category,
      status.color,
      status.id,
    ]),
    "Este proyecto no tiene estados"
  )
}

function membersTable(members: projects.WorkspaceMemberOption[]) {
  return mdTable(
    ["Nombre", "Correo", "Rol", "userId"],
    members.map((member) => [member.fullName, member.email, member.role, member.userId]),
    "El workspace no tiene miembros activos"
  )
}

function typeCard(type: projects.IssueTypeOption, title: string) {
  return mdSection(
    title,
    mdFields([
      ["Nombre", type.name],
      ["Color", type.color],
      ["Icono", type.icon],
      ["Id", type.id],
    ])
  )
}

function statusCard(status: projects.IssueStatusOption, title: string) {
  return mdSection(
    title,
    mdFields([
      ["Nombre", status.name],
      ["Categoría", status.category],
      ["Posición", status.position],
      ["Color", status.color],
      ["Id", status.id],
    ])
  )
}

function moduleCard(module: projects.IssueModuleOption, title: string) {
  return mdSection(
    title,
    mdFields([
      ["Nombre", module.name],
      ["Descripción", module.description],
      ["Color", module.color],
      ["Id", module.id],
    ])
  )
}

export function registerProjectTools(server: McpServer) {
  server.registerTool(
    "list_projects",
    {
      title: "Listar proyectos",
      description: "Lista los proyectos de un workspace, identificado por su slug.",
      inputSchema: {
        workspaceSlug: z.string().describe("Slug del workspace, por ejemplo 'personal-ab12cd34'"),
        format: formatArg,
      },
      outputSchema: { projects: z.array(ProjectSchema) },
    },
    async ({ workspaceSlug, format }) => {
      try {
        const { client } = await getUserClient()
        const workspace = await workspaces.getWorkspaceBySlug(client, workspaceSlug)
        if (!workspace) {
          return fail(new Error(`No se encontró (o no tenés acceso a) el workspace "${workspaceSlug}"`))
        }
        const list = await projects.listProjectsForWorkspace(client, workspace.id)
        return ok(
          { projects: list },
          {
            format,
            markdown: (data) =>
              mdSection(
                `Proyectos de ${workspace.name}`,
                mdTable(
                  ["Clave", "Nombre", "Descripción", "Archivado"],
                  data.projects.map((project) => [
                    project.key,
                    project.name,
                    project.description,
                    project.archived ? "sí" : "no",
                  ]),
                  "Este workspace no tiene proyectos"
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

  server.registerTool(
    "create_project",
    {
      title: "Crear proyecto",
      description:
        "Crea un proyecto en un workspace, identificado por una clave corta única (por ejemplo 'ENG'). SOLO se llama cuando la persona usuaria pide crear un proyecto: un proyecto lo ve todo el workspace y no se borra desde aquí. Opcionalmente permite fijar `createdAt` (por ejemplo para migrar datos históricos); si se omite, se usa la fecha actual.",
      inputSchema: {
        workspaceSlug: z.string(),
        key: z
          .string()
          .min(1)
          .describe("Clave corta y única del proyecto dentro del workspace, por ejemplo 'ENG'"),
        name: z.string().min(1).describe("Nombre visible del proyecto"),
        description: z.string().optional().describe("Descripción del proyecto"),
        color: colorArg.optional().describe("Color hexadecimal (default '#6366f1')"),
        isGroup: z
          .boolean()
          .optional()
          .describe(
            "true si es un proyecto AGRUPACIÓN sin tablero propio: las incidencias viven en subproyectos"
          ),
        createdAt: z
          .string()
          .optional()
          .describe("Fecha de creación a fijar (YYYY-MM-DD o fecha-hora ISO). Por defecto, ahora"),
        format: formatArg,
      },
      outputSchema: { project: ProjectSchema },
    },
    async ({ workspaceSlug, key, name, description, color, isGroup, createdAt, format }) => {
      try {
        const { client } = await getUserClient()
        const workspace = await workspaces.getWorkspaceBySlug(client, workspaceSlug)
        if (!workspace) {
          return fail(new Error(`No se encontró (o no tenés acceso a) el workspace "${workspaceSlug}"`))
        }
        const project = await projects.createProject(client, {
          workspaceId: workspace.id,
          name: name.trim(),
          key: key.trim(),
          description,
          color,
          isGroup,
          createdAt,
        })
        return ok(
          { project },
          {
            format,
            markdown: (data) =>
              mdSection(
                "Proyecto creado",
                mdFields([
                  ["Clave", data.project.key],
                  ["Nombre", data.project.name],
                  ["Descripción", data.project.description],
                  ["Agrupación", data.project.isGroup ? "sí" : "no"],
                  ["Creado", data.project.createdAt],
                ])
              ),
          }
        )
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    "update_project",
    {
      title: "Actualizar proyecto",
      description:
        "Actualiza un proyecto existente: nombre, clave, descripción, color, archivado o su fecha de creación (`createdAt`), por ejemplo para corregirla tras una migración de datos. Solo se modifican los campos que envíes.",
      inputSchema: {
        workspaceSlug: z.string(),
        projectKey: z.string().describe("Clave actual del proyecto a modificar"),
        name: z.string().min(1).optional().describe("Nuevo nombre"),
        key: z.string().min(1).optional().describe("Nueva clave, única dentro del workspace"),
        description: z
          .string()
          .nullable()
          .optional()
          .describe("Nueva descripción, o null para quitarla"),
        color: colorArg.optional(),
        archived: z.boolean().optional().describe("true para archivar, false para reactivar"),
        createdAt: z
          .string()
          .optional()
          .describe("Nueva fecha de creación (YYYY-MM-DD o fecha-hora ISO)"),
        format: formatArg,
      },
      outputSchema: { project: ProjectSchema },
    },
    async ({ workspaceSlug, projectKey, name, key, description, color, archived, createdAt, format }) => {
      try {
        const { client } = await getUserClient()
        const { project: current } = await resolveProject(client, workspaceSlug, projectKey)
        const project = await projects.updateProject(client, current.id, {
          name: name?.trim(),
          key: key?.trim(),
          description,
          color,
          archived,
          createdAt,
        })
        return ok(
          { project },
          {
            format,
            markdown: (data) =>
              mdSection(
                "Proyecto actualizado",
                mdFields([
                  ["Clave", data.project.key],
                  ["Nombre", data.project.name],
                  ["Descripción", data.project.description],
                  ["Archivado", data.project.archived ? "sí" : "no"],
                  ["Creado", data.project.createdAt],
                ])
              ),
          }
        )
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
        "Devuelve TODO lo que necesitas para crear o actualizar una incidencia en este proyecto: los tipos de incidencia disponibles (Bug, Tarea, ...), los estados del flujo de trabajo con su categoría, los módulos del sistema, los subproyectos (si el proyecto es una agrupación), las etiquetas, las prioridades válidas y los miembros a los que se puede asignar. Llámalo antes de create_issue o update_issue.",
      inputSchema: {
        workspaceSlug: z.string(),
        projectKey: z.string().describe("Clave corta del proyecto, por ejemplo 'ENG'"),
        format: formatArg,
      },
      outputSchema: {
        project: ProjectSchema,
        workspace: WorkspaceSchema,
        issueTypes: z.array(IssueTypeSchema),
        statuses: z.array(IssueStatusSchema),
        modules: z.array(IssueModuleSchema),
        subprojects: z.array(SubprojectSchema),
        labels: z.array(LabelSchema),
        members: z.array(MemberSchema),
        priorities: z.array(OptionSchema),
        statusCategories: z.array(OptionSchema),
        hint: z.string(),
      },
    },
    async ({ workspaceSlug, projectKey, format }) => {
      try {
        const { client } = await getUserClient()
        const { workspace, project } = await resolveProject(client, workspaceSlug, projectKey)
        const [statuses, types, modules, subprojects, labels, members] = await Promise.all([
          projects.listIssueStatuses(client, project.id),
          projects.listIssueTypes(client, project.id),
          projects.listIssueModules(client, project.id),
          project.isGroup
            ? projects.listSubprojects(client, project.id)
            : Promise.resolve([]),
          projects.listLabels(client, project.id),
          projects.listWorkspaceMembers(client, workspace.id),
        ])
        return ok(
          {
            project,
            workspace,
            issueTypes: types,
            statuses,
            modules,
            subprojects,
            labels,
            members,
            priorities: PRIORITIES,
            statusCategories: STATUS_CATEGORIES,
            hint: project.isGroup
              ? "Este proyecto es una AGRUPACIÓN: toda incidencia vive en un subproyecto, así que create_issue exige `subproject` (por nombre o id). Solo se listan los subproyectos a los que tienes acceso. `type`, `status`, `module`, `assignee` y `labels` también aceptan nombres además de ids; `status` acepta una categoría como 'done'."
              : "En create_issue y update_issue puedes pasar `type`, `status`, `module`, `assignee` y `labels` por nombre (por ejemplo type:'Bug', module:'Facturación'); el servidor los resuelve a sus IDs. `status` también acepta una categoría como 'done'. Para dar de alta o renombrar tipos, estados y módulos usa create_issue_type, update_issue_type, create_issue_status, update_issue_status, create_issue_module y update_issue_module.",
          },
          {
            format,
            markdown: (data) =>
              mdJoin(
                `# ${data.project.key} — ${data.project.name}`,
                mdFields([
                  ["Workspace", `${data.workspace.name} (${data.workspace.slug})`],
                  ["Descripción", data.project.description],
                  ["Archivado", data.project.archived ? "sí" : "no"],
                ]),
                mdSection("Tipos de incidencia", typesTable(data.issueTypes)),
                mdSection("Estados del flujo", statusesTable(data.statuses)),
                mdSection(
                  "Módulos del sistema",
                  mdTable(
                    ["Nombre", "Descripción", "Id"],
                    data.modules.map((module) => [
                      module.name,
                      module.description ?? "—",
                      module.id,
                    ])
                  )
                ),
                data.subprojects.length > 0
                  ? mdSection(
                      "Subproyectos (obligatorio elegir uno al crear)",
                      mdTable(
                        ["Nombre", "Slug", "Id"],
                        data.subprojects.map((subproject) => [
                          subproject.name,
                          subproject.slug,
                          subproject.id,
                        ])
                      )
                    )
                  : "",
                mdSection(
                  "Etiquetas",
                  mdTable(
                    ["Nombre", "Color", "Id"],
                    data.labels.map((label) => [label.name, label.color, label.id]),
                    "Este proyecto no tiene etiquetas"
                  )
                ),
                mdSection("Miembros asignables", membersTable(data.members)),
                mdSection(
                  "Prioridades",
                  data.priorities.map((option) => `- \`${option.value}\` — ${option.label}`).join("\n")
                ),
                mdSection(
                  "Categorías de estado",
                  data.statusCategories
                    .map((option) => `- \`${option.value}\` — ${option.label}`)
                    .join("\n")
                ),
                mdSection("Cómo usarlo", data.hint)
              ),
          }
        )
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
      inputSchema: { workspaceSlug: z.string(), format: formatArg },
      outputSchema: { members: z.array(MemberSchema) },
    },
    async ({ workspaceSlug, format }) => {
      try {
        const { client } = await getUserClient()
        const workspace = await workspaces.getWorkspaceBySlug(client, workspaceSlug)
        if (!workspace) {
          return fail(new Error(`No se encontró (o no tenés acceso a) el workspace "${workspaceSlug}"`))
        }
        const members = await projects.listWorkspaceMembers(client, workspace.id)
        return ok(
          { members },
          {
            format,
            markdown: (data) =>
              mdSection(`Miembros de ${workspace.name}`, membersTable(data.members), 1),
          }
        )
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    "create_issue_type",
    {
      title: "Crear tipo de incidencia",
      description:
        "Crea un tipo de incidencia en el proyecto (por ejemplo 'Bug', 'Tarea', 'Mejora'). SOLO se llama cuando la persona usuaria lo pide: si el tipo que necesitas no existe, dilo y usa uno existente, no lo des de alta por tu cuenta. Comprueba antes con list_project_metadata que no exista uno equivalente: los tipos son del proyecto entero y todo el equipo los ve.",
      inputSchema: {
        workspaceSlug: z.string(),
        projectKey: z.string(),
        name: z.string().min(1).describe("Nombre visible del tipo, por ejemplo 'Deuda técnica'"),
        color: colorArg.optional().describe("Color hexadecimal (default '#6366f1')"),
        icon: z
          .string()
          .optional()
          .describe("Nombre del icono que usa la aplicación, si corresponde"),
        format: formatArg,
      },
      outputSchema: { issueType: IssueTypeSchema },
    },
    async ({ workspaceSlug, projectKey, name, color, icon, format }) => {
      try {
        const { client } = await getUserClient()
        const { project } = await resolveProject(client, workspaceSlug, projectKey)
        const issueType = await projects.createIssueType(client, {
          projectId: project.id,
          name: name.trim(),
          color,
          icon,
        })
        return ok(
          { issueType },
          { format, markdown: (data) => typeCard(data.issueType, "Tipo de incidencia creado") }
        )
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    "update_issue_type",
    {
      title: "Actualizar tipo de incidencia",
      description:
        "Renombra o recolorea un tipo de incidencia existente. El tipo se identifica por nombre actual o por id. Solo se modifican los campos que envíes. Afecta a todas las incidencias que ya lo usan.",
      inputSchema: {
        workspaceSlug: z.string(),
        projectKey: z.string(),
        type: z.string().describe("Tipo a modificar, por nombre actual ('Bug') o por id"),
        name: z.string().min(1).optional().describe("Nuevo nombre"),
        color: colorArg.optional(),
        icon: z.string().nullable().optional().describe("Nuevo icono, o null para quitarlo"),
        format: formatArg,
      },
      outputSchema: { issueType: IssueTypeSchema },
    },
    async ({ workspaceSlug, projectKey, type, name, color, icon, format }) => {
      try {
        const { client } = await getUserClient()
        const { project } = await resolveProject(client, workspaceSlug, projectKey)
        const typeId = await resolveTypeId(client, project.id, type)
        const issueType = await projects.updateIssueType(client, typeId, {
          name: name?.trim(),
          color,
          icon,
        })
        return ok(
          { issueType },
          { format, markdown: (data) => typeCard(data.issueType, "Tipo de incidencia actualizado") }
        )
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    "create_issue_status",
    {
      title: "Crear estado del flujo",
      description:
        "Crea un estado en el flujo de trabajo del proyecto (por ejemplo 'En revisión'). SOLO se llama cuando la persona usuaria lo pide: el flujo de trabajo es del equipo, no lo cambies para encajar una incidencia. La categoría es lo que determina su significado: una incidencia en un estado de categoría 'done' se considera cerrada. Si no indicas `position`, el estado se añade al final del flujo.",
      inputSchema: {
        workspaceSlug: z.string(),
        projectKey: z.string(),
        name: z.string().min(1).describe("Nombre visible del estado, por ejemplo 'En revisión'"),
        category: statusCategory,
        color: colorArg.optional().describe("Color hexadecimal (default '#94a3b8')"),
        position: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Posición en el flujo. Si se omite, se añade al final"),
        format: formatArg,
      },
      outputSchema: { issueStatus: IssueStatusSchema },
    },
    async ({ workspaceSlug, projectKey, name, category, color, position, format }) => {
      try {
        const { client } = await getUserClient()
        const { project } = await resolveProject(client, workspaceSlug, projectKey)
        const issueStatus = await projects.createIssueStatus(client, {
          projectId: project.id,
          name: name.trim(),
          category,
          color,
          position,
        })
        return ok(
          { issueStatus },
          { format, markdown: (data) => statusCard(data.issueStatus, "Estado creado") }
        )
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    "update_issue_status",
    {
      title: "Actualizar estado del flujo",
      description:
        "Renombra un estado, cambia su categoría, su color o su posición en el flujo. El estado se identifica por nombre actual, por categoría (si es inequívoca) o por id. Cambiar la categoría a 'done' hace que las incidencias que ya estén en ese estado pasen a contar como cerradas: revisa antes que estén documentadas.",
      inputSchema: {
        workspaceSlug: z.string(),
        projectKey: z.string(),
        status: z
          .string()
          .describe("Estado a modificar, por nombre actual ('En progreso'), categoría o id"),
        name: z.string().min(1).optional().describe("Nuevo nombre"),
        category: statusCategory.optional().describe("Nueva categoría"),
        color: colorArg.optional(),
        position: z.number().int().min(0).optional().describe("Nueva posición en el flujo"),
        format: formatArg,
      },
      outputSchema: { issueStatus: IssueStatusSchema },
    },
    async ({ workspaceSlug, projectKey, status, name, category, color, position, format }) => {
      try {
        const { client } = await getUserClient()
        const { project } = await resolveProject(client, workspaceSlug, projectKey)
        const current = await resolveStatus(client, project.id, status)
        const issueStatus = await projects.updateIssueStatus(client, current.id, {
          name: name?.trim(),
          category,
          color,
          position,
        })
        return ok(
          { issueStatus },
          { format, markdown: (data) => statusCard(data.issueStatus, "Estado actualizado") }
        )
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    "create_issue_module",
    {
      title: "Crear módulo de incidencia",
      description:
        "Crea un módulo con el que se clasifican las incidencias del proyecto (por ejemplo 'Facturación', 'Autenticación'). SOLO se llama cuando la persona usuaria lo pide. Comprueba antes con list_project_metadata que no exista uno equivalente: los módulos son del proyecto entero y todo el equipo los ve.",
      inputSchema: {
        workspaceSlug: z.string(),
        projectKey: z.string(),
        name: z.string().min(1).describe("Nombre visible del módulo, por ejemplo 'Facturación'"),
        description: z.string().optional().describe("Descripción del módulo"),
        color: colorArg.optional().describe("Color hexadecimal (default '#82a53b')"),
        format: formatArg,
      },
      outputSchema: { issueModule: IssueModuleSchema },
    },
    async ({ workspaceSlug, projectKey, name, description, color, format }) => {
      try {
        const { client } = await getUserClient()
        const { project } = await resolveProject(client, workspaceSlug, projectKey)
        const issueModule = await projects.createIssueModule(client, {
          projectId: project.id,
          name: name.trim(),
          description,
          color,
        })
        return ok(
          { issueModule },
          { format, markdown: (data) => moduleCard(data.issueModule, "Módulo creado") }
        )
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    "update_issue_module",
    {
      title: "Actualizar módulo de incidencia",
      description:
        "Renombra, recolorea o cambia la descripción de un módulo existente. El módulo se identifica por nombre actual o por id. Solo se modifican los campos que envíes. Afecta a todas las incidencias que ya lo usan.",
      inputSchema: {
        workspaceSlug: z.string(),
        projectKey: z.string(),
        module: z.string().describe("Módulo a modificar, por nombre actual ('Facturación') o por id"),
        name: z.string().min(1).optional().describe("Nuevo nombre"),
        description: z.string().nullable().optional().describe("Nueva descripción, o null para quitarla"),
        color: colorArg.optional(),
        format: formatArg,
      },
      outputSchema: { issueModule: IssueModuleSchema },
    },
    async ({ workspaceSlug, projectKey, module, name, description, color, format }) => {
      try {
        const { client } = await getUserClient()
        const { project } = await resolveProject(client, workspaceSlug, projectKey)
        const moduleId = await resolveModuleId(client, project.id, module)
        const issueModule = await projects.updateIssueModule(client, moduleId, {
          name: name?.trim(),
          description,
          color,
        })
        return ok(
          { issueModule },
          { format, markdown: (data) => moduleCard(data.issueModule, "Módulo actualizado") }
        )
      } catch (err) {
        return fail(err)
      }
    }
  )
}
