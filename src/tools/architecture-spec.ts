import { z } from "zod"

const idSchema = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/, "Identificador inválido")
const pointSchema = z.tuple([z.number(), z.number()])

const sourceSchema = z.object({
  path: z.string().min(1).max(240),
  line: z.number().int().positive().optional(),
  end_line: z.number().int().positive().optional(),
  label: z.string().min(1).max(48).optional(),
})

const componentSchema = z.object({
  id: idSchema,
  type: z.enum([
    "frontend",
    "backend",
    "database",
    "cloud",
    "security",
    "messagebus",
    "external",
  ]),
  label: z.string().min(1),
  sublabel: z.string().optional(),
  tag: z.string().optional(),
  sources: z.array(sourceSchema).min(1).max(3).optional(),
  row: z.number().int().min(0).optional(),
  col: z.number().int().min(0).optional(),
  pos: pointSchema.optional(),
  size: z.tuple([z.number().positive(), z.number().positive()]).optional(),
})

const connectionSchema = z.object({
  id: idSchema.optional(),
  from: idSchema,
  to: idSchema,
  label: z.string().optional(),
  variant: z.enum(["default", "emphasis", "security", "dashed"]).optional(),
  fromSide: z.enum(["left", "right", "top", "bottom"]).optional(),
  toSide: z.enum(["left", "right", "top", "bottom"]).optional(),
  width: z.number().min(0.5).optional(),
})

const boundarySchema = z.object({
  kind: z.enum(["region", "security-group"]),
  label: z.string().min(1),
  wraps: z.array(idSchema).min(1),
  pad: z.number().min(0).optional(),
})

const cardSchema = z.object({
  dot: z.enum(["cyan", "emerald", "violet", "amber", "rose", "orange", "slate"]),
  title: z.string().min(1),
  items: z.array(z.string()),
})

const viewSchema = z.object({
  id: idSchema,
  label: z.string().min(1).max(48),
  focus: z.array(idSchema).min(1),
  note: z.string().max(140).optional(),
})

export const architectureSpecSchema = z
  .object({
    schema_version: z.literal(1),
    diagram_type: z.literal("architecture"),
    meta: z.object({
      title: z.string().min(1),
      subtitle: z.string().optional(),
      quality_profile: z.enum(["standard", "showcase"]).optional(),
      visual_preset: z.enum(["classic", "signal-flow", "blueprint", "editorial"]).optional(),
      repository: z
        .object({
          url: z.url(),
          revision: z.string().regex(/^[a-fA-F0-9]{40}$/),
        })
        .optional(),
      views: z.array(viewSchema).max(5).optional(),
      viewBox: z.tuple([z.number(), z.number()]).optional(),
    }),
    layout: z
      .object({
        mode: z.literal("grid"),
        origin: pointSchema.optional(),
        cols: z.number().int().min(1).max(12).optional(),
        gapX: z.number().min(0).optional(),
        gapY: z.number().min(0).optional(),
        cellW: z.number().min(40).optional(),
        cellH: z.number().min(24).optional(),
      })
      .optional(),
    components: z.array(componentSchema).min(1).max(200),
    boundaries: z.array(boundarySchema).optional(),
    connections: z.array(connectionSchema).optional(),
    cards: z.array(cardSchema).optional(),
  })
  .superRefine((spec, ctx) => {
    const ids = new Set<string>()
    for (const component of spec.components) {
      if (ids.has(component.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["components"],
          message: `El componente "${component.id}" está repetido`,
        })
      }
      ids.add(component.id)
    }

    for (const [index, connection] of (spec.connections ?? []).entries()) {
      for (const end of ["from", "to"] as const) {
        if (!ids.has(connection[end])) {
          ctx.addIssue({
            code: "custom",
            path: ["connections", index, end],
            message: `La relación apunta a "${connection[end]}", que no es un componente del diagrama`,
          })
        }
      }
    }

    for (const [index, boundary] of (spec.boundaries ?? []).entries()) {
      for (const wrapped of boundary.wraps) {
        if (!ids.has(wrapped)) {
          ctx.addIssue({
            code: "custom",
            path: ["boundaries", index, "wraps"],
            message: `El límite "${boundary.label}" envuelve a "${wrapped}", que no es un componente del diagrama`,
          })
        }
      }
    }

    for (const [index, view] of (spec.meta.views ?? []).entries()) {
      for (const focus of view.focus) {
        if (!ids.has(focus)) {
          ctx.addIssue({
            code: "custom",
            path: ["meta", "views", index, "focus"],
            message: `La vista "${view.label}" enfoca "${focus}", que no es un componente del diagrama`,
          })
        }
      }
    }
  })

export type ArchitectureSpec = z.infer<typeof architectureSpecSchema>

export interface ParsedSpec {
  spec: ArchitectureSpec
  raw: unknown
}

export function parseSpec(value: unknown): ParsedSpec {
  const raw = typeof value === "string" ? JSON.parse(value) : value
  const parsed = architectureSpecSchema.safeParse(raw)

  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "spec"}: ${issue.message}`)
      .join("; ")
    throw new Error(
      `La especificación no cumple el esquema architecture de archify. ${detail}. Corrígela y valídala con \`node bin/archify.mjs validate architecture <spec>.json --quality showcase --json\` antes de volver a publicar`
    )
  }

  return { spec: parsed.data, raw }
}
