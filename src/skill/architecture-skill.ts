export const SKILL_DIRECTORY = ".claude/skills/tracker-architecture"
export const SKILL_FILENAME = "SKILL.md"

export interface SkillContext {
  workspaceSlug: string
  projectKey: string
  projectName: string
  webUrl?: string | null
  ignoreGlobs: string[]
  focusGlobs: string[]
  notes: string
}

function rulesSnapshot(context: SkillContext): string {
  const lines: string[] = []

  if (context.ignoreGlobs.length > 0) {
    lines.push("Ignorar:")
    lines.push(...context.ignoreGlobs.map((glob) => `- \`${glob}\``))
  }
  if (context.focusGlobs.length > 0) {
    lines.push("", "Priorizar:")
    lines.push(...context.focusGlobs.map((glob) => `- \`${glob}\``))
  }
  if (context.notes.trim()) {
    lines.push("", "Instrucciones:", "", context.notes.trim())
  }

  if (lines.length === 0) {
    return "El equipo todavía no definió restricciones."
  }

  return lines.join("\n")
}

export function renderArchitectureSkill(context: SkillContext): string {
  const page = context.webUrl
    ? `${context.webUrl.replace(/\/$/, "")}/${context.workspaceSlug}/projects/${context.projectKey}/architecture`
    : `/${context.workspaceSlug}/projects/${context.projectKey}/architecture`

  return `---
name: tracker-architecture
description: Genera el mapa de arquitectura de este repositorio con archify y lo publica en my-tracker (workspace ${context.workspaceSlug}, proyecto ${context.projectKey}). Úsalo cuando pidan generar, regenerar o actualizar la arquitectura del proyecto, o cuando haga falta entender la topología del sistema antes de trabajar en una incidencia.
---

# Arquitectura de ${context.projectName}

Este repositorio publica su arquitectura en my-tracker:

| | |
|---|---|
| Workspace | \`${context.workspaceSlug}\` |
| Proyecto | \`${context.projectKey}\` |
| Página | ${page} |

Necesitas el servidor MCP \`my-tracker\` conectado y el skill \`archify\`
disponible. Si falta alguno, dilo y para: no improvises un diagrama a mano ni
publiques nada sin validar.

## Leer antes que escribir

Si te piden entender el sistema —no regenerarlo— llama a
\`get_project_architecture\` y trabaja con lo que devuelve. Trae componentes,
relaciones, límites y la revisión de git desde la que se generó. Es más barato
que recorrer el repositorio y es la vista que el equipo considera oficial.

Compara esa revisión con \`git rev-parse HEAD\`. Si el mapa es viejo, dilo en
vez de asumir que sigue vigente, y no lo regeneres por tu cuenta.

## Regenerar y publicar

Solo cuando te lo pidan explícitamente. Publicar reemplaza el mapa anterior.

1. **Restricciones.** Siempre primero:

   \`\`\`text
   get_architecture_rules(workspaceSlug: "${context.workspaceSlug}", projectKey: "${context.projectKey}")
   \`\`\`

   Son obligatorias. Lo marcado como ignorado no puede aparecer en el diagrama
   ni en tu análisis. No las "mejoras" ni las discutes: si dejan el mapa
   incompleto, publica lo que sí puedes y dilo.

2. **Recorre el repositorio** respetando esas rutas. Busca los límites reales:
   entradas HTTP, procesos en segundo plano, almacenes de datos, servicios
   externos y fronteras de confianza. No el árbol de carpetas.

3. **Autora la especificación** con el skill \`archify\`, tipo \`architecture\`,
   \`meta.quality_profile: "showcase"\`, un camino principal claro y como mucho
   12 componentes primarios. Tres campos importan especialmente aquí:

   - \`components[].sources\` — rutas reales del repositorio, con línea cuando
     aporte. my-tracker las convierte en enlaces al código.
   - \`meta.repository\` — \`{ url, revision }\` con el commit completo.
   - \`meta.views\` — hasta cinco vistas guiadas; se muestran como filtros.

4. **Valida.** Sin excepción, antes de publicar:

   \`\`\`bash
   node bin/archify.mjs validate architecture spec.json --quality showcase --json
   \`\`\`

   Un exit distinto de cero nunca es un éxito. Repara solo lo diagnosticado.

5. **Publica:**

   \`\`\`text
   publish_project_architecture(
     workspaceSlug: "${context.workspaceSlug}",
     projectKey: "${context.projectKey}",
     spec: <el JSON validado>,
     summary: "<qué muestra y qué quedó fuera>",
     sourceRevision: "<git rev-parse HEAD>",
     sourceBranch: "<git rev-parse --abbrev-ref HEAD>"
   )
   \`\`\`

## Qué dibuja my-tracker

El visor lee el JSON-IR con React Flow, no el HTML de archify. Usa
\`components\` (con \`type\`, \`label\`, \`sublabel\`, \`tag\`, \`sources\`,
\`pos\`/\`size\`), \`connections\` (con \`label\`, \`variant\`, \`fromSide\`/\`toSide\`),
\`boundaries\` y \`cards\`.

Ignora la geometría fina: \`via\`, \`labelAt\`, \`labelDx\`, \`labelDy\`,
\`labelSegment\`, \`brand\`, \`meta.animation\`, \`meta.visual_preset\` y
\`meta.legend\`. Puedes dejarlos —se guardan igual— pero no inviertas esfuerzo
ahí: inviértelo en que los tipos, las etiquetas y la evidencia sean correctos.

Solo se acepta el tipo \`architecture\`. Los demás tipos de archify (workflow,
sequence, dataflow, lifecycle) todavía no se dibujan en my-tracker.

## Restricciones al instalar este skill

Esto es una foto del momento en que se instaló, para que sepas qué esperar. La
fuente de verdad es \`get_architecture_rules\`, que las personas editan desde la
aplicación. **Consúltala igual cada vez.**

${rulesSnapshot(context)}
`
}
