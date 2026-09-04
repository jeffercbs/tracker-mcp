import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import { getUserClient } from "../auth/supabase-client.js"
import * as workflows from "../repositories/workflows.js"
import * as skills from "../repositories/skills.js"
import {
  listIssueModules,
  listIssueStatuses,
  listLabels,
} from "../repositories/projects.js"
import {
  parseWorkflowSpec,
  renderWorkflowPrompt,
  renderWorkflowSkill,
  workflowSkillName,
  workflowSkillPath,
  type WorkflowPromptContext,
} from "../workflows/prompt.js"
import { resolveProject } from "./resolve-project.js"
import { formatArg, mdFields, mdSection, mdTable, ok, fail } from "./response.js"

const WorkflowSummarySchema = z.object({
  name: z.string(),
  title: z.string(),
  description: z.string(),
  enabled: z.boolean(),
  steps: z.number(),
  updatedAt: z.string(),
})

const RoleSchema = z.object({
  name: z.string(),
  title: z.string(),
  instructions: z.string(),
  techStack: z.array(z.string()),
})

function countSteps(spec: unknown) {
  const parsed = parseWorkflowSpec(spec)
  if (!parsed) return 0
  return parsed.nodes.filter((node) => node.action !== "start").length
}

async function loadContext(
  client: Parameters<typeof listIssueStatuses>[0],
  workspaceSlug: string,
  projectKey: string,
  projectId: string,
  projectName: string
): Promise<WorkflowPromptContext> {
  const [roles, statuses, modules, labels] = await Promise.all([
    workflows.listProjectRoles(client, projectId),
    listIssueStatuses(client, projectId),
    listIssueModules(client, projectId),
    listLabels(client, projectId),
  ])

  return {
    workspaceSlug,
    projectKey,
    projectName,
    roles,
    statuses: statuses.map((status) => ({
      id: status.id,
      name: status.name,
      category: status.category,
    })),
    modules: modules.map((module) => ({ id: module.id, name: module.name })),
    labels: labels.map((label) => ({ id: label.id, name: label.name })),
  }
}

