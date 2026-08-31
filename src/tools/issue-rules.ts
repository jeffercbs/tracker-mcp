export type IssueTextField =
  | "title"
  | "description"
  | "stepsToReproduce"
  | "businessLogic"
  | "resolutionNotes"

export interface IssueTextPatch {
  title?: string
  description?: string
  stepsToReproduce?: string
  businessLogic?: string
  resolutionNotes?: string
}

const FIELD_LABEL: Record<IssueTextField, string> = {
  title: "title",
  description: "description",
  stepsToReproduce: "stepsToReproduce",
  businessLogic: "businessLogic",
  resolutionNotes: "resolutionNotes",
}

const MAX_LENGTH: Record<IssueTextField, number> = {
  title: 140,
  description: 2500,
  stepsToReproduce: 2000,
  businessLogic: 5000,
  resolutionNotes: 8000,
}

const MIN_LENGTH: Partial<Record<IssueTextField, number>> = {
  title: 8,
  description: 40,
  resolutionNotes: 60,
}

const PLACEHOLDER = /^(n\/?a|pendiente|tbd|todo|sin (descripción|detalle)|ninguna?|-+|\.+)$/i

const CODE_SIGNALS: { pattern: RegExp; what: string }[] = [
  { pattern: /```/, what: "un bloque de código" },
  {
    pattern:
      /(^|[\s(«"'`])(\.{0,2}\/)?([\w.-]+\/)*[\w-]+\.(ts|tsx|js|jsx|mjs|cjs|py|java|cs|sql|ya?ml|php|rb|go|rs|vue|svelte|scss)\b/im,
    what: "una ruta o un nombre de archivo de código",
  },
  { pattern: /\b(commit|rama|branch)\s+[\w./-]*\b[0-9a-f]{7,40}\b/i, what: "una referencia a un commit o rama" },
  { pattern: /\b(SELECT|INSERT|UPDATE|DELETE)\s+[\w*]+\s+(FROM|INTO|SET|WHERE)\b/i, what: "una consulta SQL" },
  { pattern: /\b(?:const|let|var|function|class|import|export|return)\s+[A-Za-z_$][\w$]*\s*[=({]/, what: "código fuente" },
  { pattern: /\bnull pointer|stack trace|traceback \(most recent call last\)/i, what: "una traza de error" },
]

const CODE_HINTS: { pattern: RegExp; what: string }[] = [
  { pattern: /\b[A-Za-z_$][\w$]*\([^)\n]{0,60}\)/, what: "lo que parece una llamada a función" },
  { pattern: /\b[a-z]+[A-Z][\w]*\b/, what: "identificadores en camelCase" },
  { pattern: /<\/?[a-z][\w-]*(\s[^>]*)?>/i, what: "etiquetas de marcado" },
]

const PROCESS_NARRATION =
  /\b(he (revisado|analizado|implementado|procedido)|voy a (revisar|proceder|implementar)|como (agente|asistente|ia)|en esta (sesión|conversación)|el usuario me pid)/i

const EMPTY_RESOLUTION =
  /^(ya (funciona|está|quedó)|se (arregló|corrigió|solucionó)( el (bug|problema|error))?|listo|hecho|resuelto|corregido)[.!]?$/i

export class IssueRuleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "IssueRuleError"
  }
}

function fieldError(field: IssueTextField, problem: string, fix: string): IssueRuleError {
  return new IssueRuleError(`\`${FIELD_LABEL[field]}\`: ${problem} ${fix}`)
}

function checkLength(field: IssueTextField, value: string) {
  const text = value.trim()
  const max = MAX_LENGTH[field]
  if (text.length > max) {
    throw fieldError(
      field,
      `son ${text.length} caracteres y el máximo son ${max}.`,
      field === "resolutionNotes"
        ? "Resume: causa raíz, qué se cambió y cómo se verificó. El desarrollo largo va en una nota, si te la piden."
        : "Deja lo que hace falta para entender el caso y mueve el detalle técnico a `resolutionNotes`."
    )
  }

  const min = MIN_LENGTH[field]
  if (min !== undefined && text.length > 0 && text.length < min) {
    throw fieldError(
      field,
      `son solo ${text.length} caracteres.`,
      "Falta contexto: explica el caso concreto, no una frase genérica."
    )
  }

  if (PLACEHOLDER.test(text)) {
    throw fieldError(field, `"${text}" no documenta nada.`, "Escribe el contenido real o deja el campo vacío.")
  }
}

function checkProductLanguage(field: "description" | "stepsToReproduce", value: string): string[] {
  for (const signal of CODE_SIGNALS) {
    if (signal.pattern.test(value)) {
      throw fieldError(
        field,
        `contiene ${signal.what}.`,
        "Este campo lo lee producto y QA: describe el caso en lenguaje de negocio y pon el detalle técnico en `resolutionNotes`."
      )
    }
  }

  const warnings: string[] = []
  for (const hint of CODE_HINTS) {
    if (hint.pattern.test(value)) {
      warnings.push(
        `\`${FIELD_LABEL[field]}\` incluye ${hint.what}: comprueba que se entiende sin conocer el código.`
      )
    }
  }
  return warnings
}

export function validateIssueText(patch: IssueTextPatch): string[] {
  const warnings: string[] = []

  for (const [field, value] of Object.entries(patch) as [IssueTextField, string | undefined][]) {
    if (value === undefined) continue
    checkLength(field, value)

    if (field === "description" || field === "stepsToReproduce") {
      warnings.push(...checkProductLanguage(field, value))
    }

    if (PROCESS_NARRATION.test(value)) {
      warnings.push(
        `\`${FIELD_LABEL[field]}\` narra tu propio proceso de trabajo. Cuenta qué pasa en el producto, no qué hiciste tú.`
      )
    }
  }

  if (patch.resolutionNotes !== undefined && EMPTY_RESOLUTION.test(patch.resolutionNotes.trim())) {
    throw new IssueRuleError(
      "`resolutionNotes`: \"" +
        patch.resolutionNotes.trim() +
        '" no explica nada. Indica causa raíz, qué se cambió y cómo se verificó.'
    )
  }

  if (patch.description !== undefined && patch.businessLogic === undefined) {
    warnings.push(
      "Falta `businessLogic`: sin las reglas y el comportamiento esperado, nadie puede decidir después si el comportamiento actual es correcto."
    )
  }

  return warnings
}

export function requireDescriptionOnCreate(description: string | undefined) {
  if (!description || description.trim().length === 0) {
    throw new IssueRuleError(
      "`description` es obligatoria al crear una incidencia: explica QUÉ pasa y POR QUÉ es un problema, en lenguaje de producto."
    )
  }
}
