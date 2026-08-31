import { z } from "zod"

export type ResponseFormat = "markdown" | "json"

/**
 * Parámetro compartido por todas las tools de lectura. El texto de la
 * respuesta cambia según el formato; `structuredContent` va siempre igual.
 */
export const formatArg = z
  .enum(["markdown", "json"])
  .optional()
  .describe(
    "Formato del texto de la respuesta: 'markdown' (por defecto, legible) o 'json' (el objeto crudo). Los datos estructurados se devuelven siempre, además, en structuredContent"
  )

interface OkOptions<T> {
  format?: ResponseFormat
  /** Renderizador Markdown. Si se omite, siempre se devuelve JSON. */
  markdown?: (data: T) => string
}

/**
 * Respuesta correcta de una tool. Devuelve el objeto en `structuredContent`
 * (para el cliente MCP que declare `outputSchema`) y su representación en
 * texto en `content`, en Markdown o en JSON según `format`.
 */
export function ok<T extends Record<string, unknown>>(data: T, options: OkOptions<T> = {}) {
  const text =
    options.markdown && options.format !== "json"
      ? options.markdown(data).trim()
      : JSON.stringify(data, null, 2)

  return {
    content: [{ type: "text" as const, text }],
    structuredContent: data,
  }
}

export function fail(err: unknown) {
  const message = err instanceof Error ? err.message : String(err)
  return { content: [{ type: "text" as const, text: message }], isError: true }
}

/* ------------------------------------------------------------------ *
 * Ayudas de formato Markdown
 * ------------------------------------------------------------------ */

type Cell = string | number | boolean | null | undefined

function cell(value: Cell): string {
  if (value === null || value === undefined || value === "") return "—"
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
}

/** Tabla Markdown. Si no hay filas, devuelve el aviso de vacío. */
export function mdTable(headers: string[], rows: Cell[][], empty = "Sin datos"): string {
  if (rows.length === 0) return mdEmpty(empty)
  const head = `| ${headers.join(" | ")} |`
  const sep = `| ${headers.map(() => "---").join(" | ")} |`
  const body = rows.map((row) => `| ${row.map(cell).join(" | ")} |`).join("\n")
  return `${head}\n${sep}\n${body}`
}

/** Lista de pares clave/valor: `- **Clave** — valor`. Omite los vacíos. */
export function mdFields(entries: [string, Cell][]): string {
  const lines = entries
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => `- **${key}** — ${cell(value)}`)
  return lines.length > 0 ? lines.join("\n") : mdEmpty("Sin datos")
}

export function mdSection(title: string, body: string, level = 2): string {
  return `${"#".repeat(level)} ${title}\n\n${body.trim()}`
}

export function mdEmpty(what: string): string {
  return `_${what}_`
}

/** Bloque de texto Markdown ya escrito por el usuario, o el aviso de vacío. */
export function mdBlock(value: string | null | undefined, empty: string): string {
  const text = (value ?? "").trim()
  return text.length > 0 ? text : mdEmpty(empty)
}

export function mdJoin(...parts: (string | null | undefined)[]): string {
  return parts.filter((part) => part && part.trim().length > 0).join("\n\n")
}
