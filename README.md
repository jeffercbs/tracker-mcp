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

## Instalación

```bash
cd my-tracker-mcp
npm install
cp .env.example .env
```

Completá `.env`:

```
NEXT_PUBLIC_SUPABASE_URL=...       # igual que en my-tracker/.env.local
NEXT_PUBLIC_SUPABASE_ANON_KEY=...  # igual que en my-tracker/.env.local (es pública, no secreta)
MY_TRACKER_WEB_URL=http://localhost:3000  # o la URL donde corra my-tracker
```

```bash
npm run login     # abre el navegador, autoriza, guarda la sesión localmente
npm run whoami     # opcional: confirma con qué usuario quedaste autenticado
npm run build
```

## Conectarlo a un cliente MCP

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
  repositories/   una consulta a Supabase por archivo de dominio (workspaces, projects, issues, notes)
  tools/          una tool de MCP por archivo, agrupadas por dominio + registro central (tools/index.ts)
  server.ts       arma el McpServer y registra todas las tools
  index.ts        entrypoint (stdio transport)
scripts/          login/logout/whoami para uso desde la terminal (no son tools de MCP)
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
- `list_project_metadata` — estados, tipos y etiquetas de un proyecto.
- `list_issues` / `get_issue` — leer incidencias, con filtros por estado/asignado y paginación (`limit`/`offset`).
- `create_issue` / `update_issue` / `add_issue_comment` — crear/editar incidencias y comentar.
- `list_notes` / `get_note` — leer notas de un proyecto o de una incidencia (con `limit`).
- `create_note` / `update_note` — crear/editar notas.

Todos los ids de workspace/proyecto se resuelven por `slug`/`key` (los mismos
que aparecen en las URLs de la app), no hace falta conocer UUIDs salvo para
`statusId`/`typeId`/`assigneeId`, que se obtienen con `list_project_metadata`.

### Optimizaciones de consulta

- Resolver workspace + proyecto (`workspaceSlug` + `projectKey`) es un solo
  round-trip a Supabase (`repositories/projects.ts#getProjectWithWorkspace`,
  join sobre `workspaces!inner`), no dos consultas secuenciales.
- `get_issue` trae la incidencia y sus comentarios en una sola consulta
  (relación anidada `comments(...)`), en vez de dos.
- `list_issues` filtrado por `statusCategory` resuelve los `status_id` que
  matchean esa categoría (consulta chica sobre `issue_statuses`, indexada por
  `project_id`) y filtra con `.in()`, en vez de traer todas las incidencias y
  descartar del lado del cliente.
- `list_issues` y `list_notes` paginan (`limit`/`offset`, tope 200) para no
  devolver payloads sin límite en proyectos grandes.

## Notas de seguridad

- El código de un solo uso (`mcp_auth_codes`) expira a los 2 minutos y se
  marca usado apenas se canjea; no se puede reutilizar.
- El servidor de callback local solo escucha en `127.0.0.1`, no en la red.
- Un solo usuario por sesión guardada: si varias personas usan esta máquina,
  cada una debería tener su propia carpeta `~/.my-tracker-mcp` (o correr el
  servidor con `HOME` distinto).
- Todo el control de acceso a los datos vive en las policies RLS de
  `supabase/migrations` del repo `my-tracker`; este servidor no agrega ni
  bypassea permisos, solo obtiene un JWT legítimo del usuario.
