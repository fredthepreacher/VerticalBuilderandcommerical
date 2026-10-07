/**
 * ============================================================================
 * PERMIT CLASSIFIER — deterministic, no LLM
 * ----------------------------------------------------------------------------
 * County permit descriptions are free text and wildly inconsistent. This turns
 * one into a coarse class the screening engine can reason about, WITHOUT calling
 * a model — straightforward classification is a job for rules, and rules are
 * auditable, free, and instant.
 *
 * The load-bearing rule: "contains the word roof" is NOT "a full replacement".
 * A repair, a recover/overlay, a solar mount, or a roof inspection must never be
 * read as a completed reroof, or we would disqualify a live opportunity.
 *
 * The original text is never modified — only classified — and every decision
 * returns the reason(s) that produced it.
 * ============================================================================
 */

export type PermitClass =
  | 'full_replacement'
  | 'recover'
  | 'repair'
  | 'inspection'
  | 'solar_roof'
  | 'unknown_roof'
  | 'not_roof'

export type RoofMaterialFamily = 'shingle' | 'tile' | 'metal' | 'flat' | 'slate' | 'wood' | null

export interface PermitClassification {
  permitClass: PermitClass
  /** True only for full_replacement — the one class that means "roof already renewed". */
  isFullReplacement: boolean
  material: RoofMaterialFamily
  reasons: string[]
  /** The text this was derived from, preserved verbatim. */
  sourceText: string
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9%.\s/-]+/g, ' ').replace(/\s+/g, ' ').trim()

// A "roof" signal at all.
const ROOF_SIGNAL = /\broof|\breroof|\bre-roof|\breroofing|\broofing|shingle|tile roof|metal roof/

// Full replacement verbs. Tear-off / strip to deck / full replacement / reshingle.
// Deliberately precise: "replace 10 shingles" is a REPAIR, not a replacement, so
// the verb form here only matches replacing the ROOF itself, never a shingle count.
const FULL_REPLACEMENT = [
  /\bre-?roof(ing|ed)?\b/,
  /\broof\s+replacement\b/,
  /\breplace\s+(the\s+|entire\s+|whole\s+|existing\s+)*roof\b/,
  /\btear[\s-]?off\b/,
  /\bstrip\s+(to\s+)?(the\s+)?deck\b/,
  /\breshingle\b/,
  /\bnew\s+roof\b/,
  /\bfull\s+roof\b/,
]
// Recover / overlay — a layer added, roof not renewed to deck.
const RECOVER = [/\brecover\b/, /\boverlay\b/, /\broof[\s-]?over\b/, /\bsecond\s+layer\b/]
// Repair / patch — partial.
const REPAIR = [/\brepair\b/, /\bpatch\b/, /\bleak\b/, /\breplace\s+\d+\s+(shingles|tiles)\b/, /\bpartial\b/]
// Inspection / certification only.
const INSPECTION = [/\binspection\b/, /\binspect\b/, /\bcertif/, /\breport\s+only\b/, /\bmail[\s-]?in\b/]
// Solar that merely mentions the roof.
const SOLAR = [/\bsolar\b/, /\bpv\b/, /\bphotovoltaic\b/, /\bpanel/]

const MATERIALS: [RoofMaterialFamily, RegExp][] = [
  ['shingle', /shingle|asphalt|architectural|3[\s-]?tab|comp(osition)?\b/],
  ['tile', /\btile\b|clay|concrete tile/],
  ['metal', /metal|standing seam|steel|aluminum|\bmetal roof\b/],
  ['flat', /\bflat\b|tpo|epdm|modified bitumen|built[\s-]?up|\bbur\b|membrane|low[\s-]?slope/],
  ['slate', /\bslate\b/],
  ['wood', /wood shake|\bshake\b|cedar/],
]

function detectMaterial(text: string): { material: RoofMaterialFamily; reason?: string } {
  for (const [family, re] of MATERIALS) {
    if (re.test(text)) return { material: family, reason: `material keyword matched "${family}"` }
  }
  return { material: null }
}

function anyMatch(text: string, patterns: RegExp[]): boolean {
  return patterns.some(re => re.test(text))
}

/**
 * Classify a permit from its type and description. `permitType` (a structured
 * column when present) is trusted alongside the free-text description.
 */
export function classifyPermit(input: {
  permitType?: string | null
  permitDescription?: string | null
}): PermitClassification {
  const sourceText = [input.permitType, input.permitDescription].filter(Boolean).join(' — ')
  const text = norm(sourceText)
  const reasons: string[] = []

  const { material, reason: matReason } = detectMaterial(text)
  if (matReason) reasons.push(matReason)

  if (!text) {
    return { permitClass: 'not_roof', isFullReplacement: false, material, reasons: ['no permit text supplied'], sourceText }
  }

  const hasRoofSignal = ROOF_SIGNAL.test(text)

  // Solar takes precedence when it's clearly a solar job — a solar permit that
  // says "roof mount" is not a reroof, and must not disqualify the prospect.
  if (anyMatch(text, SOLAR)) {
    reasons.push('solar/PV keyword present')
    return { permitClass: 'solar_roof', isFullReplacement: false, material, reasons, sourceText }
  }

  // Inspection-only, when there is no replacement verb.
  if (anyMatch(text, INSPECTION) && !anyMatch(text, FULL_REPLACEMENT)) {
    reasons.push('inspection/certification wording, no replacement verb')
    return { permitClass: 'inspection', isFullReplacement: false, material, reasons, sourceText }
  }

  // Full replacement. Tear-off wins even if "repair" also appears
  // ("tear off and repair decking" is still a replacement).
  if (anyMatch(text, FULL_REPLACEMENT)) {
    reasons.push('full-replacement verb (reroof / tear-off / replace / reshingle)')
    return { permitClass: 'full_replacement', isFullReplacement: true, material, reasons, sourceText }
  }

  // Recover / overlay — explicitly NOT a full replacement.
  if (anyMatch(text, RECOVER)) {
    reasons.push('recover/overlay wording — a layer added, not a renewal to deck')
    return { permitClass: 'recover', isFullReplacement: false, material, reasons, sourceText }
  }

  // Repair / patch — partial work.
  if (anyMatch(text, REPAIR)) {
    reasons.push('repair/patch wording — partial work, not a replacement')
    return { permitClass: 'repair', isFullReplacement: false, material, reasons, sourceText }
  }

  // Mentions roof but no verb we recognise → ambiguous, send to review.
  if (hasRoofSignal) {
    reasons.push('mentions roofing but no clear replacement/repair/recover verb')
    return { permitClass: 'unknown_roof', isFullReplacement: false, material, reasons, sourceText }
  }

  reasons.push('no roofing signal in permit text')
  return { permitClass: 'not_roof', isFullReplacement: false, material, reasons, sourceText }
}
