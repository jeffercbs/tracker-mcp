export const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

export function isValidSkillName(name: string): boolean {
  return SKILL_NAME_PATTERN.test(name)
}

export function assertSkillName(name: string): string {
  if (!isValidSkillName(name)) {
    throw new Error(
      `El skill "${name}" tiene un nombre que no se puede usar como ruta. Solo se admiten minúsculas, números y guiones. Corregilo en my-tracker antes de instalarlo.`
    )
  }
  return name
}
