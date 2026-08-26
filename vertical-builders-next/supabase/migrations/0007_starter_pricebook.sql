-- ============================================================================
-- Vertical Ops — Migration 0007: starter pricebook
-- ----------------------------------------------------------------------------
-- IMPORTANT: every price below is a PLACEHOLDER of $0.00.
--
-- The pricebook exists so AI estimating has a company-approved catalog to draw
-- from instead of inventing numbers. Seeding it with invented prices would
-- defeat that entirely — a plausible-looking wrong price is worse than a blank
-- one, because nobody questions it.
--
-- What this migration gives you is the STRUCTURE: the line items a Vertical
-- Builders estimate actually contains, with the right units. Fill in the prices
-- in Settings -> Pricebook. Until an item has a price, the estimate builder
-- flags any line using it for review.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Re-runnable. `on conflict` needs something to conflict ON, and the primary
-- key is a fresh uuid every time — so without the unique index below, running
-- this migration twice silently seeds 52 duplicate items into the estimate
-- picker. The dedupe runs first so the index can be created even on a database
-- where the earlier version of this migration was already applied twice.
-- ----------------------------------------------------------------------------
delete from public.pricebook_items a
  using public.pricebook_items b
 where a.name = b.name
   and a.ctid > b.ctid;

create unique index if not exists pricebook_items_name_key
  on public.pricebook_items (name);

insert into public.pricebook_items (name, category, service_type, description, unit, default_unit_price_cents, active, tags)
values
  -- ---- Roofing ------------------------------------------------------------
  ('Architectural shingle roof — tear-off and replace', 'Roofing', 'Roofing',
   'Remove existing layers, inspect and replace damaged decking separately, install underlayment and architectural shingles.', 'SQ', 0, true, '{"needs-price"}'),
  ('Roof underlayment — synthetic', 'Roofing', 'Roofing',
   'Synthetic underlayment, installed.', 'SQ', 0, true, '{"needs-price"}'),
  ('Peel-and-stick secondary water barrier', 'Roofing', 'Roofing',
   'Self-adhered membrane over the deck, Florida code compliance item.', 'SQ', 0, true, '{"needs-price","florida-code"}'),
  ('Decking replacement — 4x8 sheet', 'Roofing', 'Roofing',
   'Replace rotten or delaminated sheathing. Priced per sheet, quantity confirmed after tear-off.', 'EA', 0, true, '{"needs-price","allowance"}'),
  ('Ridge vent', 'Roofing', 'Roofing', 'Cut and install ridge vent.', 'LF', 0, true, '{"needs-price"}'),
  ('Drip edge', 'Roofing', 'Roofing', 'Install drip edge at eaves and rakes.', 'LF', 0, true, '{"needs-price"}'),
  ('Valley metal', 'Roofing', 'Roofing', 'Install valley flashing.', 'LF', 0, true, '{"needs-price"}'),
  ('Pipe boot flashing', 'Roofing', 'Roofing', 'Replace plumbing vent boot.', 'EA', 0, true, '{"needs-price"}'),
  ('Emergency tarp / dry-in', 'Roofing', 'Storm Damage / Emergency Tarp',
   'Temporary tarp or dry-in to stop active water intrusion.', 'SQ', 0, true, '{"needs-price","emergency"}'),
  ('Roof repair — labor', 'Roofing', 'Roofing', 'Diagnostic and repair labor.', 'HR', 0, true, '{"needs-price"}'),
  ('Debris disposal / dumpster', 'Disposal', 'Roofing', 'Haul-off and disposal.', 'EA', 0, true, '{"needs-price"}'),

  -- ---- Interior / water damage --------------------------------------------
  ('Drywall ceiling repair', 'Interior', 'Ceiling / Interior Repair',
   'Cut out damaged drywall, replace, tape, float and texture to match.', 'SF', 0, true, '{"needs-price"}'),
  ('Drywall hang and finish', 'Interior', 'Ceiling / Interior Repair',
   'Hang, tape, float, sand to level 4.', 'SF', 0, true, '{"needs-price"}'),
  ('Interior painting', 'Interior', 'Ceiling / Interior Repair',
   'Prime and two finish coats.', 'SF', 0, true, '{"needs-price"}'),
  ('Insulation replacement — batt', 'Interior', 'Ceiling / Interior Repair',
   'Remove wet insulation and replace.', 'SF', 0, true, '{"needs-price"}'),
  ('Water damage mitigation — day rate', 'Interior', 'Water Damage Repair',
   'Equipment, monitoring and labor.', 'DAY', 0, true, '{"needs-price"}'),

  -- ---- Outdoor / structures -----------------------------------------------
  ('Pool cage rescreen', 'Screen / Lanai', 'Pool / Lanai / Outdoor Living',
   'Remove old screen and spline, install new screen.', 'SF', 0, true, '{"needs-price"}'),
  ('Pool cage rebuild — aluminum frame', 'Screen / Lanai', 'Pool / Lanai / Outdoor Living',
   'Engineered aluminum enclosure frame.', 'SF', 0, true, '{"needs-price","engineering"}'),
  ('Paver deck installation', 'Pavers', 'Pavers & Concrete',
   'Base prep, sand, pavers, edge restraint.', 'SF', 0, true, '{"needs-price"}'),
  ('Concrete slab pour', 'Concrete', 'Pavers & Concrete',
   'Form, reinforce, pour and finish.', 'SF', 0, true, '{"needs-price"}'),

  -- ---- Openings ------------------------------------------------------------
  ('Impact window — installed', 'Windows / Doors', 'Impact Windows & Doors',
   'Remove existing unit, install impact-rated window, seal and trim.', 'EA', 0, true, '{"needs-price"}'),
  ('Impact door — installed', 'Windows / Doors', 'Impact Windows & Doors',
   'Remove existing unit, install impact-rated door.', 'EA', 0, true, '{"needs-price"}'),

  -- ---- Project-wide --------------------------------------------------------
  ('Permit fee — allowance', 'Permit / Fees', null,
   'Jurisdiction permit fee. Billed at cost; confirm with the building department.', 'LS', 0, true, '{"needs-price","allowance"}'),
  ('Structural engineering', 'Engineering', null,
   'Engineered drawings and sealed letter where required.', 'LS', 0, true, '{"needs-price"}'),
  ('Mobilization / setup', 'Other', null,
   'Crew mobilization, protection, site setup and cleanup.', 'LS', 0, true, '{"needs-price"}'),
  ('General labor', 'Labor', null, 'Crew labor.', 'HR', 0, true, '{"needs-price"}')
on conflict (name) do nothing;
