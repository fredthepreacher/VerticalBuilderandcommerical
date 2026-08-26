import 'server-only'
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import type { Estimate, EstimateLineItem } from '../types'
import { formatCents } from '../utils/money'
import { formatDate } from '../utils/dates'

/**
 * ============================================================================
 * BRANDED ESTIMATE PDF
 * ----------------------------------------------------------------------------
 * Built with pdf-lib rather than an HTML-to-PDF pipeline: no headless browser,
 * no 300 MB dependency, deterministic output, and it runs inside a serverless
 * function's memory budget when 25 of them are generated back to back for a
 * batch export.
 *
 * Layout is a fixed grid rather than a flow engine — a contractor estimate is
 * always the same shape, and a fixed grid cannot produce a surprise page break
 * in the middle of a price.
 * ============================================================================
 */

const PAGE = { width: 612, height: 792 }
const MARGIN = 48
const CONTENT_WIDTH = PAGE.width - MARGIN * 2

const NAVY = rgb(0.05, 0.086, 0.114)
const ACCENT = rgb(0.941, 0.286, 0.173)
const GREY = rgb(0.42, 0.46, 0.51)
const LIGHT_GREY = rgb(0.89, 0.906, 0.925)
const WHITE = rgb(1, 1, 1)

export interface EstimatePdfCompany {
  name: string
  phone: string
  email: string
  addressLine1: string
  addressLine2: string
  licenseGC: string
  licenseRoof: string
  website: string
}

export const DEFAULT_COMPANY: EstimatePdfCompany = {
  name: 'Vertical Builders & Commercial',
  phone: '941-877-2009',
  email: 'Office@verticalbc.com',
  addressLine1: '303 S Tamiami Trail Unit H',
  addressLine2: 'Nokomis, FL 34275',
  licenseGC: 'CGC1528626',
  licenseRoof: 'CCC1333649',
  website: 'verticalbuildersandcommercial.com',
}

export interface EstimatePdfInput {
  estimate: Estimate
  lines: EstimateLineItem[]
  customerName: string
  company?: EstimatePdfCompany
  /** JPEG/PNG bytes plus a caption, already filtered to customer-visible ones. */
  photos?: { bytes: Uint8Array; mimeType: string; caption?: string | null }[]
  assumptions?: string[]
  taxEnabled?: boolean
}

export async function renderEstimatePdf(input: EstimatePdfInput): Promise<Buffer> {
  const company = input.company ?? DEFAULT_COMPANY
  const pdf = await PDFDocument.create()
  pdf.setTitle(`${input.estimate.estimate_number} — ${input.estimate.title}`)
  pdf.setAuthor(company.name)
  pdf.setSubject('Project estimate')
  pdf.setCreator('Vertical Ops')

  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)

  const ctx: Ctx = { pdf, font, bold, page: pdf.addPage([PAGE.width, PAGE.height]), y: 0, company }
  ctx.y = PAGE.height - MARGIN

  drawHeader(ctx, input)
  drawParties(ctx, input)
  drawScope(ctx, input)
  drawLineItems(ctx, input)
  drawTotals(ctx, input)
  drawNotes(ctx, input)
  await drawPhotos(ctx, input)
  drawFooterOnAllPages(ctx, input)

  return Buffer.from(await pdf.save())
}

interface Ctx {
  pdf: PDFDocument
  font: PDFFont
  bold: PDFFont
  page: PDFPage
  y: number
  company: EstimatePdfCompany
}

function newPage(ctx: Ctx): void {
  ctx.page = ctx.pdf.addPage([PAGE.width, PAGE.height])
  ctx.y = PAGE.height - MARGIN
}

function ensure(ctx: Ctx, needed: number): void {
  if (ctx.y - needed < MARGIN + 46) newPage(ctx)
}

function text(
  ctx: Ctx,
  value: string,
  opts: { x?: number; size?: number; bold?: boolean; color?: typeof NAVY; maxWidth?: number } = {},
): void {
  const size = opts.size ?? 9.5
  const usedFont = opts.bold ? ctx.bold : ctx.font
  ctx.page.drawText(clip(value, usedFont, size, opts.maxWidth ?? CONTENT_WIDTH), {
    x: opts.x ?? MARGIN,
    y: ctx.y,
    size,
    font: usedFont,
    color: opts.color ?? NAVY,
  })
}

