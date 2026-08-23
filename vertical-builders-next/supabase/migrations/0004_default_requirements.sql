-- ============================================================================
-- Vertical Ops — Migration 0004: starter insurance requirement template
-- ----------------------------------------------------------------------------
-- IMPORTANT: these numbers are EDITABLE STARTING POINTS, not legal advice and
-- not a statement of what Vertical Builders & Commercial actually requires.
-- Confirm every line with the company's insurance/risk professional in
-- Settings → Insurance Requirements before relying on the compliance results.
-- ============================================================================

insert into public.insurance_requirement_templates (id, name, scope, active, disclaimer)
values (
  '00000000-0000-4000-8000-000000000001',
  'Global Default — Subcontractor Minimums',
  'global',
  true,
  'Starter values only. Verify these requirements with Vertical Builders & Commercial''s insurance professional before relying on them.'
)
on conflict (id) do nothing;

insert into public.insurance_requirements (
  template_id, coverage_type, required,
  min_limit_each_occurrence, min_limit_aggregate, min_combined_single_limit, min_workers_comp_el,
  additional_insured_required, waiver_of_subrogation_required, primary_noncontributory_required,
  endorsement_required, notes)
values
  ('00000000-0000-4000-8000-000000000001','general_liability',    true, 1000000, 2000000, null,    null,
   true, true, true, false, 'Starter value — confirm with the company insurance professional.'),
  ('00000000-0000-4000-8000-000000000001','workers_compensation', true, null,    null,    null,    1000000,
   false, true, false, false, 'A valid Florida WC exemption certificate may be accepted in place of a policy — record it as a document and waive with a documented reason.'),
  ('00000000-0000-4000-8000-000000000001','commercial_auto',      true, null,    null,    1000000, null,
   true, false, false, false, 'Starter value — confirm with the company insurance professional.'),
  ('00000000-0000-4000-8000-000000000001','umbrella',             false,1000000, 1000000, null,    null,
   false, false, false, false, 'Not required by default. Enable per trade or per project where the contract calls for it.')
on conflict (template_id, coverage_type) do nothing;
