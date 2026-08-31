import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import { getUserClient } from "../auth/supabase-client.js"
import * as skills from "../repositories/skills.js"
import { renderSkillMarkdown, skillFilePath, toSkillFiles } from "../skill/project-skills.js"
import { resolveProject } from "./resolve-project.js"
import { formatArg, mdBlock, mdFields, mdJoin, mdSection, mdTable, ok, fail } from "./response.js"

const SkillSummarySchema = z.object({
  name: z.string(),
  kind: z.string(),
  title: z.string(),
  description: z.string(),
  path: z.string(),
  enabled: z.boolean(),
  updatedAt: z.string(),
})

const SkillFileSchema = z.object({
  name: z.string(),
  kind: z.string(),
  path: z.string(),
  content: z.string(),
})

function skillsTable(list: skills.ProjectSkillDTO[]) {
  return mdTable(
    ["Nombre", "Tipo", "Título", "Ruta", "Activo"],
    list.map((skill) => [
      skill.name,
      skill.kind,
      skill.title,
      skillFilePath(skill),
      skill.enabled ? "sí" : "no",
    ]),
    "Este proyecto no tiene skills definidos"
  )
}

export function registerSkillTools(server: McpServer) {
  server.registerTool(
    "list_project_skills",
    {
      title: "Listar los skills del proyecto",
      description:
        "Lista los skills y subagentes que el equipo definió en my-tracker para un proyecto, con la ruta en la que va cada uno dentro del repositorio. Úsala para saber qué hay disponible antes de instalar nada.",
      inputSchema: {
        workspaceSlug: z.string(),
        projectKey: z.string(),
        includeDisabled: z
          .boolean()
          .optional()
          .describe("Si es true, incluye también los que el equipo dejó inactivos"),
        format: formatArg,
      },
      outputSchema: { skills: z.array(SkillSummarySchema) },
    },
    async ({ workspaceSlug, projectKey, includeDisabled, format }) => {
      try {
        const { client } = await getUserClient()
        const { project } = await resolveProject(client, workspaceSlug, projectKey)
        const list = await skills.listProjectSkills(client, project.id, {
          onlyEnabled: !includeDisabled,
        })

        return ok(
          {
            skills: list.map((skill) => ({
              name: skill.name,
              kind: skill.kind,
              title: skill.title,
              description: skill.description,
              path: skillFilePath(skill),
              enabled: skill.enabled,
              updatedAt: skill.updatedAt,
            })),
          },
          {
            format,
            markdown: () => mdSection(`Skills de ${projectKey}`, skillsTable(list), 1),
          }
        )
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    "get_project_skill",
    {
      title: "Obtener un skill del proyecto",
      description:
        "Devuelve un skill concreto por su nombre, con el contenido del fichero ya montado (frontmatter incluido) y la ruta donde va.",
      inputSchema: {
        workspaceSlug: z.string(),
        projectKey: z.string(),
        name: z.string().describe("Nombre técnico del skill, por ejemplo 'revision-de-prs'"),
        format: formatArg,
      },
      outputSchema: { skill: SkillFileSchema },
    },
    async ({ workspaceSlug, projectKey, name, format }) => {
      try {
        const { client } = await getUserClient()
        const { project } = await resolveProject(client, workspaceSlug, projectKey)
        const [skill] = await skills.listProjectSkills(client, project.id, { names: [name] })

        if (!skill) {
          return fail(new Error(`No se encontró el skill "${name}" en ${projectKey}`))
        }

        const file = {
          name: skill.name,
          kind: skill.kind,
          path: skillFilePath(skill),
          content: renderSkillMarkdown(skill),
        }

        return ok(
          { skill: file },
          {
            format,
            markdown: (data) =>
              mdJoin(
                mdSection(skill.title, mdFields([
                  ["Nombre", skill.name],
                  ["Tipo", skill.kind],
                  ["Ruta", data.skill.path],
                  ["Activo", skill.enabled ? "sí" : "no"],
                ]), 1),
                mdBlock(data.skill.content, "El skill no tiene contenido")
              ),
          }
        )
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    "install_project_skills",
    {
      title: "Instalar los skills del proyecto",
      description:
        "Devuelve los ficheros de los skills activos del proyecto, cada uno con su ruta relativa y su contenido completo. Cuando te pidan instalar, traer o configurar los skills de un proyecto: llama a esta tool y escribe cada fichero tal cual en la ruta que indica, dentro del repositorio en el que estás trabajando. No cambies el contenido; si un fichero ya existe con contenido distinto, dilo y pregunta antes de pisarlo. Al terminar, avisa de que hay que reiniciar la sesión del agente para que los cargue.",
      inputSchema: {
        workspaceSlug: z.string(),
        projectKey: z.string(),
        names: z
          .array(z.string())
          .optional()
          .describe("Solo estos skills, por su nombre técnico. Si se omite, todos los activos"),
        root: z
          .string()
          .optional()
          .describe(
            "Carpeta raíz de destino. Por defecto '.claude'; usa '.agents' para clientes que leen esa convención"
          ),
        format: formatArg,
      },
      outputSchema: { files: z.array(SkillFileSchema) },
    },
    async ({ workspaceSlug, projectKey, names, root, format }) => {
      try {
        const { client } = await getUserClient()
        const { project } = await resolveProject(client, workspaceSlug, projectKey)
        const list = await skills.listProjectSkills(client, project.id, {
          onlyEnabled: true,
          names,
        })

        if (list.length === 0) {
          return ok(
            { files: [] },
            {
              format,
              markdown: () =>
                `El proyecto ${projectKey} no tiene skills activos que instalar. El equipo los define en la pestaña Skills del proyecto.`,
            }
          )
        }

        const files = toSkillFiles(list, root ?? ".claude")

        return ok(
          { files },
          {
            format,
            markdown: (data) =>
              mdJoin(
                mdSection(
                  `Skills de ${projectKey} para instalar`,
                  `Escribe cada fichero en su ruta, dentro del repositorio. Son ${data.files.length}.`,
                  1
                ),
                ...data.files.map((file) =>
                  mdJoin(mdSection(file.path, "", 2), mdBlock(file.content, "Sin contenido"))
                )
              ),
          }
        )
      } catch (err) {
        return fail(err)
      }
    }
  )
}
