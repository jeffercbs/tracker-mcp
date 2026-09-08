import { isValidSkillName } from "./skill-name.js"

export interface ParsedSkillFile {
  kind: "skill" | "agent"
  name: string
  title: string
  description: string
  content: string
  allowedTools: string
  model: string | null
  userInvocable: boolean
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

function unquote(value: string): string {
  const trimmed = value.trim()

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length > 1) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length > 1)
  ) {
    const inner = trimmed.slice(1, -1)
    return trimmed.startsWith('"') ? inner.replace(/\\"/g, '"').replace(/\\\\/g, "\\") : inner
  }

  return trimmed
}

function parseFrontmatter(block: string): Record<string, string> {
  const fields: Record<string, string> = {}

  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) {
      continue
    }

    const separator = line.indexOf(":")
    if (separator <= 0) {
      continue
    }

    fields[line.slice(0, separator).trim().toLowerCase()] = unquote(line.slice(separator + 1))
  }

  return fields
}

function kindFromPath(path: string): "skill" | "agent" {
  const normalized = path.replace(/\\/g, "/").toLowerCase()
  return normalized.includes("/agents/") ? "agent" : "skill"
}

function nameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, "/")
  const segments = normalized.split("/").filter(Boolean)
  const file = segments[segments.length - 1] ?? ""

  if (/^skill\.md$/i.test(file)) {
    return segments[segments.length - 2] ?? ""
  }

  return file.replace(/\.md$/i, "")
}

function titleFromBody(body: string, fallback: string): string {
  const heading = body.match(/^#\s+(.+)$/m)
  if (heading) {
    return heading[1].trim().slice(0, 120)
  }
  return fallback.slice(0, 120)
}

export function parseSkillFile(input: { path: string; content: string }): ParsedSkillFile {
  const match = input.content.match(FRONTMATTER)
  const fields = match ? parseFrontmatter(match[1]) : {}
  const body = match ? input.content.slice(match[0].length) : input.content

  const kind = fields.kind === "agent" ? "agent" : kindFromPath(input.path)
  const name = (fields.name || nameFromPath(input.path)).trim().toLowerCase()

  if (!isValidSkillName(name)) {
    throw new Error(
      `No se pudo deducir un nombre válido para "${input.path}". Añadí \`name:\` en el frontmatter, en minúsculas con guiones`
    )
  }

  const allowedTools = fields["allowed-tools"] ?? fields.tools ?? ""
  const userInvocable = (fields["user-invocable"] ?? "true").toLowerCase() !== "false"

  return {
    kind,
    name,
    title: fields.title ? fields.title.slice(0, 120) : titleFromBody(body, name),
    description: (fields.description ?? "").slice(0, 1024),
    content: body.trim(),
    allowedTools: allowedTools.slice(0, 1024),
    model: fields.model ? fields.model.slice(0, 60) : null,
    userInvocable,
  }
}