export function registerWorkflowTools(server: McpServer) {
  server.registerTool(
    "list_project_workflows",
    {
      title: "Listar flujos de trabajo",
      description:
        "Lista los flujos de trabajo que el equipo definió para el proyecto: cómo quieren que se trabajen las incidencias. Empieza por aquí cuando te pidan avanzar issues de un proyecto y no te digan cómo.",
      inputSchema: {
        workspaceSlug: z.string(),
        projectKey: z.string(),
        format: formatArg,
      },
      outputSchema: { workflows: z.array(WorkflowSummarySchema) },
    },
    async ({ workspaceSlug, projectKey, format }) => {
      try {
        const { client } = await getUserClient()
        const { project } = await resolveProject(client, workspaceSlug, projectKey)
        const list = await workflows.listProjectWorkflows(client, project.id, {
          onlyEnabled: true,
        })

        const payload = {
          workflows: list.map((workflow) => ({
            name: workflow.name,
            title: workflow.title,
            description: workflow.description,
            enabled: workflow.enabled,
            steps: countSteps(workflow.spec),
            updatedAt: workflow.updatedAt,
          })),
        }

        return ok(payload, {
          format,
          markdown: (data) =>
            mdSection(
              `Flujos de ${projectKey}`,
              mdTable(
                ["Nombre", "Identificador", "Pasos", "Para qué"],
                data.workflows.map((workflow) => [
                  workflow.title,
                  workflow.name,
                  workflow.steps,
                  workflow.description,
                ]),
                "Este proyecto no tiene flujos definidos"
              ),
              1
            ),
        })
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    "get_project_workflow",
    {
      title: "Leer un flujo de trabajo",
      description:
        "Devuelve el flujo de trabajo completo, ya redactado como instrucciones paso a paso. Síguelo en orden: dice de qué incidencias partir, qué validar, en qué URL probarlo y a qué estado moverlas. Si un paso pide confirmación humana, para y pregunta.",
      inputSchema: {
        workspaceSlug: z.string(),
        projectKey: z.string(),
        workflow: z
          .string()
          .describe("Identificador del flujo, tal como lo devuelve list_project_workflows"),
        format: formatArg,
      },
      outputSchema: {
        workflow: WorkflowSummarySchema,
        prompt: z.string(),
        roles: z.array(RoleSchema),
      },
    },
    async ({ workspaceSlug, projectKey, workflow: workflowName, format }) => {
      try {
        const { client } = await getUserClient()
        const { workspace, project } = await resolveProject(client, workspaceSlug, projectKey)
        const [found] = await workflows.listProjectWorkflows(client, project.id, {
          names: [workflowName],
        })

        if (!found) {
          return fail(
            new Error(
              `No se encontró el flujo "${workflowName}" en ${projectKey}. Usa list_project_workflows para ver los que hay.`
            )
          )
        }

        const spec = parseWorkflowSpec(found.spec)
        if (!spec) {
          return fail(new Error(`El flujo "${workflowName}" todavía no tiene un diagrama válido`))
        }

        const context = await loadContext(
          client,
          workspace.slug,
          project.key,
          project.id,
          project.name
        )

        const prompt = renderWorkflowPrompt(
          { title: found.title, description: found.description, spec },
          context
        )

        return ok(
          {
            workflow: {
              name: found.name,
              title: found.title,
              description: found.description,
              enabled: found.enabled,
              steps: spec.nodes.filter((node) => node.action !== "start").length,
              updatedAt: found.updatedAt,
            },
            prompt,
            roles: context.roles.map((role) => ({
              name: role.name,
              title: role.title,
              instructions: role.instructions,
              techStack: role.techStack,
            })),
          },
          { format, markdown: (data) => data.prompt }
        )
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    "get_workflow_skill",
    {
      title: "Instalar un flujo como skill",
      description:
        "Devuelve el fichero SKILL.md de un flujo para dejarlo en el repositorio y tenerlo siempre a mano. Escribe el fichero solo si te lo piden: no instales skills por iniciativa propia.",
      inputSchema: {
        workspaceSlug: z.string(),
        projectKey: z.string(),
        workflow: z.string(),
        root: z
          .string()
          .optional()
          .describe("Carpeta base donde se escribe la skill. Por defecto .claude"),
        format: formatArg,
      },
      outputSchema: { path: z.string(), content: z.string() },
    },
    async ({ workspaceSlug, projectKey, workflow: workflowName, root, format }) => {
      try {
        const { client } = await getUserClient()
        const { workspace, project } = await resolveProject(client, workspaceSlug, projectKey)
        const [found] = await workflows.listProjectWorkflows(client, project.id, {
          names: [workflowName],
        })

        if (!found) {
          return fail(new Error(`No se encontró el flujo "${workflowName}" en ${projectKey}`))
        }

        const spec = parseWorkflowSpec(found.spec)
        if (!spec) {
          return fail(new Error(`El flujo "${workflowName}" todavía no tiene un diagrama válido`))
        }

        const context = await loadContext(
          client,
          workspace.slug,
          project.key,
          project.id,
          project.name
        )

        const prompt = renderWorkflowPrompt(
          { title: found.title, description: found.description, spec },
          context
        )

        const payload = {
          path: workflowSkillPath(found.name, root),
          content: renderWorkflowSkill(found, prompt),
        }

        return ok(payload, {
          format,
          markdown: (data) =>
            mdSection(
              "Skill del flujo",
              `Escribe este contenido en \`${data.path}\` y reinicia la sesión para que se cargue.\n\n\`\`\`markdown\n${data.content}\n\`\`\``,
              1
            ),
        })
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    "publish_workflow_skill",
    {
      title: "Publicar un flujo como skill del proyecto",
      description:
        "Guarda el flujo como un skill del proyecto en my-tracker, para que quede compartido con el equipo y se pueda instalar después con install_project_skills. Si ya había un skill de ese flujo, lo reemplaza por la versión actual del diagrama. Es una acción bajo petición: no publiques nada por iniciativa propia.",
      inputSchema: {
        workspaceSlug: z.string(),
        projectKey: z.string(),
        workflow: z
          .string()
          .describe("Identificador del flujo, tal como lo devuelve list_project_workflows"),
        format: formatArg,
      },
      outputSchema: {
        name: z.string(),
        title: z.string(),
        path: z.string(),
        status: z.string(),
      },
    },
    async ({ workspaceSlug, projectKey, workflow: workflowName, format }) => {
      try {
        const { client, userId } = await getUserClient()
        const { workspace, project } = await resolveProject(client, workspaceSlug, projectKey)
        const [found] = await workflows.listProjectWorkflows(client, project.id, {
          names: [workflowName],
        })

        if (!found) {
          return fail(new Error(`No se encontró el flujo "${workflowName}" en ${projectKey}`))
        }

        const spec = parseWorkflowSpec(found.spec)
        if (!spec) {
          return fail(new Error(`El flujo "${workflowName}" todavía no tiene un diagrama válido`))
        }

        const context = await loadContext(
          client,
          workspace.slug,
          project.key,
          project.id,
          project.name
        )

        const prompt = renderWorkflowPrompt(
          { title: found.title, description: found.description, spec },
          context
        )

        const name = workflowSkillName(found.name)
        const [result] = await skills.importProjectSkills(client, {
          projectId: project.id,
          userId,
          overwrite: true,
          skills: [
            {
              kind: "skill",
              name,
              title: found.title,
              description:
                found.description.trim() ||
                `Flujo de trabajo "${found.title}" definido por el equipo en my-tracker.`,
              content: prompt.trim(),
              allowedTools: "",
              model: null,
              userInvocable: true,
            },
          ],
        })

        const payload = {
          name,
          title: found.title,
          path: workflowSkillPath(found.name),
          status: result?.status ?? "creado",
        }

        return ok(payload, {
          format,
          markdown: (data) =>
            mdSection(
              "Flujo publicado como skill",
              mdFields([
                ["Skill", data.name],
                ["Título", data.title],
                ["Ruta al instalarlo", data.path],
                ["Resultado", data.status],
              ]),
              1
            ),
        })
      } catch (err) {
        return fail(err)
      }
    }
  )
}
