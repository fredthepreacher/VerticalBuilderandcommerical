/**
 * ============================================================================
 * PRINT BRAND — shared identity for customer-facing documents
 * ----------------------------------------------------------------------------
 * The estimate/proposal PDF (pdf-lib, server) and the invoice print view
 * (browser print, HTML/CSS) are produced by completely different renderers, but
 * a customer should not be able to tell — they must read as the same company.
 * This is the one place the company details and the print palette live so the
 * two renderers cannot drift apart.
 *
 * Deliberately dependency-free: no pdf-lib, no React. Both a server PDF and a
 * client-rendered page import it. Colours are plain hex; pdf.ts converts them to
 * pdf-lib rgb() once, at the top of that file.
 *
 * DESIGN INTENT — printer-friendly. There is no large-area dark fill anywhere in
 * this palette's intended use: white paper, dark text, and thin orange/grey
 * rules carry the structure. Ink lives in the words, not in filled banners.
 * ============================================================================
 */

export interface PrintCompany {
  name: string
  phone: string
  email: string
  addressLine1: string
  addressLine2: string
  licenseGC: string
  licenseRoof: string
  website: string
}

/** The real company. Overridable per render, but this is the source of truth. */
export const PRINT_COMPANY: PrintCompany = {
  name: 'Vertical Builders & Commercial',
  phone: '941-877-2009',
  email: 'Office@verticalbc.com',
  addressLine1: '303 S Tamiami Trail Unit H',
  addressLine2: 'Nokomis, FL 34275',
  licenseGC: 'CGC1528626',
  licenseRoof: 'CCC1333649',
  website: 'verticalbuildersandcommercial.com',
}

/**
 * Print palette as hex. These match the on-screen CRM tokens (--ops-navy,
 * --ops-accent, --ops-muted, --ops-line) so a printed document and the app it
 * came from look related.
 */
export const PRINT_BRAND = {
  /** Primary text — near-black navy. Company name, body, totals value. */
  ink: '#0d1218',
  /** Vertical orange. Document title, thin rules, the TOTAL label. */
  accent: '#f0492c',
  /** Secondary text — licences, addresses, metadata, footer. */
  muted: '#6a7683',
  /** Hairline rules between rows. */
  line: '#d8dee5',
} as const

/**
 * Page geometry shared by the PDF renderer, in PostScript points (72 = 1 inch).
 * US Letter, ~2/3-inch safe margin. The totals block has an explicit width so
 * large currency values right-align inside it instead of drifting to the edge.
 */
export const PRINT_PAGE = {
  width: 612,
  height: 792,
  margin: 48,
  /** Width of the right-hand totals block. Sized for "$1,234,567.89" + label. */
  totalsWidth: 232,
} as const