function clip(value: string, font: PDFFont, size: number, maxWidth: number): string {
  // pdf-lib's standard fonts cannot encode characters outside WinAnsi, and an
  // unencodable character throws mid-render. Normalise the handful that turn up
  // in real estimate text rather than losing the whole PDF.
  let s = String(value ?? '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7E]/g, '')

  if (font.widthOfTextAtSize(s, size) <= maxWidth) return s
  while (s.length > 1 && font.widthOfTextAtSize(`${s}...`, size) > maxWidth) {
    s = s.slice(0, -1)
  }
  return `${s}...`
}

function wrap(font: PDFFont, value: string, size: number, maxWidth: number, maxLines = 40): string[] {
  const cleaned = clip(value, font, size, Number.MAX_SAFE_INTEGER)
  const words = cleaned.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate
    } else {
      if (current) lines.push(current)
      current = word
      if (lines.length >= maxLines) break
    }
  }
  if (current && lines.length < maxLines) lines.push(current)
  return lines
}

// ---------------------------------------------------------------------------

function drawHeader(ctx: Ctx, input: EstimatePdfInput): void {
  const { company } = ctx

  ctx.page.drawRectangle({
    x: 0, y: PAGE.height - 104, width: PAGE.width, height: 104, color: NAVY,
  })
  ctx.page.drawRectangle({
    x: 0, y: PAGE.height - 108, width: PAGE.width, height: 4, color: ACCENT,
  })

  ctx.page.drawText(clip(company.name.toUpperCase(), ctx.bold, 17, 340), {
    x: MARGIN, y: PAGE.height - 46, size: 17, font: ctx.bold, color: WHITE,
  })
  ctx.page.drawText(`FL Certified GC ${company.licenseGC}  |  FL Certified Roofing ${company.licenseRoof}`, {
    x: MARGIN, y: PAGE.height - 62, size: 7.5, font: ctx.font, color: rgb(0.62, 0.69, 0.75),
  })
  ctx.page.drawText(`${company.addressLine1}, ${company.addressLine2}`, {
    x: MARGIN, y: PAGE.height - 76, size: 7.5, font: ctx.font, color: rgb(0.62, 0.69, 0.75),
  })
  ctx.page.drawText(`${company.phone}  |  ${company.email}`, {
    x: MARGIN, y: PAGE.height - 89, size: 7.5, font: ctx.font, color: rgb(0.62, 0.69, 0.75),
  })

  // Right-aligned estimate identity block.
  const right = PAGE.width - MARGIN
  const label = 'ESTIMATE'
  ctx.page.drawText(label, {
    x: right - ctx.bold.widthOfTextAtSize(label, 15), y: PAGE.height - 46,
    size: 15, font: ctx.bold, color: ACCENT,
  })
  const number = input.estimate.estimate_number
  ctx.page.drawText(number, {
    x: right - ctx.bold.widthOfTextAtSize(number, 11), y: PAGE.height - 63,
    size: 11, font: ctx.bold, color: WHITE,
  })
  const dated = `Dated ${formatDate(input.estimate.created_at)}`
  ctx.page.drawText(dated, {
    x: right - ctx.font.widthOfTextAtSize(dated, 8), y: PAGE.height - 78,
    size: 8, font: ctx.font, color: rgb(0.62, 0.69, 0.75),
  })
  if (input.estimate.valid_until) {
    const valid = `Valid through ${formatDate(input.estimate.valid_until)}`
    ctx.page.drawText(valid, {
      x: right - ctx.font.widthOfTextAtSize(valid, 8), y: PAGE.height - 90,
      size: 8, font: ctx.font, color: rgb(0.62, 0.69, 0.75),
    })
  }

  ctx.y = PAGE.height - 134
}

