import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

import { registerAllTools } from "./tools/index.js"

const INSTRUCTIONS = `
my-tracker es el sistema de seguimiento de incidencias del equipo. Lo que quede
escrito aquí lo leerán personas que no vieron el código: responsables de
producto, QA y quien retome la incidencia dentro de seis meses.

## Una incidencia no se cierra hasta que está completa

No muevas una incidencia a un estado de categoría "done" (ni "cancelled" con
trabajo hecho) hasta que TODO lo siguiente esté cumplido:

1. \`description\` explica el problema en términos de negocio.
2. \`businessLogic\` documenta las reglas y el comportamiento esperado.
3. \`resolutionNotes\` documenta la solución aplicada.
4. Hay evidencia adjunta cuando el problema o el arreglo son visuales
   (usa add_issue_attachment con la captura).

Si te falta cualquiera de esos puntos, deja la incidencia en progreso y
complétalo antes de cerrarla. Terminar el código no es terminar la incidencia.
Si no puedes completar alguno, dilo explícitamente en vez de cerrar igual.

## Dónde va cada cosa

- **\`description\`** — QUÉ pasa y POR QUÉ es un problema, desde la perspectiva
  de quien usa el producto. Sin rutas de archivos, sin nombres de funciones o
  clases, sin fragmentos de código, sin nombres de ramas o commits. Si al
  leerla alguien de negocio no entiende el impacto, está mal escrita.
- **\`stepsToReproduce\`** — pasos numerados que cualquiera pueda seguir en la
  aplicación para llegar al fallo. También en lenguaje de producto.
- **\`businessLogic\`** — la lógica de la incidencia: reglas de negocio,
  condiciones, casos borde, qué debería ocurrir en cada uno. Es la referencia
  que se consulta para decidir si el comportamiento actual es correcto.
- **\`resolutionNotes\`** — AQUÍ va todo el detalle técnico del arreglo, y solo
  aquí: causa raíz, qué se cambió, en qué archivos, y cómo se verificó que
  funciona. Es el único campo donde las referencias a código son bienvenidas.

Los cuatro campos se guardan en Markdown: usa encabezados, listas y bloques de
código donde ayuden a leer.

## Todo lo demás va como nota de la incidencia

Esos cuatro campos son fijos: no inventes secciones dentro de ellos para meter
cosas que no les corresponden. Cualquier otro material que haga falta se crea
con create_note pasando el \`issueNumber\`, de modo que quede colgando de la
incidencia y no suelto en el proyecto.

Úsalo, por ejemplo, para decisiones técnicas descartadas y por qué, consultas
SQL de diagnóstico, análisis de impacto, pendientes derivados, notas de
despliegue o del entorno, o contexto de una investigación que no cabe en la
solución. Una nota por tema, con un título que se entienda en una lista.

Por defecto \`visibility: 'shared'\`, para que el equipo las vea; reserva
'private' para lo que sea solo tuyo.

## Estilo

Escribe en español, en prosa profesional y concreta. Nada de "se arregló el
bug" ni "ya funciona": indica qué fallaba, qué se cambió y cómo se comprobó.
Evita el relato en primera persona de tu propio proceso.

## Flujo recomendado

list_project_metadata (tipos, estados, miembros disponibles) → create_issue o
update_issue → add_issue_attachment para la evidencia → create_note con
\`issueNumber\` para todo lo que no encaje en los cuatro campos → update_issue
con \`resolutionNotes\` y el estado final, en ese orden.
`.trim()

export function createTrackerMcpServer(): McpServer {
  const server = new McpServer(
    { name: "my-tracker-mcp", version: "0.1.0" },
    { instructions: INSTRUCTIONS }
  )
  registerAllTools(server)
  return server
}
