-- ============================================================================
-- Vertical Ops — DEMO seed data.  DEVELOPMENT / STAGING ONLY.
-- ----------------------------------------------------------------------------
-- Everything created here is prefixed "[DEMO]" so it is obvious in the UI and
-- trivial to remove:  see the DELETE block at the bottom of this file.
-- Do NOT run this against the production project once real data exists.
-- ============================================================================

begin;

-- ---- contacts -------------------------------------------------------------
insert into public.contacts (id, contact_type, first_name, last_name, company_name, email, phone, billing_address, city, state, zip, tags)
values
 ('11111111-0000-4000-8000-000000000001','homeowner','Marie','Delacroix',null,'demo.marie@example.com','941-555-0142','118 Bayshore Rd','Nokomis','FL','34275','{"[DEMO]"}'),
 ('11111111-0000-4000-8000-000000000002','business',null,null,'Gulfview Plaza LLC','demo.ops@example.com','941-555-0177','2400 S Tamiami Trl','Venice','FL','34293','{"[DEMO]"}'),
 ('11111111-0000-4000-8000-000000000003','property_manager','Alan','Whitfield','Coastline PM','demo.alan@example.com','941-555-0198','77 Harbor Dr','Sarasota','FL','34236','{"[DEMO]"}')
on conflict (id) do nothing;

-- ---- projects -------------------------------------------------------------
insert into public.projects (id, project_number, project_name, customer_id, jobsite_address, city, state, zip, customer_type, service_category, status, start_date, estimated_completion_date, description)
values
 ('22222222-0000-4000-8000-000000000001','VBC-DEMO-0001','[DEMO] Delacroix Roof Replacement','11111111-0000-4000-8000-000000000001','118 Bayshore Rd','Nokomis','FL','34275','residential','Roofing','in_progress', current_date - 40, current_date + 10,'Full tear-off and shingle replacement after storm damage.'),
 ('22222222-0000-4000-8000-000000000002','VBC-DEMO-0002','[DEMO] Gulfview Plaza Storefront Build-Out','11111111-0000-4000-8000-000000000002','2400 S Tamiami Trl','Venice','FL','34293','commercial','New Construction','permitting', current_date - 15, current_date + 120,'Interior build-out of two commercial suites.'),
 ('22222222-0000-4000-8000-000000000003','VBC-DEMO-0003','[DEMO] Coastline Lanai & Pool Cage','11111111-0000-4000-8000-000000000003','77 Harbor Dr','Sarasota','FL','34236','residential','Pools & Lanais','scheduled', current_date + 20, current_date + 75,'Pool cage rebuild and paver deck.')
on conflict (id) do nothing;

-- ---- leads ----------------------------------------------------------------
insert into public.leads (id, source, source_page, first_name, last_name, email, phone, customer_type, service_type, property_address, city, zip, project_description, pipeline_stage, timeline, created_at)
values
 ('33333333-0000-4000-8000-000000000001','website','/roofing','[DEMO] Tanya','Brooks','demo.tanya@example.com','941-555-0110','residential','Roofing','9 Palm Ct','Venice','34285','Missing shingles after the last storm, ceiling stain in the hallway.','new','ASAP', now() - interval '2 days'),
 ('33333333-0000-4000-8000-000000000002','website','/pools-lanais','[DEMO] Victor','Nunes','demo.victor@example.com','941-555-0121','residential','Pool / Lanai / Outdoor Living','412 Sunset Dr','North Port','34287','Want to rescreen the pool cage and add a paver deck.','contacted','1-3 months', now() - interval '6 days'),
 ('33333333-0000-4000-8000-000000000003','website','/general-contracting-services','[DEMO] Priya','Raman','demo.priya@example.com','941-555-0133','commercial','Other','1120 Commerce Way','Sarasota','34240','Tenant improvement for a 3,000 sqft office suite.','estimate_sent','3-6 months', now() - interval '11 days'),
 ('33333333-0000-4000-8000-000000000004','website','/interior-repair','[DEMO] Owen','Fairbanks','demo.owen@example.com','941-555-0144','residential','Ceiling / Interior Repair','63 Live Oak Ln','Englewood','34223','Water damaged ceiling in the master bedroom.','follow_up','ASAP', now() - interval '19 days'),
 ('33333333-0000-4000-8000-000000000005','website','/','[DEMO] Grace','Mbeki','demo.grace@example.com','941-555-0155','residential','Remodeling','305 Casey Key Rd','Nokomis','34275','Kitchen remodel, looking for pricing.','won','Flexible', now() - interval '31 days')