function drawParties(ctx: Ctx, input: EstimatePdfInput): void {
  const colWidth = CONTENT_WIDTH / 2 - 10

  text(ctx, 'PREPARED FOR', { size: 7.5, bold: true, color: GREY })
  text(ctx, 'PROPERTY', { size: 7.5, bold: true, color: GREY, x: MARGIN + colWidth + 20 })
  ctx.y -= 13

  text(ctx, input.customerName || 'Customer', { size: 10.5, bold: true, maxWidth: colWidth })
  const address = [input.estimate.property_address, [input.estimate.city, input.estimate.state, input.estimate.zip].filter(Boolean).join(' ')]
    .filter(Boolean)
  text(ctx, address[0] ?? 'Address not recorded', {
    size: 10.5, bold: true, x: MARGIN + colWidth + 20, maxWidth: colWidth,
  })
  ctx.y -= 12

  if (address[1]) {
    text(ctx, address[1], { size: 9, color: GREY, x: MARGIN + colWidth + 20, maxWidth: colWidth })
  }
  if (input.estimate.service_type) {
    text(ctx, input.estimate.service_type, { size: 9, color: GREY, maxWidth: colWidth })
  }
  ctx.y -= 22
}

function drawScope(ctx: Ctx, input: EstimatePdfInput): void {
  text(ctx, clip(input.estimate.title, ctx.bold, 13, CONTENT_WIDTH), { size: 13, bold: true })
  ctx.y -= 18

  if (input.estimate.scope_summary) {
    text(ctx, 'SCOPE OF WORK', { size: 7.5, bold: true, color: GREY })
    ctx.y -= 12
    for (const line of wrap(ctx.font, input.estimate.scope_summary, 9.5, CONTENT_WIDTH, 14)) {
      ensure(ctx, 14)
      text(ctx, line, { size: 9.5 })
      ctx.y -= 12.5
    }
    ctx.y -= 8
  }
}

// Column layout for the line-item table.
const COLS = {
  description: MARGIN,
  qty: MARGIN + 300,
  unit: MARGIN + 348,
  price: MARGIN + 396,
  total: PAGE.width - MARGIN,
}

function drawLineItems(ctx: Ctx, input: EstimatePdfInput): void {
  ensure(ctx, 60)

  ctx.page.drawRectangle({
    x: MARGIN - 6, y: ctx.y - 5, width: CONTENT_WIDTH + 12, height: 19, color: NAVY,
  })
  const headerY = ctx.y
  const th = (label: string, x: number, alignRight = false) => {
    const width = ctx.bold.widthOfTextAtSize(label, 7.5)
    ctx.page.drawText(label, {
      x: alignRight ? x - width : x, y: headerY, size: 7.5, font: ctx.bold, color: WHITE,
    })
  }
  th('DESCRIPTION', COLS.description)
  th('QTY', COLS.qty)
  th('UNIT', COLS.unit)
  th('RATE', COLS.price)
  th('AMOUNT', COLS.total, true)
  ctx.y -= 24

  if (input.lines.length === 0) {
    text(ctx, 'No line items have been added to this estimate yet.', { size: 9.5, color: GREY })
    ctx.y -= 18
    return
  }

  for (const line of [...input.lines].sort((a, b) => a.sort_order - b.sort_order)) {
    const descLines = wrap(ctx.font, line.description, 9.5, 288, 4)
    const noteLines = line.notes ? wrap(ctx.font, line.notes, 8, 288, 2) : []
    const blockHeight = descLines.length * 12 + noteLines.length * 10 + 8

    ensure(ctx, blockHeight + 10)
    const rowTop = ctx.y

    descLines.forEach((l, i) => {
      ctx.page.drawText(l, {
        x: COLS.description, y: rowTop - i * 12, size: 9.5,
        font: i === 0 ? ctx.bold : ctx.font, color: NAVY,
      })
    })

    noteLines.forEach((l, i) => {
      ctx.page.drawText(l, {
        x: COLS.description + 8, y: rowTop - descLines.length * 12 - i * 10,
        size: 8, font: ctx.font, color: GREY,
      })
    })

    const qty = formatQuantity(line.quantity)
    ctx.page.drawText(qty, { x: COLS.qty, y: rowTop, size: 9.5, font: ctx.font, color: NAVY })
    ctx.page.drawText(clip(line.unit ?? '', ctx.font, 9.5, 44), {
      x: COLS.unit, y: rowTop, size: 9.5, font: ctx.font, color: GREY,
    })
    ctx.page.drawText(formatCents(line.unit_price_cents), {
      x: COLS.price, y: rowTop, size: 9.5, font: ctx.font, color: NAVY,
    })

    const amount = formatCents(line.line_total_cents)
    ctx.page.drawText(amount, {
      x: COLS.total - ctx.bold.widthOfTextAtSize(amount, 9.5), y: rowTop,
      size: 9.5, font: ctx.bold, color: NAVY,
    })

    ctx.y = rowTop - blockHeight
    ctx.page.drawLine({
      start: { x: MARGIN, y: ctx.y + 4 }, end: { x: PAGE.width - MARGIN, y: ctx.y + 4 },
      thickness: 0.5, color: LIGHT_GREY,
    })
    ctx.y -= 6
  }
}

