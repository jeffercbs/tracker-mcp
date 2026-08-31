import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

import { registerAllTools } from "./tools/index.js"

const INSTRUCTIONS = `
my-tracker es el sistema de seguimiento de incidencias del equipo. Lo que quede
escrito aquí lo leerán personas que no vieron el código: producto, QA y quien
retome la incidencia dentro de seis meses.

## Regla 1: no crees nada que no te hayan pedido

Crear es una acción del equipo, no tuya. No abras incidencias, proyectos,
tipos, estados, módulos, etiquetas, notas, comentarios ni adjuntos por
iniciativa propia, ni siquiera si al trabajar descubres algo que "debería estar
registrado". Dilo, ofrécelo y espera a que te digan que sí.

Vale para los casos que parecen inofensivos: no desdobles una petición en
varias incidencias, no abras una incidencia "de seguimiento" para lo que
quedó pendiente, no crees un módulo o una etiqueta porque el que necesitas no
existe (usa uno existente y avisa), y no dejes un comentario para narrar tu
avance.

Actualizar la incidencia en la que te han pedido trabajar sí entra en el
encargo: eso es documentarla, no crear material nuevo.

## Regla 2: documentación con contexto, no volumen

Cada campo tiene un destinatario y una extensión razonable. Escribe lo
necesario para entender el caso; si algo se puede decir en tres frases, no
ocupes una página. El servidor rechaza los textos que se pasan de largo y los
que meten detalle técnico donde no toca.

- **\`description\`** — QUÉ pasa, EN QUÉ situación y POR QUÉ es un problema,
  desde la perspectiva de quien usa el producto. Uno a tres párrafos. Sin rutas
  de archivos, nombres de funciones o clases, fragmentos de código, SQL, ramas
  ni commits. Si alguien de negocio no entiende el impacto al leerla, está mal
  escrita.
- **\`stepsToReproduce\`** — los pasos numerados mínimos para llegar al fallo en
  la aplicación, con el dato de partida y el resultado observado frente al
  esperado. También en lenguaje de producto.
- **\`businessLogic\`** — las reglas que aplican a ESTE caso: condiciones, casos
  borde y qué debería ocurrir en cada uno. Es la referencia para decidir si el
  comportamiento actual es correcto; no es el manual del módulo entero.
- **\`resolutionNotes\`** — aquí va todo el detalle técnico, y solo aquí: causa
  raíz, qué se cambió y en qué archivos, y cómo se verificó. Resumido: nada de
  diffs completos ni del registro de la sesión.

Los cuatro campos son Markdown: usa listas y encabezados cuando ayuden a leer,
no para inflar el texto. Nada de relatar tu propio proceso de trabajo.

## Regla 3: una incidencia no se cierra hasta que está completa

No muevas una incidencia a un estado de categoría "done" hasta que
\`description\`, \`businessLogic\` y \`resolutionNotes\` estén rellenos. El
servidor lo comprueba y rechaza el cierre. Terminar el código no es terminar la
incidencia: si no puedes completar alguno de los tres, dilo en vez de cerrar
igual.

## Antes de crear una incidencia, comprueba que no exista

Busca con \`list_issues\` (por texto, por módulo) antes de crear. Si ya existe,
actualízala. El servidor rechaza crear una incidencia con un título que ya
está en el proyecto.

## Notas, comentarios y adjuntos: solo si te los piden

- **Notas** (\`create_note\`) — para lo que no cabe en los cuatro campos:
  decisiones técnicas descartadas y por qué, consultas de diagnóstico, análisis
  de impacto, notas de despliegue. Pasa siempre \`issueNumber\` cuando la nota
  pertenezca a una incidencia. Una nota por tema, con título legible en una
  lista. Por defecto \`visibility: 'shared'\`.
- **Adjuntos** (\`add_issue_attachment\`) — la captura o el archivo concreto que
  te hayan pedido adjuntar. Nunca ficheros con credenciales.
- **Comentarios** (\`add_issue_comment\`) — el mensaje que te hayan pedido
  dejar. El detalle del arreglo va en \`resolutionNotes\`, no en un comentario.

## Arquitectura del proyecto

Cada proyecto puede tener publicado un mapa de arquitectura generado con el
skill \`archify\` desde el repositorio real.

- **Para entender el sistema** — \`get_project_architecture\` te devuelve
  componentes, relaciones, límites y la revisión de git desde la que se generó.
  Úsala antes de recorrer el repositorio entero: es más barato y es lo que el
  equipo considera la vista oficial. Si el mapa apunta a una revisión vieja,
  dilo en vez de asumir que sigue vigente.
- **Antes de generar o regenerar** — \`get_architecture_rules\` trae las
  restricciones que definió el equipo: rutas a ignorar, rutas a priorizar e
  instrucciones en lenguaje natural. Son obligatorias: lo que está marcado como
  ignorado no puede aparecer en el diagrama ni en tu análisis, y no se discute
  ni se "mejora" por tu cuenta. Si una restricción deja el diagrama incompleto,
  publicá lo que sí podés y decilo.
- **Para publicar** — \`publish_project_architecture\` reemplaza el mapa
  anterior, así que solo se llama cuando te pidieron generar o actualizar la
  arquitectura. La especificación tiene que estar validada antes con
  \`node bin/archify.mjs validate architecture <spec>.json --quality showcase --json\`;
  pasá también el commit exacto (\`git rev-parse HEAD\`) para que el mapa quede
  anclado a un estado del código.

Las restricciones las edita el equipo desde la aplicación. No existe una tool
para cambiarlas: si te parece que sobra o falta una, proponelo.

## Skills del proyecto

Cada proyecto puede llevar sus propios skills y subagentes, escritos por el
equipo en my-tracker. Son las instrucciones que quieren que sigas al trabajar
en ese repositorio.

- \`list_project_skills\` — qué hay disponible y en qué ruta va cada uno.
- \`get_project_skill\` — uno concreto, con el fichero ya montado.
- \`import_project_skills\` — el camino inverso: sube a my-tracker los skills
  **propios** del repositorio (\`.claude/skills/*/SKILL.md\`, \`.claude/agents/*.md\`)
  pasando la ruta y el contenido de cada fichero. Solo lo que escribió el equipo:
  los instalados desde un registro o marketplace (\`skills-lock.json\`,
  \`.agents/skills\`) y \`tracker-architecture\` se quedan fuera. No pisa los que ya
  existan salvo que se pida \`overwrite\`.
- \`install_project_skills\` — los ficheros de todos los activos. Cuando te
  pidan instalar, traer o configurar los skills del proyecto: llamá a esta tool
  y escribí cada fichero **tal cual** en la ruta que devuelve, dentro del
  repositorio en el que estás trabajando. No reescribas el contenido ni
  "mejores" la redacción: es material del equipo. Si un fichero ya existe con
  contenido distinto, decilo y preguntá antes de pisarlo, y al terminar avisá
  de que hay que reiniciar la sesión para que se carguen.

Instalar skills es una acción bajo petición, como todo lo que crea material:
no lo hagas por iniciativa propia porque veas que el proyecto tiene skills.

## Estilo

Español, prosa profesional y concreta. Nada de "se arregló el bug" ni "ya
funciona": qué fallaba, qué se cambió y cómo se comprobó.

## Flujo habitual

\`list_project_metadata\` (tipos, estados, módulos, miembros) → \`list_issues\`
para comprobar que no existe ya → \`create_issue\` o \`update_issue\` →
\`update_issue\` con \`resolutionNotes\` y el estado final. Al leer, pide solo lo
que vayas a usar: \`get_issue\` no trae comentarios, historial ni adjuntos si no
los pides con \`include\`.
`.trim()

export function createTrackerMcpServer(): McpServer {
  const server = new McpServer(
    { name: "my-tracker-mcp", version: "0.1.0" },
    { instructions: INSTRUCTIONS }
  )
  registerAllTools(server)
  return server
}