on conflict (id) do nothing;

-- ---- vendors --------------------------------------------------------------
insert into public.vendors (id, legal_name, dba, vendor_type, primary_trade, trades, status, contact_first_name, contact_last_name, email, phone, city, state, zip, license_number, license_type, license_expiration_date, w9_status, notes)
values
 ('44444444-0000-4000-8000-000000000001','[DEMO] ABC Roofing Systems LLC','ABC Roofing','subcontractor','Roofing','{"Roofing"}','active','Dan','Ortiz','demo.dan@example.com','941-555-0201','Venice','FL','34285','CCC1330001','Roofing', current_date + 300,'on_file','Fully papered — the happy path example.'),
 ('44444444-0000-4000-8000-000000000002','[DEMO] XYZ Drywall & Finish Inc','XYZ Drywall','subcontractor','Drywall','{"Drywall","Painting"}','active','Rosa','Klein','demo.rosa@example.com','941-555-0202','Sarasota','FL','34232','SCC131150001','Specialty', current_date + 45,'on_file','GL expires soon — exercises the 30-day warning.'),
 ('44444444-0000-4000-8000-000000000003','[DEMO] Sunline Electric Co','Sunline','subcontractor','Electrical','{"Electrical"}','active','Marcus','Webb','demo.marcus@example.com','941-555-0203','North Port','FL','34287','EC13000001','Electrical', current_date + 190,'missing','No workers comp on file — exercises MISSING.'),
 ('44444444-0000-4000-8000-000000000004','[DEMO] Coastal Concrete & Pavers','Coastal Concrete','subcontractor','Concrete','{"Concrete","Pavers"}','active','Ivan','Petrov','demo.ivan@example.com','941-555-0204','Port Charlotte','FL','33952','CGC1520002','General', current_date - 20,'on_file','Expired GL — exercises NON_COMPLIANT.'),
 ('44444444-0000-4000-8000-000000000005','[DEMO] Bright Screen Enclosures','Bright Screen','subcontractor','Screen / Lanai','{"Screen / Lanai"}','pending','Nina','Alvarez','demo.nina@example.com','941-555-0205','Englewood','FL','34223',null,null,null,'missing','Certificate uploaded but not yet reviewed — exercises NEEDS_REVIEW.')
on conflict (id) do nothing;

-- ---- project assignments --------------------------------------------------
insert into public.project_vendors (project_id, vendor_id, scope_of_work, start_date, active)
values
 ('22222222-0000-4000-8000-000000000001','44444444-0000-4000-8000-000000000001','Tear-off, dry-in, shingle install', current_date - 40, true),
 ('22222222-0000-4000-8000-000000000001','44444444-0000-4000-8000-000000000002','Interior ceiling and drywall repair', current_date - 25, true),
 ('22222222-0000-4000-8000-000000000002','44444444-0000-4000-8000-000000000003','Electrical rough-in and panel', current_date - 10, true),
 ('22222222-0000-4000-8000-000000000003','44444444-0000-4000-8000-000000000004','Paver deck and concrete footers', current_date + 20, true),
 ('22222222-0000-4000-8000-000000000003','44444444-0000-4000-8000-000000000005','Pool cage rebuild and rescreen', current_date + 30, true)
on conflict (project_id, vendor_id) do nothing;

-- ---- certificates + policy lines -----------------------------------------
-- 1. ABC Roofing — fully compliant, approved
insert into public.insurance_certificates (id, vendor_id, received_at, issue_date, broker_name, broker_contact_name, broker_email, named_insured, source, review_status, reviewed_at, version)
values ('55555555-0000-4000-8000-000000000001','44444444-0000-4000-8000-000000000001', now() - interval '60 days', current_date - 60,'Gulf Coast Insurance Group','Helen Ward','demo.helen@example.com','ABC Roofing Systems LLC','admin_upload','approved', now() - interval '59 days',1)
on conflict (id) do nothing;
insert into public.insurance_policies (certificate_id, coverage_type, carrier, policy_number, effective_date, expiration_date, limits_json, additional_insured, waiver_of_subrogation, primary_noncontributory, occurrence_form)
values
 ('55555555-0000-4000-8000-000000000001','general_liability','Southern Owners','GL-4471902', current_date - 60, current_date + 305,'{"each_occurrence":1000000,"general_aggregate":2000000,"products_completed_ops_aggregate":2000000,"damage_to_rented_premises":100000,"med_exp":5000,"personal_adv_injury":1000000}'::jsonb,true,true,true,true),
 ('55555555-0000-4000-8000-000000000001','workers_compensation','FCCI','WC-9910233', current_date - 60, current_date + 305,'{"statutory":true,"el_each_accident":1000000,"el_disease_each_employee":1000000,"el_disease_policy_limit":1000000}'::jsonb,false,true,false,null),
 ('55555555-0000-4000-8000-000000000001','commercial_auto','Progressive Commercial','CA-7781200', current_date - 60, current_date + 305,'{"combined_single_limit":1000000}'::jsonb,true,false,false,null);

