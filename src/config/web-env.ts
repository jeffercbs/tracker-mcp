import "dotenv/config"

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

export const webAppUrl = requireEnv("MY_TRACKER_WEB_URL").replace(/\/$/, "")
