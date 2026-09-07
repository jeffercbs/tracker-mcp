import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import { getUserClient } from "../auth/supabase-client.js"
import * as boards from "../repositories/boards.js"
import { findIssueRef } from "../repositories/issues.js"
import { resolveProject } from "./resolve-project.js"
import { resolveSubproject } from "./resolve-refs.js"
import { formatArg, mdFields, mdJoin, mdSection, mdTable, ok, fail } from "./response.js"

const KIND_LABEL: Record<boards.BoardKind, string> = {
  sprint: "Sprint",
  waterfall: "Cascada",
  timeline: "Cronograma",
}

const STAGE_WORD: Record<boards.BoardKind, { singular: string; plural: string }> = {
  sprint: { singular: "sprint", plural: "sprints" },
  waterfall: { singular: "fase", plural: "fases" },
  timeline: { singular: "iteración", plural: "iteraciones" },
}

const SEGMENT_LABEL: Record<boards.BoardSegmentKind, string> = {
  main: "Trabajo principal",
  overlap: "Trabajo solapado",
  dependency: "Dependencia de terceros",
}

const SEGMENT_MARK: Record<boards.BoardSegmentKind, string> = {
  main: "█",
  overlap: "▒",
  dependency: "▓",
}

const BoardSummarySchema = z.object({
  name: z.string(),
  slug: z.string(),
  kind: z.string(),
  status: z.string(),
  description: z.string(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  stages: z.number(),
  issues: z.number(),
  closedIssues: z.number(),
})

const StageSchema = z.object({
  name: z.string(),
  goal: z.string(),
  status: z.string(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  issues: z.array(
    z.object({ number: z.number(), title: z.string(), status: z.string().nullable(), closed: z.boolean() })
  ),
  schedule: z.array(z.object({ kind: z.string(), from: z.number(), to: z.number() })),
})

function slugify(input: string) {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
}

function uniqueSlug(name: string, taken: Set<string>) {
  const base = slugify(name) || "tablero"
  if (!taken.has(base)) return base

  let counter = 2
  while (taken.has(`${base}-${counter}`)) counter += 1
  return `${base}-${counter}`
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

/** Las etapas iniciales: sprints con fechas encadenadas, o los nombres dados. */
function planStages(input: {
  kind: boards.BoardKind
  startsAt: string | null
  stageNames: string[]
  sprintCount: number
  sprintWeeks: number
}) {
  if (input.kind !== "sprint" || input.stageNames.length > 0) {
    return input.stageNames.map((name) => ({ name, startsAt: null, endsAt: null }))
  }

  const start = input.startsAt ? new Date(`${input.startsAt}T00:00:00`) : null

  return Array.from({ length: input.sprintCount }, (_, index) => {
    if (!start) {
      return { name: `Sprint ${index + 1}`, startsAt: null, endsAt: null }
    }
    const from = addDays(start, index * input.sprintWeeks * 7)
    const to = addDays(from, input.sprintWeeks * 7 - 1)
    return {
      name: `Sprint ${index + 1}`,
      startsAt: from.toISOString().slice(0, 10),
      endsAt: to.toISOString().slice(0, 10),
    }
  })
}

async function findBoard(
  client: Awaited<ReturnType<typeof getUserClient>>["client"],
  projectId: string,
  value: string
) {
  const list = await boards.listBoards(client, projectId)
  const target = slugify(value)
  const found =
    list.find((board) => board.slug === value) ??
    list.find((board) => board.slug === target) ??
    list.find((board) => board.id === value) ??
    list.find((board) => slugify(board.name) === target)

  if (!found) {
    throw new Error(
      `No se encontró el tablero "${value}". Disponibles: ${list.map((b) => `${b.name} (${b.slug})`).join(", ") || "ninguno"}`
    )
  }

  return found
}

function findStage(stages: boards.BoardStageDTO[], value: string, kind: boards.BoardKind) {
  const target = slugify(value)
  const found =
    stages.find((stage) => stage.id === value) ??
    stages.find((stage) => slugify(stage.name) === target) ??
    stages.find((stage) => slugify(stage.name).includes(target))

  if (!found) {
    throw new Error(
      `No se encontró la ${STAGE_WORD[kind].singular} "${value}". Disponibles: ${stages.map((s) => s.name).join(", ") || "ninguna"}`
    )
  }

  return found
}

/** La rejilla del cronograma en texto, una fila por iteración. */
function renderTimeline(
  board: boards.BoardDTO,
  stages: boards.BoardStageDTO[],
  segments: boards.BoardSegmentDTO[]
) {
  const rows = stages.map((stage, index) => {
    const cells = Array.from({ length: board.unitCount }, () => "·")
    for (const segment of segments.filter((item) => item.stageId === stage.id)) {
      for (let unit = segment.startUnit; unit <= segment.endUnit; unit += 1) {
        if (unit >= 1 && unit <= board.unitCount) {
          cells[unit - 1] = SEGMENT_MARK[segment.kind]
        }
      }
    }
    return `${String(index).padStart(2, " ")} · ${stage.name.padEnd(28).slice(0, 28)} ${cells.join("")}`
  })

  const header = `      ${" ".repeat(28)} ${Array.from({ length: board.unitCount }, (_, i) => String((i + 1) % 10)).join("")}`
  const legend = Object.entries(SEGMENT_MARK)
    .map(([kind, mark]) => `${mark} ${SEGMENT_LABEL[kind as boards.BoardSegmentKind]}`)
    .join("   ")

  return ["```", header, ...rows, "```", `${board.unitLabel}s 1–${board.unitCount}. ${legend}`].join(
    "\n"
  )
}

export function registerBoardTools(server: McpServer) {
  server.registerTool(
    "list_boards",
    {
      title: "Listar tableros",
      description:
        "Lista los tableros de seguimiento del proyecto: sprints, cascada y cronogramas de iteraciones, con su avance. En un proyecto AGRUPACIÓN pasa `subproject` para ver los del subproyecto; sin él se listan los del proyecto.",
      inputSchema: {
        workspaceSlug: z.string(),
        projectKey: z.string(),
        subproject: z
          .string()
          .optional()
          .describe("Nombre, slug o id del subproyecto cuyos tableros quieres ver"),
        format: formatArg,
      },
      outputSchema: { boards: z.array(BoardSummarySchema) },
    },
    async ({ workspaceSlug, projectKey, subproject, format }) => {
      try {
        const { client } = await getUserClient()
        const { project } = await resolveProject(client, workspaceSlug, projectKey)

        const subprojectId = subproject
          ? (await resolveSubproject(client, project.id, subproject)).id
          : null

        const list = await boards.listBoards(client, project.id, { subprojectId })

        const detail = await Promise.all(
          list.map(async (board) => {
            const [stages, issues] = await Promise.all([
              boards.listStages(client, board.id),
              boards.listBoardIssues(client, board.id),
            ])
            return {
              name: board.name,
              slug: board.slug,
              kind: KIND_LABEL[board.kind],
              status: board.status,
              description: board.description,
              startsAt: board.startsAt,
              endsAt: board.endsAt,
              stages: stages.length,
              issues: issues.length,
              closedIssues: issues.filter((issue) => issue.closed).length,
            }
          })
        )

        return ok(
          { boards: detail },
          {
            format,
            markdown: (data) =>
              mdSection(
                `Tableros de ${projectKey}`,
                mdTable(
                  ["Tablero", "Identificador", "Tipo", "Etapas", "Cerradas", "Fechas"],
                  data.boards.map((board) => [
                    board.name,
                    board.slug,
                    board.kind,
                    board.stages,
                    `${board.closedIssues}/${board.issues}`,
                    [board.startsAt, board.endsAt].filter(Boolean).join(" → ") || "—",
                  ]),
                  "Este proyecto no tiene tableros"
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
    "get_board",
    {
      title: "Leer un tablero",
      description:
        "Devuelve un tablero completo: sus sprints, fases o iteraciones con fechas y estado, las incidencias repartidas en cada una y, si es un cronograma, la rejilla de periodos con el trabajo principal, el solapado y las dependencias de terceros.",
      inputSchema: {
        workspaceSlug: z.string(),
        projectKey: z.string(),
        board: z.string().describe("Identificador del tablero, tal como lo devuelve list_boards"),
        format: formatArg,
      },
      outputSchema: {
        board: BoardSummarySchema,
        stages: z.array(StageSchema),
      },
    },
    async ({ workspaceSlug, projectKey, board: boardRef, format }) => {
      try {
        const { client } = await getUserClient()
        const { project } = await resolveProject(client, workspaceSlug, projectKey)
        const board = await findBoard(client, project.id, boardRef)

        const [stages, issues, segments] = await Promise.all([
          boards.listStages(client, board.id),
          boards.listBoardIssues(client, board.id),
          board.kind === "timeline"
            ? boards.listSegments(client, board.id)
            : Promise.resolve([] as boards.BoardSegmentDTO[]),
        ])

        const payload = {
          board: {
            name: board.name,
            slug: board.slug,
            kind: KIND_LABEL[board.kind],
            status: board.status,
            description: board.description,
            startsAt: board.startsAt,
            endsAt: board.endsAt,
            stages: stages.length,
            issues: issues.length,
            closedIssues: issues.filter((issue) => issue.closed).length,
          },
          stages: stages.map((stage) => ({
            name: stage.name,
            goal: stage.goal,
            status: stage.status,
            startsAt: stage.startsAt,
            endsAt: stage.endsAt,
            issues: issues
              .filter((issue) => issue.stageId === stage.id)
              .map((issue) => ({
                number: issue.number,
                title: issue.title,
                status: issue.statusName,
                closed: issue.closed,
              })),
            schedule: segments
              .filter((segment) => segment.stageId === stage.id)
              .map((segment) => ({
                kind: SEGMENT_LABEL[segment.kind],
                from: segment.startUnit,
                to: segment.endUnit,
              })),
          })),
        }

        return ok(payload, {
          format,
          markdown: (data) =>
            mdJoin(
              mdSection(
                `${data.board.name} · ${data.board.kind}`,
                mdFields([
                  ["Estado", data.board.status],
                  ["Fechas", [data.board.startsAt, data.board.endsAt].filter(Boolean).join(" → ")],
                  ["Incidencias", `${data.board.closedIssues}/${data.board.issues} cerradas`],
                  ["Descripción", data.board.description],
                ]),
                1
              ),
              board.kind === "timeline" ? renderTimeline(board, stages, segments) : null,
              ...data.stages.map((stage) =>
                mdSection(
                  stage.name,
                  mdJoin(
                    mdFields([
                      ["Estado", stage.status],
                      ["Fechas", [stage.startsAt, stage.endsAt].filter(Boolean).join(" → ")],
                      ["Objetivo", stage.goal],
                      [
                        "Cronograma",
                        stage.schedule
                          .map((item) => `${item.kind} (${item.from}–${item.to})`)
                          .join(", "),
                      ],
                    ]),
                    mdTable(
                      ["Incidencia", "Título", "Estado"],
                      stage.issues.map((issue) => [
                        `${projectKey}-${issue.number}`,
                        issue.title,
                        issue.status,
                      ]),
                      "Sin incidencias asignadas"
                    )
                  ),
                  2
                )
              )
            ),
        })
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    "create_board",
    {
      title: "Crear un tablero",
      description:
        "Crea un tablero de seguimiento. SOLO cuando la persona usuaria lo pida: no abras tableros por iniciativa propia. `kind` es 'sprint' (iteraciones con columnas por estado), 'waterfall' (fases encadenadas) o 'timeline' (cronograma de iteraciones con rejilla de periodos). Pasa los nombres de las etapas en `stages`; para un sprint puedes dejarlo vacío e indicar `sprintCount` y `sprintWeeks` para que se generen con sus fechas.",
      inputSchema: {
        workspaceSlug: z.string(),
        projectKey: z.string(),
        subproject: z
          .string()
          .optional()
          .describe("Subproyecto al que pertenece el tablero, si el proyecto es una agrupación"),
        kind: z.enum(["sprint", "waterfall", "timeline"]),
        name: z.string().min(2).max(80),
        description: z.string().max(500).optional(),
        startsAt: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("Fecha de arranque en formato YYYY-MM-DD"),
        stages: z
          .array(z.string().min(1).max(80))
          .max(20)
          .optional()
          .describe("Nombres de los sprints, fases o iteraciones iniciales, en orden"),
        sprintCount: z.number().int().min(1).max(24).optional(),
        sprintWeeks: z.number().int().min(1).max(8).optional(),
        unitCount: z
          .number()
          .int()
          .min(1)
          .max(60)
          .optional()
          .describe("Solo en 'timeline': cuántas columnas numeradas tiene la rejilla"),
        unitLabel: z
          .string()
          .max(20)
          .optional()
          .describe("Solo en 'timeline': qué representa cada columna (Semana, Mes...)"),
        format: formatArg,
      },
      outputSchema: { board: BoardSummarySchema, stageNames: z.array(z.string()) },
    },
    async (input) => {
      try {
        const { client, userId } = await getUserClient()
        const { project } = await resolveProject(client, input.workspaceSlug, input.projectKey)

        const subprojectId = input.subproject
          ? (await resolveSubproject(client, project.id, input.subproject)).id
          : null

        if (project.isGroup && !subprojectId) {
          throw new Error(
            `El proyecto ${project.key} es una agrupación: indica el subproyecto del tablero, o créalo desde la aplicación si es del proyecto entero.`
          )
        }

        const existing = await boards.listBoards(client, project.id)
        const stages = planStages({
          kind: input.kind,
          startsAt: input.startsAt ?? null,
          stageNames: input.stages ?? [],
          sprintCount: input.sprintCount ?? 3,
          sprintWeeks: input.sprintWeeks ?? 2,
        })

        const ends = stages
          .map((stage) => stage.endsAt)
          .filter((value): value is string => Boolean(value))

        const board = await boards.createBoard(client, {
          projectId: project.id,
          subprojectId,
          kind: input.kind,
          name: input.name,
          slug: uniqueSlug(input.name, new Set(existing.map((item) => item.slug))),
          description: input.description ?? "",
          startsAt: input.startsAt ?? null,
          endsAt: ends.length > 0 ? ends.reduce((a, b) => (b > a ? b : a)) : null,
          unitCount: input.unitCount ?? 12,
          unitLabel: input.unitLabel ?? "Semana",
          userId,
        })

        const created = await boards.createStages(client, board.id, stages)

        const payload = {
          board: {
            name: board.name,
            slug: board.slug,
            kind: KIND_LABEL[board.kind],
            status: board.status,
            description: board.description,
            startsAt: board.startsAt,
            endsAt: board.endsAt,
            stages: created.length,
            issues: 0,
            closedIssues: 0,
          },
          stageNames: created.map((stage) => stage.name),
        }

        return ok(payload, {
          format: input.format,
          markdown: (data) =>
            mdSection(
              "Tablero creado",
              mdFields([
                ["Tablero", data.board.name],
                ["Identificador", data.board.slug],
                ["Tipo", data.board.kind],
                [STAGE_WORD[input.kind].plural, data.stageNames.join(", ")],
              ]),
              1
            ),
        })
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    "add_board_stage",
    {
      title: "Añadir un sprint, fase o iteración",
      description:
        "Añade una etapa al final de un tablero existente. Es una acción bajo petición: no amplíes la planificación del equipo por tu cuenta.",
      inputSchema: {
        workspaceSlug: z.string(),
        projectKey: z.string(),
        board: z.string(),
        name: z.string().min(1).max(80),
        goal: z.string().max(500).optional(),
        startsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        endsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        format: formatArg,
      },
      outputSchema: { name: z.string(), position: z.number() },
    },
    async ({ workspaceSlug, projectKey, board: boardRef, name, goal, startsAt, endsAt, format }) => {
      try {
        const { client } = await getUserClient()
        const { project } = await resolveProject(client, workspaceSlug, projectKey)
        const board = await findBoard(client, project.id, boardRef)
        const position = await boards.nextStagePosition(client, board.id)

        const [stage] = await boards.createStages(
          client,
          board.id,
          [{ name, goal, startsAt: startsAt ?? null, endsAt: endsAt ?? null }],
          position
        )

        return ok(
          { name: stage.name, position: stage.position },
          {
            format,
            markdown: (data) =>
              `Se añadió **${data.name}** a ${board.name} en la posición ${data.position}.`,
          }
        )
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    "update_board_stage",
    {
      title: "Actualizar un sprint, fase o iteración",
      description:
        "Cambia el nombre, el objetivo, el estado o las fechas de una etapa del tablero. Úsalo para reflejar el avance real (por ejemplo, marcar una fase como terminada) cuando te lo pidan.",
      inputSchema: {
        workspaceSlug: z.string(),
        projectKey: z.string(),
        board: z.string(),
        stage: z.string().describe("Nombre o id del sprint, fase o iteración"),
        name: z.string().min(1).max(80).optional(),
        goal: z.string().max(500).optional(),
        status: z.enum(["planned", "active", "completed"]).optional(),
        startsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        endsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        format: formatArg,
      },
      outputSchema: { stage: z.string(), updated: z.array(z.string()) },
    },
    async (input) => {
      try {
        const { client } = await getUserClient()
        const { project } = await resolveProject(client, input.workspaceSlug, input.projectKey)
        const board = await findBoard(client, project.id, input.board)
        const stages = await boards.listStages(client, board.id)
        const stage = findStage(stages, input.stage, board.kind)

        const patch = {
          name: input.name,
          goal: input.goal,
          status: input.status,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
        }

        await boards.updateStage(client, stage.id, patch)

        const updated = Object.entries(patch)
          .filter(([, value]) => value !== undefined)
          .map(([key]) => key)

        return ok(
          { stage: input.name ?? stage.name, updated },
          {
            format: input.format,
            markdown: (data) =>
              data.updated.length > 0
                ? `Se actualizó **${data.stage}** (${data.updated.join(", ")}).`
                : `No se envió ningún cambio para **${data.stage}**.`,
          }
        )
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    "set_board_issues",
    {
      title: "Colocar incidencias en un tablero",
      description:
        "Coloca incidencias (por número) en un sprint, fase o iteración. Si una incidencia ya estaba en otra etapa del mismo tablero, se mueve. Con `remove: true` las saca del tablero sin tocar la incidencia.",
      inputSchema: {
        workspaceSlug: z.string(),
        projectKey: z.string(),
        board: z.string(),
        stage: z
          .string()
          .optional()
          .describe("Etapa destino. Obligatoria salvo que uses remove: true"),
        issues: z.array(z.number().int().positive()).min(1).max(100),
        remove: z.boolean().optional(),
        format: formatArg,
      },
      outputSchema: { moved: z.array(z.number()), stage: z.string().nullable() },
    },
    async ({ workspaceSlug, projectKey, board: boardRef, stage: stageRef, issues, remove, format }) => {
      try {
        const { client } = await getUserClient()
        const { project } = await resolveProject(client, workspaceSlug, projectKey)
        const board = await findBoard(client, project.id, boardRef)

        const refs = await Promise.all(
          issues.map(async (number) => {
            const ref = await findIssueRef(client, project.id, number)
            if (!ref) {
              throw new Error(`No existe la incidencia ${projectKey}-${number}`)
            }
            return ref
          })
        )

        if (remove) {
          await boards.removeIssuesFromBoard(
            client,
            board.id,
            refs.map((ref) => ref.id)
          )

          return ok(
            { moved: refs.map((ref) => ref.number), stage: null },
            {
              format,
              markdown: (data) =>
                `Se quitaron del tablero **${board.name}**: ${data.moved
                  .map((number) => `${projectKey}-${number}`)
                  .join(", ")}.`,
            }
          )
        }

        if (!stageRef) {
          throw new Error(
            `Indica la ${STAGE_WORD[board.kind].singular} destino, o usa remove: true para sacarlas del tablero.`
          )
        }

        const stages = await boards.listStages(client, board.id)
        const stage = findStage(stages, stageRef, board.kind)

        await boards.assignIssuesToStage(client, {
          boardId: board.id,
          stageId: stage.id,
          issueIds: refs.map((ref) => ref.id),
        })

        return ok(
          { moved: refs.map((ref) => ref.number), stage: stage.name },
          {
            format,
            markdown: (data) =>
              `**${data.stage}** (${board.name}) ahora incluye: ${data.moved
                .map((number) => `${projectKey}-${number}`)
                .join(", ")}.`,
          }
        )
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    "set_timeline_segment",
    {
      title: "Pintar un tramo del cronograma",
      description:
        "En un tablero de tipo cronograma, marca en qué periodos cae el trabajo de una iteración. `kind` es 'main' (trabajo principal), 'overlap' (trabajo solapado con otra iteración) o 'dependency' (dependencia de terceros). Con `clear: true` borra los tramos que toquen ese rango.",
      inputSchema: {
        workspaceSlug: z.string(),
        projectKey: z.string(),
        board: z.string(),
        stage: z.string().describe("Nombre o id de la iteración"),
        kind: z.enum(["main", "overlap", "dependency"]).optional(),
        from: z.number().int().min(1).max(60).describe("Primer periodo del tramo (empieza en 1)"),
        to: z.number().int().min(1).max(60),
        clear: z.boolean().optional(),
        format: formatArg,
      },
      outputSchema: { stage: z.string(), kind: z.string().nullable(), from: z.number(), to: z.number() },
    },
    async ({ workspaceSlug, projectKey, board: boardRef, stage: stageRef, kind, from, to, clear, format }) => {
      try {
        const { client } = await getUserClient()
        const { project } = await resolveProject(client, workspaceSlug, projectKey)
        const board = await findBoard(client, project.id, boardRef)

        if (board.kind !== "timeline") {
          throw new Error(
            `El tablero "${board.name}" es de tipo ${KIND_LABEL[board.kind]}, no un cronograma.`
          )
        }

        if (to < from) {
          throw new Error("El tramo termina antes de empezar")
        }
        if (to > board.unitCount) {
          throw new Error(
            `El cronograma tiene ${board.unitCount} ${board.unitLabel.toLowerCase()}s: el tramo se sale.`
          )
        }

        const stages = await boards.listStages(client, board.id)
        const stage = findStage(stages, stageRef, board.kind)

        if (clear) {
          const removed = await boards.deleteSegmentsInRange(client, {
            boardId: board.id,
            stageId: stage.id,
            startUnit: from,
            endUnit: to,
          })

          return ok(
            { stage: stage.name, kind: null, from, to },
            {
              format,
              markdown: (data) =>
                `Se borraron ${removed} tramo(s) de **${data.stage}** entre ${data.from} y ${data.to}.`,
            }
          )
        }

        if (!kind) {
          throw new Error("Indica el tipo de tramo: main, overlap o dependency")
        }

        await boards.deleteSegmentsInRange(client, {
          boardId: board.id,
          stageId: stage.id,
          startUnit: from,
          endUnit: to,
        })

        await boards.createSegment(client, {
          boardId: board.id,
          stageId: stage.id,
          kind,
          startUnit: from,
          endUnit: to,
        })

        return ok(
          { stage: stage.name, kind: SEGMENT_LABEL[kind], from, to },
          {
            format,
            markdown: (data) =>
              `**${data.stage}**: ${data.kind} en ${board.unitLabel.toLowerCase()}s ${data.from}–${data.to}.`,
          }
        )
      } catch (err) {
        return fail(err)
      }
    }
  )
}
