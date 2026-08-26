/**
 * ============================================================================
 * SMART OPS COMMUNICATION TEMPLATES — deterministic, nothing is sent
 * ----------------------------------------------------------------------------
 * These are fill-in-the-blank templates, not generated writing. They exist so
 * that a company with no AI budget still gets a decent first draft in two
 * seconds instead of staring at an empty box.
 *
 * Every placeholder that has no value is rendered as a visible [bracket] rather
 * than silently dropped, so nobody accidentally sends "Hi , about your ".
 *
 * Nothing here sends anything. The output is text on a screen with a Copy
 * button; the operator sends it themselves from their own mail client.
 * ============================================================================
 */

export type TemplateKey =
  | 'lead_first_response'
  | 'lead_follow_up'
  | 'inspection_confirmation'
  | 'unable_to_reach'
  | 'coi_renewal'
  | 'missing_document'

export interface TemplateContext {
  contactName?: string | null
  companyName?: string | null
  serviceType?: string | null
  propertyAddress?: string | null
  city?: string | null
  senderName?: string | null
  /** Company trading name, used in sign-offs. */
  businessName?: string | null
  businessPhone?: string | null
  appointmentWhen?: string | null
  coverageType?: string | null
  expirationDate?: string | null
  documentName?: string | null
}

export interface RenderedTemplate {
  key: TemplateKey
  label: string
  subject: string
  body: string
  /** Placeholders still needing a human. Surfaced so nothing goes out half-filled. */
  placeholders: string[]
}

const DEFAULT_BUSINESS = 'Vertical Builders & Commercial'

/** A value, or a visible bracket the sender cannot miss. */
function field(value: string | null | undefined, placeholder: string, missing: string[]): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (trimmed) return trimmed
  if (!missing.includes(placeholder)) missing.push(placeholder)
  return `[${placeholder}]`
}

export const TEMPLATE_LABELS: Record<TemplateKey, string> = {
  lead_first_response: 'Lead — first response',
  lead_follow_up: 'Lead — follow-up',
  inspection_confirmation: 'Inspection confirmation',
  unable_to_reach: 'Unable to reach',
  coi_renewal: 'COI renewal request',
  missing_document: 'Missing document request',
}

export function templateKeys(): TemplateKey[] {
  return Object.keys(TEMPLATE_LABELS) as TemplateKey[]
}

export function isTemplateKey(value: string): value is TemplateKey {
  return value in TEMPLATE_LABELS
}

