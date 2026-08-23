/**
 * Minimal, dependency-free RFC-4180 CSV writer.
 * The audit package must never fail because of a formatting library, so CSV is
 * generated here rather than pulled from a dependency.
 */

export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return ''
  let s = String(value)
  // Defuse spreadsheet formula injection without mangling normal text.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  if (/["\n\r,]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvEscape).join(',')]
  for (const row of rows) lines.push(row.map(csvEscape).join(','))
  // UTF-8 BOM so Excel on Windows opens accented names correctly.
  return '﻿' + lines.join('\r\n') + '\r\n'
}

export function yesNo(value: boolean | null | undefined): string {
  if (value === null || value === undefined) return 'Not recorded'
  return value ? 'Yes' : 'No'
}
