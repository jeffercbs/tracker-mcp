export const WORKFLOW_PROMPT_VERSION = 1

export type WorkflowAction =
  | "start"
  | "pick_issues"
  | "read_context"
  | "plan"
  | "implement"
  | "write_tests"
  | "run_command"
  | "validate_url"
  | "code_review"
  | "publish_changes"
  | "comment"
  | "notify"
  | "update_fields"
  | "set_status"
  | "document_note"
  | "decision"
  | "human_review"
  | "wait"
  | "custom"
  | "end"

export type WorkflowEdgeCondition = "always" | "ok" | "fail" | "custom"

export interface WorkflowNode {
  id: string
  action: WorkflowAction
  label: string
  roleId: string | null
  requiresConfirmation: boolean
  optional?: boolean
  color?: string | null
  icon?: string | null
  instructions: string
  position: { x: number; y: number }
  config: Record<string, any>
}

export interface WorkflowEdge {
  id: string
  source: string
  target: string
  condition: WorkflowEdgeCondition
  label: string
}

export interface WorkflowSpec {
  schemaVersion: number
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

export interface WorkflowPromptRole {
  id: string
  name: string
  title: string
  instructions: string
  techStack: string[]
}

export interface WorkflowNamedItem {
  id: string
  name: string
}

export interface WorkflowPromptContext {
  workspaceSlug: string
  projectKey: string
  projectName: string
  roles: WorkflowPromptRole[]
  statuses: Array<WorkflowNamedItem & { category: string }>
  modules: WorkflowNamedItem[]
  labels: WorkflowNamedItem[]
}

const ACTION_LABEL: Record<WorkflowAction, string> = {
  start: "Inicio",
  pick_issues: "Tomar incidencias",
  read_context: "Reunir contexto",
  plan: "Planificar",
  implement: "Implementar",
  write_tests: "Escribir pruebas",
  run_command: "Ejecutar un comando",
  validate_url: "Validar en una URL",
  code_review: "Revisar el cambio",
  publish_changes: "Publicar cambios",
  comment: "Comentar",
  notify: "Avisar al equipo",
  update_fields: "Actualizar la incidencia",
  set_status: "Cambiar de estado",
  document_note: "Documentar en una nota",
  decision: "Decisión",
  human_review: "Revisión humana",
  wait: "Esperar",
  custom: "Paso libre",
  end: "Fin",
}

const CONTEXT_SOURCE_LABEL: Record<string, string> = {
  architecture: "Arquitectura del proyecto",
  notes: "Notas del proyecto",
  skills: "Skills del proyecto",
  related_issues: "Incidencias relacionadas",
  repository: "Código del repositorio",
}

const PLAN_DELIVERABLE_LABEL: Record<string, string> = {
  steps: "Lista de pasos",
  proposal: "Propuesta técnica",
  estimate: "Estimación de esfuerzo",
}

const REVIEW_FOCUS_LABEL: Record<string, string> = {
  correctness: "Que haga lo que dice",
  regressions: "Regresiones",
  security: "Seguridad",
  performance: "Rendimiento",
  accessibility: "Accesibilidad",
  style: "Estilo del proyecto",
  tests: "Cobertura de pruebas",
}

const COMMIT_STYLE_LABEL: Record<string, string> = {
  conventional: "Conventional commits",
  free: "Texto libre",
}

const NOTIFY_CHANNEL_LABEL: Record<string, string> = {
  issue_comment: "Comentario en la incidencia",
  summary: "Resumen al terminar",
  mention: "Mención a una persona",
}

const COMMAND_EXPECTATION_LABEL: Record<string, string> = {
  must_pass: "Tiene que pasar",
  report: "Solo informar del resultado",
}

const CONDITION_LABEL: Record<WorkflowEdgeCondition, string> = {
  always: "siempre",
  ok: "si sale bien",
  fail: "si falla",
  custom: "si se cumple",
}

const PRIORITY_LABEL: Record<string, string> = {
  none: "sin prioridad",
  low: "baja",
  medium: "media",
  high: "alta",
  urgent: "urgente",
}

const ORDER_LABEL: Record<string, string> = {
  priority: "de más urgente a menos",
  oldest: "de la más antigua a la más reciente",
  number: "por número de incidencia",
}

const MISSING = "(eliminado del proyecto)"

export function parseWorkflowSpec(value: unknown): WorkflowSpec | null {
  if (!value || typeof value !== "object") {
    return null
  }
  const spec = value as WorkflowSpec
  if (!Array.isArray(spec.nodes) || !Array.isArray(spec.edges)) {
    return null
  }
  return spec
}

function resolveNames(ids: string[] | undefined, source: WorkflowNamedItem[]) {
  const list = ids ?? []
  const byId = new Map(source.map((item) => [item.id, item.name]))
  const ordered = source.filter((item) => list.includes(item.id)).map((item) => item.name)
  const missing = list.filter((id) => !byId.has(id))
  return [...ordered, ...missing.map(() => MISSING)]
}

function quoted(names: string[]) {
  return names.map((name) => `"${name}"`).join(", ")
}

function orderNodes(spec: WorkflowSpec): WorkflowNode[] {
  const byId = new Map(spec.nodes.map((node) => [node.id, node]))
  const outgoing = new Map<string, WorkflowEdge[]>()
  for (const edge of spec.edges) {
    const list = outgoing.get(edge.source) ?? []
    list.push(edge)
    outgoing.set(edge.source, list)
  }

  const start = spec.nodes.find((node) => node.action === "start")
  const ordered: WorkflowNode[] = []
  const seen = new Set<string>()
  const queue = start ? [start.id] : []

  while (queue.length > 0) {
    const id = queue.shift() as string
    if (seen.has(id)) continue
    seen.add(id)
    const node = byId.get(id)
    if (node) ordered.push(node)

    const next = [...(outgoing.get(id) ?? [])].sort((a, b) => {
      const nodeA = byId.get(a.target)
      const nodeB = byId.get(b.target)
      return (
        (nodeA?.position.y ?? 0) - (nodeB?.position.y ?? 0) ||
        (nodeA?.position.x ?? 0) - (nodeB?.position.x ?? 0) ||
        a.target.localeCompare(b.target)
      )
    })
    for (const edge of next) {
      queue.push(edge.target)
    }
  }

  for (const node of spec.nodes) {
    if (!seen.has(node.id)) ordered.push(node)
  }

  return ordered
}

function stepLines(
  node: WorkflowNode,
  context: WorkflowPromptContext,
  role: WorkflowPromptRole | null
) {
  const lines: string[] = []
  lines.push(`- Acción: ${ACTION_LABEL[node.action] ?? node.action}`)
  if (role) {
    lines.push(`- Rol: ${role.title}`)
  }

  if (node.action === "pick_issues") {
    const statuses = resolveNames(node.config.statusIds, context.statuses)
    const modules = resolveNames(node.config.moduleIds, context.modules)
    const labels = resolveNames(node.config.labelIds, context.labels)
    const priorities: string[] = node.config.priorities ?? []

    if (statuses.length > 0) lines.push(`- Estados: ${quoted(statuses)}`)
    if (priorities.length > 0) {
      lines.push(
        `- Prioridades: ${priorities.map((value) => PRIORITY_LABEL[value] ?? value).join(", ")}`
      )
    }
    if (modules.length > 0) lines.push(`- Módulos: ${quoted(modules)}`)
    if (labels.length > 0) lines.push(`- Etiquetas: ${quoted(labels)}`)
    lines.push(
      `- Cuántas: como mucho ${node.config.limit ?? 3}, ${ORDER_LABEL[node.config.order ?? "priority"]}`
    )
    lines.push(
      `- Cómo: \`list_issues\` sobre ${context.projectKey} con esos filtros; trabaja de una en una.`
    )
  }

  if (node.action === "implement") {
    if (node.config.scope?.trim()) lines.push(`- Alcance: ${node.config.scope.trim()}`)
    if (node.config.documentResolution !== false) {
      lines.push(
        "- Al terminar documenta la incidencia con `update_issue`: qué causaba el problema, qué cambiaste y cómo lo verificaste."
      )
    }
  }

  if (node.action === "validate_url") {
    lines.push(`- URL: ${node.config.url?.trim() || MISSING}`)
    const checks: string[] = node.config.checks ?? []
    if (checks.length > 0) {
      lines.push("- Comprueba:")
      for (const check of checks) {
        lines.push(`  - ${check}`)
      }
    }
    if (node.config.evidence === "screenshot") {
      lines.push(
        "- Deja constancia con una captura como evidencia de la solución (`add_issue_attachment` solo si te lo piden)."
      )
    }
    if (node.config.evidence === "text") {
      lines.push("- Deja constancia por escrito de lo que probaste y del resultado.")
    }
  }

  if (node.action === "comment") {
    if (node.config.template?.trim()) {
      lines.push(`- Comentario: ${node.config.template.trim()}`)
    }
    lines.push("- Cómo: `add_issue_comment`.")
  }

  if (node.action === "set_status") {
    const status = context.statuses.find((item) => item.id === node.config.statusId)
    lines.push(`- Estado destino: "${status?.name ?? MISSING}"`)
    if (node.config.comment?.trim()) {
      lines.push(`- Comenta al moverla: ${node.config.comment.trim()}`)
    }
    lines.push("- Cómo: `update_issue` con ese estado.")
  }

  if (node.action === "human_review") {
    lines.push(`- Pregunta: ${node.config.question?.trim() || "¿Seguimos?"}`)
    lines.push("- Para aquí y espera respuesta antes de continuar.")
  }

  if (node.action === "read_context") {
    const sources: string[] = node.config.sources ?? []
    if (sources.length > 0) {
      lines.push(`- Lee: ${sources.map((value) => CONTEXT_SOURCE_LABEL[value] ?? value).join(", ")}`)
    }
    if (sources.includes("architecture")) {
      lines.push("- Cómo: `get_project_architecture` sobre este proyecto.")
    }
    if (sources.includes("notes")) {
      lines.push("- Cómo: `list_notes` y `get_note` para las que vengan al caso.")
    }
    if (sources.includes("skills")) {
      lines.push("- Cómo: `list_project_skills` y `get_project_skill`.")
    }
    if (sources.includes("related_issues")) {
      lines.push("- Cómo: `list_issues` buscando incidencias parecidas ya resueltas.")
    }
    if (node.config.focus?.trim()) {
      lines.push(`- Busca sobre todo: ${node.config.focus.trim()}`)
    }
    lines.push("- No empieces a cambiar código hasta terminar de leer.")
  }

  if (node.action === "plan") {
    const deliverable = node.config.deliverable ?? "steps"
    lines.push(`- Entrega: ${PLAN_DELIVERABLE_LABEL[deliverable] ?? deliverable}`)
    if (node.config.notes?.trim()) {
      lines.push(`- Ten en cuenta: ${node.config.notes.trim()}`)
    }
    if (node.config.requireApproval) {
      lines.push("- **No empieces a implementar hasta que el plan tenga el visto bueno.**")
    }
  }

  if (node.action === "write_tests") {
    if (node.config.framework?.trim()) {
      lines.push(`- Framework: ${node.config.framework.trim()}`)
    }
    if (node.config.target?.trim()) {
      lines.push(`- Qué hay que cubrir: ${node.config.target.trim()}`)
    }
    lines.push(
      node.config.mustPass !== false
        ? "- Las pruebas tienen que pasar antes de seguir."
        : "- Deja escrito el resultado aunque alguna prueba falle."
    )
  }

  if (node.action === "run_command") {
    lines.push(`- Comando: \`${node.config.command?.trim() || MISSING}\``)
    if (node.config.workingDirectory?.trim()) {
      lines.push(`- Desde: ${node.config.workingDirectory.trim()}`)
    }
    const expectation = node.config.expectation ?? "must_pass"
    lines.push(`- Resultado: ${COMMAND_EXPECTATION_LABEL[expectation] ?? expectation}`)
    if (node.config.onFailure?.trim()) {
      lines.push(`- Si falla: ${node.config.onFailure.trim()}`)
    }
  }

  if (node.action === "code_review") {
    const focus: string[] = node.config.focus ?? []
    if (focus.length > 0) {
      lines.push("- Fíjate en:")
      for (const item of focus) {
        lines.push(`  - ${REVIEW_FOCUS_LABEL[item] ?? item}`)
      }
    }
    if (node.config.notes?.trim()) {
      lines.push(`- Además: ${node.config.notes.trim()}`)
    }
    lines.push(
      node.config.blocking !== false
        ? "- Arregla lo que encuentres antes de continuar."
        : "- Anota lo que encuentres aunque no lo arregles ahora."
    )
  }

  if (node.action === "publish_changes") {
    if (node.config.branchPattern?.trim()) {
      lines.push(`- Rama: ${node.config.branchPattern.trim()}`)
    }
    const style = node.config.commitStyle ?? "conventional"
    lines.push(`- Mensajes de commit: ${COMMIT_STYLE_LABEL[style] ?? style}`)
    if (node.config.openPullRequest) {
      lines.push("- Abre un pull request con el resumen del cambio y la incidencia que resuelve.")
    }
    if (node.config.reviewers?.trim()) {
      lines.push(`- Revisores: ${node.config.reviewers.trim()}`)
    }
    lines.push("- No publiques nada si algún paso anterior quedó en rojo.")
  }

  if (node.action === "notify") {
    const channel = node.config.channel ?? "issue_comment"
    lines.push(`- Canal: ${NOTIFY_CHANNEL_LABEL[channel] ?? channel}`)
    if (node.config.audience?.trim()) {
      lines.push(`- Para: ${node.config.audience.trim()}`)
    }
    if (node.config.message?.trim()) {
      lines.push(`- Mensaje: ${node.config.message.trim()}`)
    }
    if (channel === "issue_comment") {
      lines.push("- Cómo: `add_issue_comment`.")
    }
  }

  if (node.action === "update_fields") {
    if (node.config.priority) {
      lines.push(
        `- Prioridad: ${PRIORITY_LABEL[node.config.priority] ?? node.config.priority}`
      )
    }
    if (node.config.moduleId) {
      const module = context.modules.find((item) => item.id === node.config.moduleId)
      lines.push(`- Módulo: "${module?.name ?? MISSING}"`)
    }
    const added = resolveNames(node.config.addLabelIds, context.labels)
    if (added.length > 0) {
      lines.push(`- Añade las etiquetas: ${quoted(added)}`)
    }
    const removed = resolveNames(node.config.removeLabelIds, context.labels)
    if (removed.length > 0) {
      lines.push(`- Quita las etiquetas: ${quoted(removed)}`)
    }
    lines.push("- Cómo: `update_issue` con esos campos; no toques los demás.")
  }

  if (node.action === "document_note") {
    lines.push(`- Título de la nota: "${node.config.title?.trim() || MISSING}"`)
    if (node.config.outline?.trim()) {
      lines.push(`- Qué tiene que contar: ${node.config.outline.trim()}`)
    }
    lines.push(
      "- Cómo: `create_note` si el equipo la pidió en este paso; si ya existe una nota para esto, actualízala con `update_note` en vez de crear otra."
    )
  }

  if (node.action === "decision") {
    lines.push(`- Decide: ${node.config.question?.trim() || MISSING}`)
    const options: string[] = node.config.options ?? []
    if (options.length > 0) {
      lines.push("- Opciones:")
      for (const option of options) {
        lines.push(`  - ${option}`)
      }
    }
    lines.push("- Di en voz alta por qué camino tiras y por qué antes de seguir.")
  }

  if (node.action === "wait") {
    lines.push(`- Espera a: ${node.config.until?.trim() || MISSING}`)
    if (node.config.maxWait?.trim()) {
      lines.push(`- Como mucho: ${node.config.maxWait.trim()}`)
    }
    lines.push("- No sigas por tu cuenta si eso no llega: dilo y para.")
  }

  if (node.instructions?.trim()) {
    lines.push(`- Además: ${node.instructions.trim()}`)
  }

  if (node.optional) {
    lines.push("- Este paso es opcional: sáltalo si no aplica, pero di que lo saltaste y por qué.")
  }

  if (node.requiresConfirmation && node.action !== "human_review") {
    lines.push("- **Para antes de continuar y pide confirmación a una persona.**")
  }

  return lines
}

export function renderWorkflowPrompt(
  workflow: { title: string; description: string; spec: WorkflowSpec },
  context: WorkflowPromptContext
): string {
  const ordered = orderNodes(workflow.spec).filter((node) => node.action !== "start")
  const positions = new Map(ordered.map((node, index) => [node.id, index + 1]))
  const rolesById = new Map(context.roles.map((role) => [role.id, role]))
  const usedRoles = context.roles.filter((role) =>
    workflow.spec.nodes.some((node) => node.roleId === role.id)
  )

  const lines: string[] = []

  lines.push(`# Flujo: ${workflow.title}`)
  lines.push("")
  lines.push(
    `Proyecto ${context.projectKey} · ${context.projectName} · workspace ${context.workspaceSlug}`
  )
  if (workflow.description.trim()) {
    lines.push("")
    lines.push(workflow.description.trim())
  }

  lines.push("")
  lines.push("## Cómo se usa")
  lines.push("")
  lines.push(
    "Sigue los pasos en el orden en que están escritos, sin saltártelos ni reordenarlos. Trabaja con las tools de my-tracker sobre este proyecto y no crees nada que no te hayan pedido: actualizar la incidencia en la que trabajas sí entra en el encargo, abrir incidencias, etiquetas o notas nuevas no."
  )

  if (usedRoles.length > 0) {
    lines.push("")
    lines.push("## Roles")
    for (const role of usedRoles) {
      lines.push("")
      lines.push(`### ${role.title}`)
      if (role.techStack.length > 0) {
        lines.push("")
        lines.push(`Tecnologías: ${role.techStack.join(", ")}`)
      }
      if (role.instructions.trim()) {
        lines.push("")
        lines.push(role.instructions.trim())
      }
    }
  }

  lines.push("")
  lines.push("## Pasos")

  const outgoing = new Map<string, WorkflowEdge[]>()
  for (const edge of workflow.spec.edges) {
    const list = outgoing.get(edge.source) ?? []
    list.push(edge)
    outgoing.set(edge.source, list)
  }

  const startNode = workflow.spec.nodes.find((node) => node.action === "start")
  if (startNode) {
    const first = (outgoing.get(startNode.id) ?? [])
      .map((edge) => positions.get(edge.target))
      .filter((value): value is number => value !== undefined)
    if (first.length > 0) {
      lines.push("")
      lines.push(`Empieza por el paso ${first[0]}.`)
    }
  }

  for (const node of ordered) {
    const index = positions.get(node.id)
    lines.push("")
    lines.push(`### ${index}. ${node.label}`)
    lines.push("")
    for (const line of stepLines(node, context, rolesById.get(node.roleId ?? "") ?? null)) {
      lines.push(line)
    }

    const next = outgoing.get(node.id) ?? []
    if (next.length === 0) {
      lines.push("- Siguiente: fin del flujo.")
    } else {
      const parts = next.map((edge) => {
        const target = positions.get(edge.target)
        const destination = target ? `paso ${target}` : "fin del flujo"
        const condition =
          edge.condition === "custom" ? edge.label.trim() : CONDITION_LABEL[edge.condition]
        return edge.condition === "always" ? destination : `${destination} ${condition}`
      })
      lines.push(`- Siguiente: ${parts.join("; ")}.`)
    }
  }

  lines.push("")
  lines.push("## Estados del proyecto")
  lines.push("")
  lines.push("| Estado | Categoría |")
  lines.push("| --- | --- |")
  for (const status of context.statuses) {
    lines.push(`| ${status.name} | ${status.category} |`)
  }

  lines.push("")
  lines.push("## Límites")
  lines.push("")
  lines.push("- No cierres una incidencia sin dejar documentado qué la causaba y cómo se resolvió.")
  lines.push("- No inventes estados, módulos ni etiquetas: usa los que existen en el proyecto.")
  lines.push("- Si un paso pide confirmación, para y pregunta; no sigas por tu cuenta.")

  const broken = ordered.some((node) => {
    if (node.action === "set_status") {
      return !context.statuses.some((status) => status.id === node.config.statusId)
    }
    if (node.action === "pick_issues") {
      return (node.config.statusIds ?? []).some(
        (id: string) => !context.statuses.some((status) => status.id === id)
      )
    }
    return false
  })
  if (broken) {
    lines.push(
      "- Este flujo apunta a algo que ya no existe en el proyecto: avísalo antes de seguir."
    )
  }

  return `${lines.join("\n")}\n`
}

export function workflowSkillName(name: string) {
  return `flujo-${name}`.slice(0, 64).replace(/-+$/, "")
}

export function workflowSkillPath(name: string, root = ".claude") {
  return `${root}/skills/${workflowSkillName(name)}/SKILL.md`
}

export function renderWorkflowSkill(
  workflow: { name: string; title: string; description: string },
  prompt: string
) {
  const description =
    workflow.description.trim() ||
    `Flujo de trabajo "${workflow.title}" definido por el equipo en my-tracker.`

  return [
    "---",
    `name: ${workflowSkillName(workflow.name)}`,
    `description: ${JSON.stringify(description)}`,
    "---",
    "",
    prompt.trim(),
    "",
  ].join("\n")
}
