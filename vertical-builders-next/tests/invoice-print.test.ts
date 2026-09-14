import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * ============================================================================
 * INVOICE PRINT — the smallest clean printable path
 * ----------------------------------------------------------------------------
 * Invoices had no print/PDF path at all before this. Rather than stand up a
 * second PDF engine, the invoice detail page carries a print-only document and
 * a Print / Save as PDF button; the browser renders it. These tests lock the
 * two load-bearing properties: the printable document reuses the SAVED figures
 * (no re-computation of money) and it uses the same ink-friendly language as the
 * estimate PDF (white page, no dark fills, a grid totals block that cannot clip).
 * ============================================================================
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

const doc = read('components/ops/InvoicePrintDocument.tsx')
const button = read('components/ops/PrintButton.tsx')
const page = read('app/ops/(app)/invoices/[id]/page.tsx')
const css = read('app/ops/ops.css')

describe('a printable invoice document exists and is wired in', () => {
  it('the detail page renders the print document and a print button', () => {
    expect(page).toMatch(/InvoicePrintDocument/)
    expect(page).toMatch(/PrintButton/)
  })

  it('screen and print layouts are separated', () => {
    expect(page).toMatch(/ops-screen-only/)
    expect(doc).toMatch(/ops-print-doc/)
    expect(css).toMatch(/\.ops-print-doc \{ display: none; \}/)
    expect(css).toMatch(/@media print[\s\S]*\.ops-screen-only \{ display: none/)
  })
})

describe('it reuses saved figures rather than recomputing money', () => {
  it('does not import or call the finance calculator', () => {
    expect(doc).not.toMatch(/calculateTotals/)
    expect(doc).not.toMatch(/finance\/calc/)
  })

  it('takes already-computed cents and only formats them', () => {
    expect(doc).toMatch(/subtotalCents/)
    expect(doc).toMatch(/totalCents/)
    expect(doc).toMatch(/balanceDueCents/)
    expect(doc).toMatch(/formatCents/)
  })

  it('the page passes the stored row values straight through', () => {
    expect(page).toMatch(/subtotalCents=\{row\.subtotal_cents\}/)
    expect(page).toMatch(/totalCents=\{row\.total_cents\}/)
    expect(page).toMatch(/balanceDueCents=\{row\.balance_due_cents\}/)
  })
})

describe('it is ink-friendly and shares the estimate brand', () => {
  it('pulls company identity from the shared brand helper', () => {
    expect(doc).toMatch(/from '@\/lib\/ops\/print\/brand'/)
    expect(doc).toMatch(/PRINT_COMPANY/)
  })

  it('the print totals use a non-clipping grid', () => {
    expect(css).toMatch(/\.ppd-total-row \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) max-content/)
  })

  it('the printed TOTAL is emphasised with the orange rule, not a filled bar', () => {
    expect(css).toMatch(/\.ppd-grand \{[\s\S]*solid #f0492c/)
  })
})

describe('the on-screen totals block also cannot clip', () => {
  it('.ops-totals-row is a grid with a max-content value column', () => {
    expect(css).toMatch(/\.ops-totals-row \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) max-content/)
  })

  it('the value column never wraps', () => {
    expect(css).toMatch(/\.ops-totals-row span:last-child \{[\s\S]*white-space: nowrap/)
  })
})
