'use client'

import { Printer } from 'lucide-react'

/**
 * Opens the browser's print dialog, from which the operator prints or chooses
 * "Save as PDF". This is deliberately the whole mechanism for invoices: the
 * customer-facing document is the print-only layout on the page (see
 * InvoicePrintDocument), so there is no second PDF engine and no duplicated
 * finance math — the browser renders the exact figures already on screen.
 */
export default function PrintButton({ label = 'Print / Save as PDF' }: { label?: string }) {
  return (
    <button type="button" className="ops-btn" onClick={() => window.print()}>
      <Printer aria-hidden="true" /> {label}
    </button>
  )
}