export function renderTemplate(key: TemplateKey, context: TemplateContext = {}): RenderedTemplate {
  const missing: string[] = []
  const name = field(context.contactName, 'name', missing)
  const business = (context.businessName || DEFAULT_BUSINESS).trim()
  const sender = field(context.senderName, 'your name', missing)
  const phone = context.businessPhone?.trim()
  const signOff = [`Thanks,`, sender, business, phone].filter(Boolean).join('\n')

  switch (key) {
    case 'lead_first_response': {
      const service = field(context.serviceType, 'service', missing)
      const where = context.propertyAddress?.trim() || context.city?.trim() || ''
      return {
        key, label: TEMPLATE_LABELS[key],
        subject: `Your ${service} enquiry — ${business}`,
        body: [
          `Hi ${name},`,
          '',
          `Thanks for getting in touch about ${service}${where ? ` at ${where}` : ''}.`,
          '',
          `I'd like to come out and take a look so we can give you an accurate figure`,
          `rather than a guess over the phone. Does [day] or [day] suit you better?`,
          '',
          `The visit takes about [duration] and there is no charge for it.`,
          '',
          signOff,
        ].join('\n'),
        placeholders: [...missing, 'day', 'duration'],
      }
    }

    case 'lead_follow_up': {
      const service = field(context.serviceType, 'service', missing)
      return {
        key, label: TEMPLATE_LABELS[key],
        subject: `Following up — ${service}`,
        body: [
          `Hi ${name},`,
          '',
          `Just following up on the ${service} work we discussed. I know these things`,
          `have a way of dropping down the list, so no pressure either way — I only`,
          `wanted to check whether you'd like us to go ahead, or whether the timing`,
          `has changed.`,
          '',
          `If it's easier, reply with a time that suits and I'll call you.`,
          '',
          signOff,
        ].join('\n'),
        placeholders: missing,
      }
    }

    case 'inspection_confirmation': {
      const when = field(context.appointmentWhen, 'date and time', missing)
      const where = field(context.propertyAddress ?? context.city, 'address', missing)
      return {
        key, label: TEMPLATE_LABELS[key],
        subject: `Confirming your inspection — ${when}`,
        body: [
          `Hi ${name},`,
          '',
          `Confirming that we'll be at ${where} on ${when}.`,
          '',
          `We'll need access to [areas]. It usually takes about [duration], and you`,
          `don't need to be there for the whole visit as long as we can get in.`,
          '',
          `If anything changes, call or text ${phone ? phone : '[phone]'} and we'll rearrange.`,
          '',
          signOff,
        ].join('\n'),
        placeholders: [...missing, 'areas', 'duration', ...(phone ? [] : ['phone'])],
      }
    }

    case 'unable_to_reach': {
      const service = context.serviceType?.trim() || 'the work you enquired about'
      return {
        key, label: TEMPLATE_LABELS[key],
        subject: `Tried to reach you — ${business}`,
        body: [
          `Hi ${name},`,
          '',
          `I've tried you a couple of times about ${service} and haven't managed to`,
          `catch you. Rather than keep ringing, I thought I'd put it in writing.`,
          '',
          `If you'd still like a quote, reply here or call ${phone ? phone : '[phone]'}`,
          `and we'll get it booked in. If you've gone another way, that's completely`,
          `fine — just let me know and I'll close it off.`,
          '',
          signOff,
        ].join('\n'),
        placeholders: [...missing, ...(phone ? [] : ['phone'])],
      }
    }

    case 'coi_renewal': {
      const vendor = field(context.companyName, 'subcontractor', missing)
      const coverage = context.coverageType?.trim() || 'insurance coverage'
      const expiry = field(context.expirationDate, 'expiration date', missing)
      return {
        key, label: TEMPLATE_LABELS[key],
        subject: `Certificate of insurance renewal — ${vendor}`,
        body: [
          `Hi ${context.contactName?.trim() || 'there'},`,
          '',
          `Our records show ${vendor}'s ${coverage} expires on ${expiry}.`,
          '',
          `Could you ask your agent to send an updated certificate before then?`,
          `Please make sure it shows:`,
          '',
          `  · ${business} as certificate holder`,
          `  · Additional insured status`,
          `  · Waiver of subrogation`,
          `  · The limits required by our subcontractor agreement`,
          '',
          `We can't schedule work once a certificate has lapsed, so getting this in`,
          `ahead of time keeps everything moving.`,
          '',
          signOff,
        ].join('\n'),
        placeholders: missing,
      }
    }

    case 'missing_document': {
      const vendor = field(context.companyName, 'subcontractor', missing)
      const document = field(context.documentName, 'document', missing)
      return {
        key, label: TEMPLATE_LABELS[key],
        subject: `Outstanding paperwork — ${vendor}`,
        body: [
          `Hi ${context.contactName?.trim() || 'there'},`,
          '',
          `We're missing the following for ${vendor}:`,
          '',
          `  · ${document}`,
          '',
          `Could you send it across when you get a moment? We keep this on file for`,
          `audit purposes, and we're not able to put work your way until the file is`,
          `complete.`,
          '',
          `Reply to this message with the document attached and we'll take care of`,
          `the rest.`,
          '',
          signOff,
        ].join('\n'),
        placeholders: missing,
      }
    }
  }
}
