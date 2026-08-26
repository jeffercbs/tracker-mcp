export function dbErrorMessage(prefix: string, error: { message?: string } | null | undefined) {
  return error?.message ? `${prefix}: ${error.message}` : prefix
}
