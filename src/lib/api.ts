const adminBaseUrl = import.meta.env.DEV ? '' : 'http://127.0.0.1:8787'

export function adminUrl(path: string) {
  return `${adminBaseUrl}${path}`
}
