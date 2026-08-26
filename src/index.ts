import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"

import { createTrackerMcpServer } from "./server.js"

async function main() {
  const server = createTrackerMcpServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