function drawTotals(ctx: Ctx, input: EstimatePdfInput): void {
  ensure(ctx, 92)
  ctx.y -= 6

  const labelX = PAGE.width - MARGIN - 190
  const valueX = PAGE.width - MARGIN

  const row = (label: string, value: string, opts: { bold?: boolean; size?: number; color?: typeof NAVY } = {}) => {
    const size = opts.size ?? 9.5
    const f = opts.bold ? ctx.bold : ctx.font
    ctx.page.drawText(label, { x: labelX, y: ctx.y, size, font: f, color: opts.color ?? GREY })
    ctx.page.drawText(value, {
      x: valueX - f.widthOfTextAtSize(value, size), y: ctx.y, size, font: f, color: opts.color ?? NAVY,
    })
    ctx.y -= size + 5
  }

  row('Subtotal', formatCents(input.estimate.subtotal_cents))
  if (input.estimate.discount_cents > 0) {
    row('Discount', `-${formatCents(input.estimate.discount_cents)}`)
  }
  if (input.taxEnabled && input.estimate.tax_cents > 0) {
    row(`Tax (${input.estimate.tax_percent}%)`, formatCents(input.estimate.tax_cents))
  }

  ctx.y -= 3
  ctx.page.drawRectangle({
    x: labelX - 12, y: ctx.y - 6, width: PAGE.width - MARGIN - labelX + 12, height: 24, color: NAVY,
  })
  ctx.page.drawText('TOTAL', { x: labelX, y: ctx.y, size: 11, font: ctx.bold, color: WHITE })
  const total = formatCents(input.estimate.total_cents)
  ctx.page.drawText(total, {
    x: valueX - ctx.bold.widthOfTextAtSize(total, 11), y: ctx.y, size: 11, font: ctx.bold, color: WHITE,
  })
  ctx.y -= 34
}

function drawNotes(ctx: Ctx, input: EstimatePdfInput): void {
  const blocks: { heading: string; body: string[] }[] = []

  if (input.assumptions?.length) {
    blocks.push({ heading: 'ASSUMPTIONS', body: input.assumptions.map(a => `- ${a}`) })
  }
  if (input.estimate.customer_notes) {
    blocks.push({ heading: 'NOTES', body: input.estimate.customer_notes.split('\n').filter(Boolean) })
  }

  for (const block of blocks) {
    ensure(ctx, 40)
    text(ctx, block.heading, { size: 7.5, bold: true, color: GREY })
    ctx.y -= 13
    for (const paragraph of block.body) {
      for (const line of wrap(ctx.font, paragraph, 8.5, CONTENT_WIDTH, 12)) {
        ensure(ctx, 12)
        text(ctx, line, { size: 8.5, color: NAVY })
        ctx.y -= 11
      }
    }
    ctx.y -= 10
  }

  // Acceptance block — a real signature line, not a promise of e-signature.
  ensure(ctx, 78)
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.y + 6 }, end: { x: PAGE.width - MARGIN, y: ctx.y + 6 },
    thickness: 0.5, color: LIGHT_GREY,
  })
  ctx.y -= 12
  text(ctx, 'ACCEPTANCE', { size: 7.5, bold: true, color: GREY })
  ctx.y -= 13
  text(ctx, 'Signing below authorizes the scope and pricing above and constitutes acceptance of this estimate.', {
    size: 8, color: GREY,
  })
  ctx.y -= 32

  const half = CONTENT_WIDTH / 2 - 16
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.y }, end: { x: MARGIN + half, y: ctx.y },
    thickness: 0.75, color: GREY,
  })
  ctx.page.drawLine({
    start: { x: MARGIN + half + 32, y: ctx.y }, end: { x: PAGE.width - MARGIN, y: ctx.y },
    thickness: 0.75, color: GREY,
  })
  ctx.y -= 11
  text(ctx, 'Customer signature', { size: 7.5, color: GREY })
  text(ctx, 'Date', { size: 7.5, color: GREY, x: MARGIN + half + 32 })
  ctx.y -= 20
}

