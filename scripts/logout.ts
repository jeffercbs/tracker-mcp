import { createAnonClient } from "../src/auth/supabase-client.js"
import { clearSession, loadSession } from "../src/auth/session-store.js"

async function main() {
  const session = loadSession()

  if (session) {
    const client = createAnonClient()
    await client.auth
      .setSession({ access_token: session.accessToken, refresh_token: session.refreshToken })
      .then(() => client.auth.signOut())
      .catch(() => undefined)
  }

  clearSession()
  console.log("Sesión de my-tracker eliminada.")
}

main()
