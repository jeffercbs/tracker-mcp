import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

import { getUserClient } from "../auth/supabase-client.js"
import * as workspaces from "../repositories/workspaces.js"
import { ok, fail } from "./response.js"

export function registerWorkspaceTools(server: McpServer) {
  server.registerTool(
    "list_workspaces",
    {
      title: "Listar workspaces",
      description: "Lista los workspaces (personales o de empresa) a los que tiene acceso el usuario autenticado.",
      inputSchema: {},
    },
    async () => {
      try {
        const { client, userId } = await getUserClient()
        return ok(await workspaces.listWorkspacesForUser(client, userId))
      } catch (err) {
        return fail(err)
      }
    }
  )
}
