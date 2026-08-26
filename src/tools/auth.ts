import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

import { getUserClient } from "../auth/supabase-client.js"
import { performBrowserLogin } from "../auth/auth-flow.js"
import { ok, fail } from "./response.js"

export function registerAuthTools(server: McpServer) {
  server.registerTool(
    "login",
    {
      title: "Iniciar sesión en my-tracker",
      description:
        "Abre el navegador para autenticarte contra my-tracker (reusa tu sesión del sitio si ya la tenés) y autoriza a este servidor MCP. Usala la primera vez, o si otra tool falla porque no hay una sesión guardada, o para cambiar de usuario. La tool espera hasta 5 minutos a que confirmes la autorización en el navegador.",
      inputSchema: {},
    },
    async () => {
      try {
        const result = await performBrowserLogin()
        return ok({
          authenticated: true,
          email: result.email,
          userId: result.userId,
          note: "Si el navegador no se abrió solo, entrá manualmente a la URL que te haya mostrado la herramienta.",
          authorizeUrl: result.authorizeUrl,
        })
      } catch (err) {
        return fail(err)
      }
    }
  )

  server.registerTool(
    "whoami",
    {
      title: "Usuario autenticado",
      description: "Devuelve el usuario de my-tracker con el que está autenticado este servidor MCP.",
      inputSchema: {},
    },
    async () => {
      try {
        const { userId, email } = await getUserClient()
        return ok({ userId, email })
      } catch (err) {
        return fail(err)
      }
    }
  )
}