-- 2. XYZ Drywall — compliant but GL expires in 21 days (EXPIRING_SOON)
insert into public.insurance_certificates (id, vendor_id, received_at, issue_date, broker_name, named_insured, source, review_status, reviewed_at, version)
values ('55555555-0000-4000-8000-000000000002','44444444-0000-4000-8000-000000000002', now() - interval '340 days', current_date - 340,'Suncoast Risk Partners','XYZ Drywall & Finish Inc','admin_upload','approved', now() - interval '339 days',1)
on conflict (id) do nothing;
insert into public.insurance_policies (certificate_id, coverage_type, carrier, policy_number, effective_date, expiration_date, limits_json, additional_insured, waiver_of_subrogation, primary_noncontributory, occurrence_form)
values
 ('55555555-0000-4000-8000-000000000002','general_liability','Auto-Owners','GL-2210044', current_date - 340, current_date + 21,'{"each_occurrence":1000000,"general_aggregate":2000000,"products_completed_ops_aggregate":2000000}'::jsonb,true,true,true,true),
 ('55555555-0000-4000-8000-000000000002','workers_compensation','FCCI','WC-2210045', current_date - 340, current_date + 21,'{"statutory":true,"el_each_accident":1000000,"el_disease_each_employee":1000000,"el_disease_policy_limit":1000000}'::jsonb,false,true,false,null),
 ('55555555-0000-4000-8000-000000000002','commercial_auto','Progressive Commercial','CA-2210046', current_date - 340, current_date + 21,'{"combined_single_limit":1000000}'::jsonb,true,false,false,null);

-- 3. Sunline Electric — GL only, workers comp MISSING
insert into public.insurance_certificates (id, vendor_id, received_at, issue_date, broker_name, named_insured, source, review_status, reviewed_at, version)
values ('55555555-0000-4000-8000-000000000003','44444444-0000-4000-8000-000000000003', now() - interval '90 days', current_date - 90,'Bayfront Insurance','Sunline Electric Co','admin_upload','approved', now() - interval '88 days',1)
on conflict (id) do nothing;
insert into public.insurance_policies (certificate_id, coverage_type, carrier, policy_number, effective_date, expiration_date, limits_json, additional_insured, waiver_of_subrogation, primary_noncontributory, occurrence_form)
values
 ('55555555-0000-4000-8000-000000000003','general_liability','Hanover','GL-5580031', current_date - 90, current_date + 270,'{"each_occurrence":1000000,"general_aggregate":2000000,"products_completed_ops_aggregate":2000000}'::jsonb,true,true,true,true),
 ('55555555-0000-4000-8000-000000000003','commercial_auto','Travelers','CA-5580032', current_date - 90, current_date + 270,'{"combined_single_limit":1000000}'::jsonb,true,false,false,null);

-- 4. Coastal Concrete — historical (replaced) cert + current EXPIRED cert
insert into public.insurance_certificates (id, vendor_id, received_at, issue_date, broker_name, named_insured, source, review_status, reviewed_at, version)
values ('55555555-0000-4000-8000-000000000004','44444444-0000-4000-8000-000000000004', now() - interval '730 days', current_date - 730,'Harbor Insurance Advisors','Coastal Concrete & Pavers','admin_upload','replaced', now() - interval '729 days',1)
on conflict (id) do nothing;
insert into public.insurance_policies (certificate_id, coverage_type, carrier, policy_number, effective_date, expiration_date, limits_json, additional_insured, waiver_of_subrogation, primary_noncontributory, occurrence_form)
values
 ('55555555-0000-4000-8000-000000000004','general_liability','Nationwide','GL-1000111', current_date - 730, current_date - 365,'{"each_occurrence":1000000,"general_aggregate":2000000,"products_completed_ops_aggregate":2000000}'::jsonb,true,true,true,true),
 ('55555555-0000-4000-8000-000000000004','workers_compensation','FCCI','WC-1000112', current_date - 730, current_date - 365,'{"statutory":true,"el_each_accident":1000000,"el_disease_each_employee":1000000,"el_disease_policy_limit":1000000}'::jsonb,false,true,false,null);

