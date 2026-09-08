import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, relative, resolve } from "node:path"

import type { ProjectSkillDTO } from "../repositories/skills.js"
import { assertSkillName } from "./skill-name.js"

export interface SkillFile {
  name: string
  kind: string
  path: string
  content: string
}

export interface SkillWriteResult extends SkillFile {
  written: boolean
  unchanged: boolean
  conflict: boolean
}

export function skillFilePath(skill: ProjectSkillDTO, root = ".claude"): string {
  assertSkillName(skill.name)
  return skill.kind === "agent"
    ? `${root}/agents/${skill.name}.md`
    : `${root}/skills/${skill.name}/SKILL.md`
}

function frontmatterValue(value: string): string {
  const trimmed = value.replace(/\r?\n/g, " ").trim()
  return /^[\w][\w .,;:()/+-]*$/.test(trimmed) ? trimmed : JSON.stringify(trimmed)
}

export function renderSkillMarkdown(skill: ProjectSkillDTO): string {
  const lines = ["---", `name: ${frontmatterValue(assertSkillName(skill.name))}`]

  if (skill.description.trim()) {
    lines.push(`description: ${frontmatterValue(skill.description)}`)
  }

  if (skill.kind === "agent") {
    if (skill.allowedTools.trim()) {
      lines.push(`tools: ${frontmatterValue(skill.allowedTools)}`)
    }
    if (skill.model?.trim()) {
      lines.push(`model: ${frontmatterValue(skill.model)}`)
    }
  } else {
    if (skill.allowedTools.trim()) {
      lines.push(`allowed-tools: ${frontmatterValue(skill.allowedTools)}`)
    }
    if (!skill.userInvocable) {
      lines.push("user-invocable: false")
    }
  }

  lines.push("---", "")

  const body = skill.content.trim()
  return `${lines.join("\n")}${body ? `${body}\n` : ""}`
}

export function toSkillFiles(skills: ProjectSkillDTO[], root = ".claude"): SkillFile[] {
  return skills.map((skill) => ({
    name: skill.name,
    kind: skill.kind,
    path: skillFilePath(skill, root),
    content: renderSkillMarkdown(skill),
  }))
}

export function writeSkillFiles(
  files: SkillFile[],
  directory: string,
  force = false
): SkillWriteResult[] {
  const root = resolve(directory)

  return files.map((file) => {
    assertSkillName(file.name)
    const absolute = resolve(root, ...file.path.split("/"))
    const inside = relative(root, absolute)
    if (inside.startsWith("..") || isAbsolute(inside)) {
      throw new Error(`La ruta del skill "${file.name}" se sale del directorio de destino`)
    }

    if (existsSync(absolute)) {
      const current = readFileSync(absolute, "utf8")
      if (current === file.content) {
        return { ...file, written: false, unchanged: true, conflict: false }
      }
      if (!force) {
        return { ...file, written: false, unchanged: false, conflict: true }
      }
    }

    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, file.content, "utf8")
    return { ...file, written: true, unchanged: false, conflict: false }
  })
}
