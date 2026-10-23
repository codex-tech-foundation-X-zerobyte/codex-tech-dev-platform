// Must match the database check in 20261021000003_core.sql: 2 to 40 characters, a to z, 0 to 9 and dashes, no dash at either end.
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 40)
    .replace(/-+$/, '')
}
export const isValidSlug = (s: string) => SLUG_RE.test(s)
export const isValidName = (s: string) => s.trim().length >= 1 && s.trim().length <= 80