insert into public.insurance_certificates (id, vendor_id, received_at, issue_date, broker_name, named_insured, source, review_status, reviewed_at, replaced_certificate_id, version)
values ('55555555-0000-4000-8000-000000000005','44444444-0000-4000-8000-000000000004', now() - interval '365 days', current_date - 365,'Harbor Insurance Advisors','Coastal Concrete & Pavers','admin_upload','approved', now() - interval '364 days','55555555-0000-4000-8000-000000000004',2)
on conflict (id) do nothing;
insert into public.insurance_policies (certificate_id, coverage_type, carrier, policy_number, effective_date, expiration_date, limits_json, additional_insured, waiver_of_subrogation, primary_noncontributory, occurrence_form)
values
 ('55555555-0000-4000-8000-000000000005','general_liability','Nationwide','GL-1000221', current_date - 365, current_date - 20,'{"each_occurrence":500000,"general_aggregate":1000000,"products_completed_ops_aggregate":1000000}'::jsonb,true,false,false,true),
 ('55555555-0000-4000-8000-000000000005','workers_compensation','FCCI','WC-1000222', current_date - 365, current_date - 20,'{"statutory":true,"el_each_accident":1000000,"el_disease_each_employee":1000000,"el_disease_policy_limit":1000000}'::jsonb,false,true,false,null),
 ('55555555-0000-4000-8000-000000000005','commercial_auto','Travelers','CA-1000223', current_date - 365, current_date - 20,'{"combined_single_limit":500000}'::jsonb,false,false,false,null);

-- 5. Bright Screen — vendor-portal upload awaiting human review
insert into public.insurance_certificates (id, vendor_id, received_at, issue_date, broker_name, named_insured, source, review_status, version)
values ('55555555-0000-4000-8000-000000000006','44444444-0000-4000-8000-000000000005', now() - interval '2 days', current_date - 3,'Islandview Insurance','Bright Screen Enclosures','vendor_portal','needs_review',1)
on conflict (id) do nothing;
insert into public.insurance_policies (certificate_id, coverage_type, carrier, policy_number, effective_date, expiration_date, limits_json, additional_insured, waiver_of_subrogation, primary_noncontributory, occurrence_form)
values
 ('55555555-0000-4000-8000-000000000006','general_liability','Kinsale','GL-8890010', current_date - 3, current_date + 362,'{"each_occurrence":1000000,"general_aggregate":2000000,"products_completed_ops_aggregate":2000000}'::jsonb,true,true,true,true),
 ('55555555-0000-4000-8000-000000000006','workers_compensation','Employers','WC-8890011', current_date - 3, current_date + 362,'{"statutory":true,"el_each_accident":1000000,"el_disease_each_employee":1000000,"el_disease_policy_limit":1000000}'::jsonb,false,true,false,null),
 ('55555555-0000-4000-8000-000000000006','commercial_auto','Progressive Commercial','CA-8890012', current_date - 3, current_date + 362,'{"combined_single_limit":1000000}'::jsonb,true,false,false,null);

-- ---- an audit cycle covering the last six months --------------------------
insert into public.audit_cycles (id, name, audit_period_start, audit_period_end, status, notes)
values ('66666666-0000-4000-8000-000000000001','[DEMO] Trailing Six-Month Insurance Audit', current_date - 182, current_date,'draft','Demo cycle created by seed_demo.sql.')
on conflict (id) do nothing;

commit;

-- ============================================================================
-- To remove every demo record afterwards, run:
--
--   begin;
--   delete from public.insurance_policies where certificate_id in
--     (select id from public.insurance_certificates where vendor_id in
--       (select id from public.vendors where legal_name like '[DEMO]%'));
--   delete from public.insurance_certificates where vendor_id in
--     (select id from public.vendors where legal_name like '[DEMO]%');
--   delete from public.project_vendors where vendor_id in
--     (select id from public.vendors where legal_name like '[DEMO]%');
--   delete from public.vendors   where legal_name like '[DEMO]%';
--   delete from public.leads     where first_name like '[DEMO]%';
--   delete from public.projects  where project_name like '[DEMO]%';
--   delete from public.contacts  where '[DEMO]' = any(tags);
--   delete from public.audit_cycles where name like '[DEMO]%';
--   commit;
-- ============================================================================
