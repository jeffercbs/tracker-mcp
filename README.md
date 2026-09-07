# my-tracker-mcp

Servidor MCP (Model Context Protocol) que le da a un modelo acceso a **my-tracker**
—issues, proyectos y notas— actuando como el usuario que inició sesión, respetando
los mismos permisos de Supabase (RLS) que usa la app web. Es un proyecto aparte
del repo de `my-tracker`, que solo agrega dos endpoints/una página a esa app
para el login; el MCP en sí consulta la API de Supabase directamente con el
token del usuario.

## Cómo funciona la autenticación

En vez de pedirte el email/password directamente en la terminal, el login se
hace contra tu propio sitio (`my-tracker`), reusando la sesión que ya tengas
iniciada ahí (o pidiéndote que inicies sesión si no la tenés):

1. Corrés `npm run login`. Esto abre tu navegador en
   `https://<tu-sitio>/mcp/authorize?state=...&port=...`.
2. Si ya tenés sesión iniciada en el sitio, ves directamente una pantalla de
   "Autorizar my-tracker-mcp"; si no, el sitio te manda primero a su `/login`
   normal (con email/password) y después te trae de vuelta a esa pantalla.
3. Al apretar "Autorizar", el sitio genera un código de un solo uso (válido ~2
   minutos) y redirige tu navegador a `http://127.0.0.1:<puerto>/callback`,
   donde el CLI de login está escuchando localmente.
4. El CLI toma ese código y lo intercambia (`POST /api/mcp/exchange` en tu
   sitio) por un access token + refresh token reales de Supabase para tu
   usuario. El código de un solo uso nunca expone el token en la URL/historial
   del navegador — solo viaja el código, y el intercambio pasa por una
   petición HTTP directa entre el CLI y el servidor.
5. Esos tokens se guardan en `~/.my-tracker-mcp/session.json` (permisos
   `0600`). De ahí en más, cada tool del MCP arma un cliente de Supabase con
   tu JWT (refrescándolo cuando expira) y consulta la base directo: como es tu
   JWT real, las RLS policies (`is_workspace_member`, `workspace_role`, etc.)
   se aplican igual que en la app — solo ves/creás lo que tu usuario puede ver
   en la web.

Tu password nunca pasa por el MCP ni por el modelo: se escribe, si hace falta,
en el formulario de login normal del sitio, dentro del navegador.

### Qué se agregó al repo de `my-tracker`

