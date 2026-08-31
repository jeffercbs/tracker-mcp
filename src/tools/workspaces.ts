import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import { getUserClient } from "../auth/supabase-client.js"
import * as workspaces from "../repositories/workspaces.js"
import { formatArg, mdSection, mdTable, ok, fail } from "./response.js"
import { WorkspaceSchema } from "./schemas.js"

export function registerWorkspaceTools(server: McpServer) {
  server.registerTool(
    "list_workspaces",
    {
      title: "Listar workspaces",
      description: "Lista los workspaces (personales o de empresa) a los que tiene acceso el usuario autenticado.",
      inputSchema: { format: formatArg },
      outputSchema: { workspaces: z.array(WorkspaceSchema) },
    },
    async ({ format }) => {
      try {
        const { client, userId } = await getUserClient()
        const list = await workspaces.listWorkspacesForUser(client, userId)
        return ok(
          { workspaces: list },
          {
            format,
            markdown: (data) =>
              mdSection(
                "Workspaces",
                mdTable(
                  ["Nombre", "Slug", "Tipo", "Tu rol"],
                  data.workspaces.map((workspace) => [
                    workspace.name,
                    workspace.slug,
                    workspace.kind,
                    workspace.role,
                  ]),
                  "No tenés acceso a ningún workspace"
                ),
                1
              ),
          }
        )
      } catch (err) {
        return fail(err)
      }
    }
  )
}