async function drawPhotos(ctx: Ctx, input: EstimatePdfInput): Promise<void> {
  const photos = (input.photos ?? []).slice(0, 8)
  if (photos.length === 0) return

  newPage(ctx)
  text(ctx, 'PROJECT PHOTOS', { size: 7.5, bold: true, color: GREY })
  ctx.y -= 18

  const cellWidth = (CONTENT_WIDTH - 16) / 2
  const cellHeight = 150
  let column = 0

  for (const photo of photos) {
    let embedded
    try {
      embedded = photo.mimeType === 'image/png'
        ? await ctx.pdf.embedPng(photo.bytes)
        : await ctx.pdf.embedJpg(photo.bytes)
    } catch (error) {
      // A corrupt or unsupported image must not cost the whole PDF.
      console.error('[estimate-pdf] could not embed a photo, skipping', error)
      continue
    }

    if (column === 0 && ctx.y - cellHeight - 24 < MARGIN + 40) newPage(ctx)

    const x = MARGIN + column * (cellWidth + 16)
    const scale = Math.min(cellWidth / embedded.width, cellHeight / embedded.height)
    const width = embedded.width * scale
    const height = embedded.height * scale

    ctx.page.drawImage(embedded, {
      x: x + (cellWidth - width) / 2, y: ctx.y - height, width, height,
    })

    if (photo.caption) {
      ctx.page.drawText(clip(photo.caption, ctx.font, 8, cellWidth), {
        x, y: ctx.y - cellHeight - 11, size: 8, font: ctx.font, color: GREY,
      })
    }

    column += 1
    if (column === 2) {
      column = 0
      ctx.y -= cellHeight + 26
    }
  }
}

function drawFooterOnAllPages(ctx: Ctx, input: EstimatePdfInput): void {
  const pages = ctx.pdf.getPages()
  pages.forEach((page, index) => {
    page.drawLine({
      start: { x: MARGIN, y: MARGIN + 22 }, end: { x: PAGE.width - MARGIN, y: MARGIN + 22 },
      thickness: 0.5, color: LIGHT_GREY,
    })
    page.drawText(
      clip(
        `${ctx.company.name}  |  ${ctx.company.phone}  |  ${ctx.company.licenseGC} / ${ctx.company.licenseRoof}`,
        ctx.font, 7.5, CONTENT_WIDTH - 80,
      ),
      { x: MARGIN, y: MARGIN + 10, size: 7.5, font: ctx.font, color: GREY },
    )
    const stamp = `${input.estimate.estimate_number}  ·  Page ${index + 1} of ${pages.length}`
    page.drawText(stamp, {
      x: PAGE.width - MARGIN - ctx.font.widthOfTextAtSize(stamp, 7.5),
      y: MARGIN + 10, size: 7.5, font: ctx.font, color: GREY,
    })
  })
}

/** 2 → "2", 2.5 → "2.5", 2.50 → "2.5". Trailing zeros look like a typo. */
function formatQuantity(quantity: number): string {
  if (Number.isInteger(quantity)) return String(quantity)
  return String(Math.round(quantity * 10000) / 10000)
}

/** Filename for a single estimate inside a batch ZIP. */
export function estimatePdfFilename(estimate: Estimate, customerName: string): string {
  const safeCustomer = (customerName || 'Customer')
    .replace(/[^A-Za-z0-9 ]+/g, '')
    .trim().replace(/\s+/g, '_').slice(0, 40)
  const safeTitle = (estimate.title || 'Estimate')
    .replace(/[^A-Za-z0-9 ]+/g, '')
    .trim().replace(/\s+/g, '_').slice(0, 40)
  return `${estimate.estimate_number}_${safeCustomer}_${safeTitle}.pdf`
}
