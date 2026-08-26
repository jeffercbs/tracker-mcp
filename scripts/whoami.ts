import { getUserClient } from "../src/auth/supabase-client.js"

async function main() {
  const { email, userId } = await getUserClient()
  console.log(`Autenticado como ${email} (${userId})`)
}

main().catch((err) => {
  console.error(err.message ?? err)
  process.exit(1)
})
