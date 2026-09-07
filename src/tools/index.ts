import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

import { registerAuthTools } from "./auth.js"
import { registerWorkspaceTools } from "./workspaces.js"
import { registerProjectTools } from "./projects.js"
import { registerIssueTools } from "./issues.js"
import { registerAttachmentTools } from "./attachments.js"
import { registerNoteTools } from "./notes.js"
import { registerArchitectureTools } from "./architecture.js"
import { registerSkillTools } from "./skills.js"
import { registerWorkflowTools } from "./workflows.js"
import { registerBoardTools } from "./boards.js"

export function registerAllTools(server: McpServer) {
  registerAuthTools(server)
  registerWorkspaceTools(server)
  registerProjectTools(server)
  registerIssueTools(server)
  registerAttachmentTools(server)
  registerNoteTools(server)
  registerArchitectureTools(server)
  registerSkillTools(server)
  registerWorkflowTools(server)
  registerBoardTools(server)
}