- `app/mcp/authorize/page.tsx` — pantalla de consentimiento ("¿autorizás a
  my-tracker-mcp a acceder a tu cuenta?").
- `lib/actions/mcp.ts` — genera el código de un solo uso y redirige al
  `127.0.0.1:<puerto>` del CLI.
- `lib/db/mcp-auth.ts` + tabla `mcp_auth_codes`
  (`supabase/migrations/0015_mcp_auth_codes.sql`) — guarda el hash del código,
  el refresh token asociado y su expiración; RLS habilitado sin policies
  (solo se toca con la service role desde el server).
- `app/api/mcp/exchange/route.ts` — intercambia el código por tokens frescos
  de Supabase (`refreshSession`).
- Soporte de `?next=` en `/login` para volver a `/mcp/authorize` después de
  loguearse si no había sesión.

## Instalación para el equipo (sin clonar el repo)

El paquete se publica **privado en GitHub Packages** como
`@jeffercbs/my-tracker-mcp`. Antes de instalar nada, cada máquina necesita
apuntar ese scope al registro de GitHub y autenticarse con un token que tenga
`read:packages`, en su `~/.npmrc`:

```
@jeffercbs:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=<token con read:packages>
```

Es un paso por máquina, no por repositorio. Sin él, cualquier `npx` de abajo
falla con un 401 o un 404 del registro.

Registrá el servidor directo en Claude Code (o el cliente MCP que uses),
apuntando a `npx @jeffercbs/my-tracker-mcp` en vez de una ruta local:

```bash
claude mcp add my-tracker -s user -- npx -y @jeffercbs/my-tracker-mcp
```

No hace falta pasarle ninguna variable. El servidor pide la configuración
pública de my-tracker (`GET /api/mcp/config`: la URL de Supabase y la anon key,
las mismas que ya sirve el frontend a cualquier navegador) y la cachea en
`~/.my-tracker-mcp/config.json`. Lo único sensible, tu sesión, vive aparte y
solo se obtiene por navegador. Para apuntar a otra instancia, las variables
`MY_TRACKER_WEB_URL`, `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`
siguen teniendo prioridad.

El paquete se publica ya compilado (solo `dist/`), así que `npx` lo descarga y
lo ejecuta sin instalar dependencias de desarrollo ni compilar nada. Las
corridas siguientes usan la copia cacheada por `npx`.

Para autenticarte (una vez, o para cambiar de usuario), sin clonar nada:

```bash
npx -y --package=@jeffercbs/my-tracker-mcp my-tracker-mcp-login
npx -y --package=@jeffercbs/my-tracker-mcp my-tracker-mcp-whoami   # opcional, confirma el usuario
npx -y --package=@jeffercbs/my-tracker-mcp my-tracker-mcp-logout  # para cerrar sesión
```

### Un solo comando por repositorio

Para dejar un repositorio listo de una vez —servidor MCP registrado, sesión
iniciada y skill de arquitectura instalado— parado en su raíz:

```bash
npx -y --package=@jeffercbs/my-tracker-mcp my-tracker-mcp-init <workspaceSlug> <PROJECT_KEY>
```

Hace tres cosas, todas repetibles sin romper nada:

1. **Sesión** — reutiliza la que haya en `~/.my-tracker-mcp/session.json`; si no hay, abre el navegador para autorizar.
2. **Servidor MCP** — escribe la entrada `my-tracker` en el `.mcp.json` del repositorio, respetando los otros servidores que ya estén ahí. Con `--scope user` lo registra en tu configuración de usuario vía `claude mcp add` en vez de en el repositorio.
3. **Skill** — escribe `.claude/skills/tracker-architecture/SKILL.md` apuntando a ese proyecto.

Otras opciones: `--dir <ruta>` para operar sobre otro repositorio, `--force`
para reemplazar un skill que cambió y `--skip-login` para fallar en vez de
abrir el navegador.

El `.mcp.json` que escribe no lleva ninguna credencial: solo el comando y el
paquete. Se puede commitear tal cual, y cada persona del equipo solo tiene que
autenticarse una vez.

Si solo querés (re)instalar el skill, sin tocar el registro del servidor:

```bash
npx -y --package=@jeffercbs/my-tracker-mcp my-tracker-mcp-skill <workspaceSlug> <PROJECT_KEY>
```

(También podés pedirle a Claude que corra la tool `login` directamente desde
el chat — ver "Tools expuestas" más abajo.)

## Publicación del paquete

Se publica en GitHub Packages, privado, bajo el scope `@jeffercbs`. En
`package.json` el destino está fijado con `publishConfig`, así que un `npm
publish` no puede acabar por accidente en el registro público de npm.

```bash
npm version patch          # o minor / major
npm publish                # usa publishConfig: npm.pkg.github.com, access restricted
```

Para publicar hace falta un token con `write:packages` en tu `~/.npmrc`
(el de `read:packages` de arriba solo permite instalar).

Qué viaja en el tarball: solo `dist/`, `package.json` y este README — la lista
está fijada con el campo `files`, así que ni `.env`, ni `src/`, ni la
configuración local pueden colarse aunque cambie el `.gitignore`. Comprobalo
antes de publicar con:

```bash
npm pack --dry-run
```

`prepublishOnly` recompila antes de publicar, para que `dist/` nunca quede
desfasado respecto al código.

## Instalación en desarrollo (clonando el repo)

```bash
git clone https://github.com/jeffercbs/my-tracker-mcp.git
cd my-tracker-mcp
npm install
cp .env.example .env
```

Completá `.env`:

```
NEXT_PUBLIC_SUPABASE_URL=...       # igual que en my-tracker/.env.local
NEXT_PUBLIC_SUPABASE_ANON_KEY=...  # igual que en my-tracker/.env.local (es pública, no secreta)
MY_TRACKER_WEB_URL=https://tracker.jeffercbs.com  # o http://localhost:3000 en dev
```

```bash
npm run login     # abre el navegador, autoriza, guarda la sesión localmente
npm run whoami     # opcional: confirma con qué usuario quedaste autenticado
npm run build
```

```json
{
  "mcpServers": {
    "my-tracker": {
      "command": "node",
      "args": ["C:/Users/jeffe/source/repos/my-tracker-mcp/dist/src/index.js"]
    }
  }
}
```

También podés usar `npm run dev` (vía `tsx`) durante desarrollo en lugar de
compilar con `npm run build`.

Para cerrar sesión (por ejemplo si cambiás de usuario): `npm run logout`
(revoca la sesión en Supabase y borra el archivo local).

## Arquitectura

```
src/
  config/         env vars (Supabase públicas, URL del sitio web) — nada de secretos
  auth/           sesión local, cliente de Supabase autenticado, flujo de login por navegador
  repositories/   una consulta a Supabase por archivo de dominio (workspaces, projects, issues, attachments, notes, architecture)
  tools/          una tool de MCP por archivo, agrupadas por dominio + registro central (tools/index.ts)
  server.ts       arma el McpServer y registra todas las tools
  index.ts        entrypoint (stdio transport)
  skill/          plantilla del skill `tracker-architecture` y los skills que el equipo define por proyecto
  setup/          registro del servidor en el .mcp.json del repo o en la config de usuario
scripts/          init/login/logout/whoami/skill/skills para uso desde la terminal (no son tools de MCP)
```

Capas: `tools` orquesta (valida input con zod, resuelve el proyecto, arma la
respuesta) → `repositories` hace la consulta a Supabase (sin saber nada de
MCP) → `auth` resuelve quién sos. Todos los archivos van en minúscula con
guiones (`auth-flow.ts`, `resolve-project.ts`, etc.), sin camelCase en los
nombres.

## Tools expuestas

- `login` / `whoami` — autenticación.
- `list_workspaces` — workspaces a los que tenés acceso.
- `list_projects` — proyectos de un workspace.
- `list_project_metadata` — **catálogo completo del proyecto**: tipos de incidencia, estados con su categoría, etiquetas, prioridades válidas y miembros asignables.
- `list_workspace_members` — personas del workspace con `userId`, nombre, correo y rol.
- `create_issue_type` / `update_issue_type` — dar de alta o editar los tipos de incidencia del proyecto (Bug, Tarea, ...).
- `create_issue_status` / `update_issue_status` — dar de alta o editar los estados del flujo de trabajo, con su categoría y su posición.
- `create_issue_module` / `update_issue_module` — dar de alta o editar los módulos con los que se clasifican las incidencias (Facturación, Autenticación, ...).
- `list_issues` / `get_issue` — leer y **buscar** incidencias: palabra clave, estado, tipo, prioridad, etiquetas, asignado, autor, rangos de fecha, orden y paginación. `get_issue` devuelve la incidencia y su documentación; comentarios, historial y adjuntos solo si se piden con `include`.
- `create_issue` / `update_issue` / `add_issue_comment` — crear/editar incidencias y comentar.
- `list_issue_attachments` / `add_issue_attachment` / `delete_issue_attachment` — capturas de evidencia y archivos de una incidencia.
- `list_notes` / `get_note` — leer notas de un proyecto o de una incidencia (con `limit`).
- `create_note` / `update_note` — crear/editar notas.
- `get_architecture_rules` — restricciones del equipo para el diagrama de arquitectura: rutas a ignorar, rutas a priorizar e instrucciones en lenguaje natural.
- `get_project_architecture` — mapa de arquitectura publicado: componentes, relaciones, límites y conclusiones, con la revisión de git desde la que se generó.
- `publish_project_architecture` — publica (y reemplaza) el mapa a partir de una especificación `architecture` de archify ya validada.
- `get_architecture_skill` — devuelve el skill `tracker-architecture` ya apuntando a un proyecto, y la ruta donde va dentro del repositorio.
- `list_project_skills` / `get_project_skill` — los skills y subagentes que el equipo escribió para un proyecto en my-tracker.
- `install_project_skills` — devuelve esos ficheros con su ruta y su contenido, listos para escribirlos en el repositorio.
- `import_project_skills` — el camino inverso: sube a my-tracker los skills que ya viven en el repositorio.
- `list_boards` / `get_board` — los tableros de seguimiento de un proyecto o subproyecto (sprints, cascada y cronogramas de iteraciones) con sus etapas, fechas e incidencias.
- `create_board` / `add_board_stage` / `update_board_stage` — crear un tablero con sus etapas iniciales, ampliarlo y reflejar el avance de cada sprint o fase.
- `set_board_issues` — colocar, mover o sacar incidencias de una etapa del tablero.
- `set_timeline_segment` — pintar en un cronograma en qué periodos cae el trabajo principal, el solapado y las dependencias de terceros.

Todas las tools que **crean** algo (`create_issue`, `create_project`,
`create_issue_type`, `create_issue_status`, `create_issue_module`,
`create_note`, `add_issue_comment`, `add_issue_attachment`, `create_board`,
`add_board_stage`) son tools **bajo
petición**: las instrucciones del servidor y la descripción de cada tool le
dicen al modelo que no cree nada por iniciativa propia, solo cuando la persona
usuaria lo pide de forma explícita. Si el modelo cree que hace falta una
incidencia, una nota o una captura, lo ofrece y espera.

### Arquitectura del proyecto

El diagrama de arquitectura de un proyecto lo genera el agente en el
repositorio real con el skill [archify](https://github.com/tt-a1i/archify) y lo
publica acá; `my-tracker` lo dibuja de forma nativa en la página
`/{workspace}/projects/{KEY}/architecture`. El servidor no clona repositorios ni
ejecuta archify: recibe la especificación JSON, la valida contra el esquema
`architecture` y la guarda.

### El skill del repositorio

Cada repositorio que publica su arquitectura lleva un skill propio,
`tracker-architecture`, que ya sabe a qué workspace y proyecto pertenece. Se
instala con un comando, parado en la raíz del repositorio:

```bash
npx -y --package=@jeffercbs/my-tracker-mcp my-tracker-mcp-init acme WEB
# solo el skill: my-tracker-mcp-skill acme WEB
# con el repo clonado: npm run init -- acme WEB
```

Escribe `.claude/skills/tracker-architecture/SKILL.md` con el workspace, la
clave del proyecto, el enlace a su página y una foto de las restricciones
vigentes. Opciones: `--dir <ruta>` para instalarlo en otro repositorio,
`--force` para reemplazar uno existente y `--print` para ver el contenido sin
escribir nada. El comando comprueba antes que tengas acceso a ese proyecto.

Desde el chat es lo mismo con la tool `get_architecture_skill`: devuelve el
contenido y la ruta, y el agente lo escribe. En ambos casos hay que reiniciar
la sesión del agente para que cargue el skill.

El orden es fijo:

1. `get_architecture_rules` — las restricciones que definió el equipo desde la
   aplicación. Son obligatorias: lo marcado como ignorado no puede aparecer en
   el diagrama ni en el análisis. No hay tool para cambiarlas; las edita una
   persona en la UI.
2. Autorar la especificación con el skill, poniendo en `components[].sources`
   las rutas reales del repositorio y en `meta.repository` el commit completo.
3. `node bin/archify.mjs validate architecture <spec>.json --quality showcase --json`.
4. `publish_project_architecture` con el JSON validado y `sourceRevision`.

Publicar reemplaza el mapa anterior, así que es una tool **bajo petición**: solo
cuando piden generar o actualizar la arquitectura. El guion completo está en
`integrations/my-tracker/README.md` del repositorio de archify, junto con un
script que inventaría el repositorio aplicando las reglas.

Para escribir hace falta permiso en el módulo `architecture` del proyecto
(owner y admin lo tienen siempre); las RLS lo imponen en la base.

### Skills del proyecto

Cada proyecto puede llevar sus propios skills y subagentes, escritos en Markdown
desde la pestaña **Skills** del proyecto en my-tracker. El servidor los sirve ya
montados en fichero, con el frontmatter que espera el agente:

| Tipo | Dónde se instala |
|---|---|
| `skill` | `.claude/skills/<nombre>/SKILL.md` |
| `agent` | `.claude/agents/<nombre>.md` |

El flujo va en las dos direcciones:

- **Del repositorio a my-tracker** — `import_project_skills` recibe la ruta y el
  contenido crudo de cada fichero, lee el frontmatter y los da de alta. Es lo que
  se usa la primera vez, para no reescribir a mano lo que ya existe en el repo.
- **De my-tracker al repositorio** — `install_project_skills` devuelve la lista de
  ficheros con su ruta y su contenido, y el agente los escribe. Desde la terminal:

```bash
npx -y --package=@jeffercbs/my-tracker-mcp my-tracker-mcp-skills acme WEB
```

Opciones: `--dir` para otro repositorio, `--root .agents` para clientes que leen
esa convención, `--only a,b` para instalar solo algunos, `--print` para ver qué
haría y `--force` para reemplazar los que hayan cambiado. Sin `--force`, un
fichero con contenido distinto se reporta como conflicto y no se toca.

Escribir en el repositorio es una acción bajo petición: ni la tool ni el comando
se invocan por iniciativa propia.

### Reglas de contenido aplicadas por el servidor

Las instrucciones son una recomendación; estas comprobaciones (`src/tools/issue-rules.ts`)
son lo que impide que una incidencia entre mal documentada aunque el modelo se
despiste. Se aplican en `create_issue` y `update_issue`:

| Regla | Efecto |
| --- | --- |
| `description` obligatoria al crear | Error: una incidencia con solo título no documenta nada |
| Nada de código en `description` ni `stepsToReproduce` | Error si detecta rutas o nombres de archivo de código, bloques de código, SQL, trazas o referencias a commits/ramas: eso va en `resolutionNotes` |
| Longitud máxima por campo | Error por encima de 140 (`title`), 2500 (`description`), 2000 (`stepsToReproduce`), 5000 (`businessLogic`) u 8000 (`resolutionNotes`) caracteres |
| Longitud mínima y marcadores | Error si el campo es un `N/A`, un `pendiente` o una frase demasiado corta para dar contexto |
| Cierres vacíos | Error si `resolutionNotes` es un "ya funciona" o un "se arregló el bug" |
| Título duplicado | `create_issue` rechaza un título que ya existe en el proyecto; se salta con `allowDuplicate: true` |
| Documentación al cerrar | Mover a un estado de categoría `done` exige `description`, `businessLogic` y `resolutionNotes`; se salta con `forceClose: true` |

Además, la respuesta trae `warnings`: avisos que no bloquean (falta
`businessLogic`, hay identificadores en camelCase en un campo de negocio, el
texto narra el propio proceso de trabajo).

### Referencias por nombre, no por UUID

Workspace y proyecto se resuelven por `slug`/`key` (los mismos que aparecen en
las URLs de la app). Además, `create_issue` y `update_issue` aceptan **nombres**
en los campos de referencia y los resuelven del lado del servidor:

| Campo | Acepta |
| --- | --- |
| `type` | `"Bug"`, `"Tarea"`… o el UUID del tipo |
| `status` | `"En progreso"`, una categoría (`"todo"`, `"done"`…) o el UUID |
| `assignee` | correo, nombre completo o `userId`. `null` desasigna |
| `labels` | nombres o UUIDs. Reemplaza el conjunto completo; `[]` las quita todas |

El emparejamiento ignora mayúsculas y acentos, y acepta coincidencias parciales
si son inequívocas. Si algo no existe o es ambiguo, el error lista las opciones
disponibles para que el modelo se corrija sin tener que volver a consultar.

Con `createMissingLabels: true`, las etiquetas que no existan se crean en vez
de fallar.

### Información completa de una incidencia

`create_issue` y `update_issue` cubren todos los campos del formulario web:
`title`, `description`, `stepsToReproduce`, `businessLogic`, `resolutionNotes`,
`type`, `status`, `priority`, `assignee`, `labels` y `dueDate`.

Los dos campos de documentación se guardan en Markdown y se editan igual desde
la web:

- `businessLogic` — la lógica de la incidencia: reglas de negocio, condiciones,
  casos borde y comportamiento esperado.
- `resolutionNotes` — la solución aplicada: causa raíz, qué se cambió, en qué
  archivos y cómo se verificó. Lo natural es rellenarlo al pasar la incidencia
  a un estado de categoría `done`.

Para la evidencia, `add_issue_attachment` acepta:

- `filePath` — ruta local del archivo en la máquina donde corre el servidor MCP
  (lo natural cuando el modelo acaba de tomar una captura).
- `base64` + `filename` — si el contenido ya está en memoria.

El tipo MIME se deduce de la extensión si no se indica. El límite es 10MB por
archivo, igual que en la web. `list_issue_attachments` y `get_issue` devuelven
una URL firmada válida por una hora para descargar cada adjunto.

Los cambios de estado, prioridad y asignación hechos desde el MCP se escriben
en `activity_log` igual que los de la web, así que el historial de la incidencia
no distingue entre unos y otros.

### Búsqueda y filtros de incidencias

`list_issues` combina todos estos filtros con Y, y siempre devuelve `total`
(coincidencias más allá de la página actual) además de la página pedida:

| Filtro | Acepta |
| --- | --- |
| `query` | Palabra o frase; sin distinguir mayúsculas ni acentos de caja, con `%` como comodín |
| `searchIn` | Dónde buscar `query`: `title`, `description`, `stepsToReproduce`, `businessLogic`, `resolutionNotes` (por defecto, todos) |
| `status` | Lista de estados por nombre, por categoría (incluye todos los de esa categoría) o por id |
| `statusCategory` | Atajo para una única categoría |
| `type` | Lista de tipos por nombre o id |
| `priority` | Lista de prioridades |
| `labels` | Lista de etiquetas por nombre o id; devuelve las que tengan al menos una |
| `assignee` / `unassigned` | Correo, nombre, `userId` o `"me"`; o solo las no asignadas |
| `reporter` | Autor de la incidencia, con las mismas formas que `assignee` |
| `createdAfter` / `createdBefore` | `YYYY-MM-DD` o fecha-hora ISO (UTC). Una fecha suelta como cota superior cubre el día entero |
| `updatedAfter` / `updatedBefore` | Igual, sobre la última modificación |
| `dueAfter` / `dueBefore` / `hasDueDate` | Fecha límite: rango, o con/sin fecha |
| `sortBy` / `sortOrder` | `number` (default), `createdAt`, `updatedAt`, `dueDate`; `desc` por defecto |

La respuesta en Markdown encabeza con los filtros aplicados y, si quedan
resultados fuera de la página, indica el `offset` con el que seguir.

### Tipos, estados y módulos del proyecto

El catálogo del proyecto también se administra desde el MCP:

| Tool | Qué hace |
| --- | --- |
| `create_issue_type` | Crea un tipo (`name`, `color`, `icon`) |
| `update_issue_type` | Renombra o recolorea un tipo, identificado por nombre actual o id |
| `create_issue_status` | Crea un estado (`name`, `category`, `color`, `position`); sin `position` se añade al final del flujo |
| `update_issue_status` | Cambia nombre, categoría, color o posición de un estado, identificado por nombre actual, categoría o id |
| `create_issue_module` | Crea un módulo (`name`, `description`, `color`) |
| `update_issue_module` | Renombra, recolorea o cambia la descripción de un módulo, identificado por nombre actual o id |

La `category` de un estado (`backlog`, `todo`, `in_progress`, `done`,
`cancelled`) es lo que le da su significado: las incidencias en un estado de
categoría `done` cuentan como cerradas, y `update_issue` exige documentación
antes de moverlas ahí.

### Tableros de seguimiento

Un tablero reparte las incidencias en etapas para seguir un desarrollo. Existe
en tres formas, y `get_board` devuelve la que corresponda:

| Tipo | Etapas | Para qué |
| --- | --- | --- |
| `sprint` | Sprints con fecha de inicio y fin | Iterar en ciclos cortos; el tablero de la aplicación reparte las incidencias por estado |
| `waterfall` | Fases encadenadas | Seguir un desarrollo de principio a fin, midiendo el avance por incidencias cerradas |
| `timeline` | Iteraciones sobre una rejilla de periodos | Cronograma: qué iteración ocupa qué semanas, con trabajo principal, solapado y dependencias de terceros |

Un tablero cuelga del proyecto o de un subproyecto (`subproject` en
`list_boards` y `create_board`). Las etapas y los tableros se referencian por
nombre o por su identificador, igual que el resto de referencias del MCP.

En un cronograma, `set_timeline_segment` marca un tramo de una iteración:
`from`/`to` son números de periodo empezando en 1, y `kind` es `main`,
`overlap` o `dependency`. Pintar sobre un rango ya ocupado lo reemplaza, y
`clear: true` lo borra. `get_board` devuelve la rejilla dibujada en texto.

Mover una incidencia dentro de un tablero no cambia su estado: para eso sigue
estando `update_issue`.

### Formato de la respuesta

Todas las tools de lectura y escritura aceptan un parámetro opcional `format`:

- `format: "markdown"` (por defecto) — texto legible: tablas para los listados,
  fichas de campos para un único registro, y la incidencia completa renderizada
  con sus secciones.
- `format: "json"` — el objeto crudo, indentado, como antes.

Además, todas declaran `outputSchema` y devuelven `structuredContent`, así que
un cliente MCP recibe siempre la respuesta tipada además del texto. Los datos
van envueltos en una clave con nombre (`{ projects: [...] }`, `{ issue: {...} }`,
`{ notes: [...] }`), que es lo que exige el protocolo para el contenido
estructurado.

### Optimizaciones de consulta

- Resolver workspace + proyecto (`workspaceSlug` + `projectKey`) es un solo
  round-trip a Supabase (`repositories/projects.ts#getProjectWithWorkspace`,
  join sobre `workspaces!inner`), no dos consultas secuenciales.
- `get_issue` trae la incidencia en una sola consulta con relaciones anidadas,
  y por defecto **sin** comentarios, historial ni adjuntos: cada parte se pide
  con `include` (`comments`, `activity`, `attachments`) y el historial se
  recorta a los 20 elementos más recientes (`historyLimit`).
- Comentar, adjuntar o crear una nota sobre una incidencia resuelve su id con
  una consulta mínima (`findIssueRef`) en vez de cargar el detalle completo con
  historial y una URL firmada por adjunto.
- `update_issue` resuelve estado, tipo, módulo, subproyecto y asignado en
  paralelo, y solo relee el texto ya guardado cuando el cambio es un cierre.
- Los adjuntos firman todas sus URLs en una única llamada al storage
  (`createSignedUrls`), no una por archivo.
- El filtro por etiquetas de `list_issues` acota el join a `issues` del
  proyecto, en vez de traer las relaciones de todos los proyectos visibles.
- El cliente de Supabase autenticado se reutiliza mientras el token no cambie,
  y un refresco en vuelo se comparte entre las llamadas concurrentes.
- `list_issues` filtrado por `statusCategory` resuelve los `status_id` que
  matchean esa categoría (consulta chica sobre `issue_statuses`, indexada por
  `project_id`) y filtra con `.in()`, en vez de traer todas las incidencias y
  descartar del lado del cliente.
- `list_issues` y `list_notes` paginan (`limit`/`offset`, tope 200) para no
  devolver payloads sin límite en proyectos grandes.

## Notas de seguridad

- El código de un solo uso (`mcp_auth_codes`) expira a los 2 minutos y se
  marca usado apenas se canjea; no se puede reutilizar.
- El servidor de callback local solo escucha en `127.0.0.1`, atiende un único
  callback y rechaza las peticiones cuya cabecera `Host` no sea `127.0.0.1` o
  `localhost` (DNS rebinding).
- El `state` se genera con 32 bytes aleatorios y se compara en tiempo
  constante; la respuesta del canje se valida antes de guardarse, y el mensaje
  de error que se pinta en la página local va escapado.
- La URL de autorización se abre pasándola como argumento del proceso, nunca
  interpolada en una línea de comandos, y solo si es `http`/`https`.
- `NEXT_PUBLIC_SUPABASE_URL` y `MY_TRACKER_WEB_URL` deben ser `https://` (se
  admite `http://` solo en localhost), para no mandar el token en claro.
- La sesión guardada se valida al leerla y el fichero se fuerza a permisos
  `0600`; si el refresh token deja de servir, se borra en vez de reintentar.
- `add_issue_attachment` rechaza ficheros de credenciales (`.env`, `id_rsa`,
  `.pem`, `.key`, `.p12`, `.npmrc`, `.netrc`...), comprueba el tamaño antes de
  leer el archivo y limpia el nombre para que no pueda escaparse de la carpeta
  del proyecto en el bucket.
- Un solo usuario por sesión guardada: si varias personas usan esta máquina,
  cada una debería tener su propia carpeta `~/.my-tracker-mcp` (o correr el
  servidor con `HOME` distinto).
- Todo el control de acceso a los datos vive en las policies RLS de
  `supabase/migrations` del repo `my-tracker`; este servidor no agrega ni
  bypassea permisos, solo obtiene un JWT legítimo del usuario.
