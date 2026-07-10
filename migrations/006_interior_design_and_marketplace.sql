-- ============================================================
-- Migration 006: Interior Design Studio + Construction Marketplace
-- Run this in Supabase SQL Editor after 005_visitor_management.sql.
-- Idempotent — safe to re-run. Only creates new tables.
-- ============================================================

-- -----------------------------------------------------------
-- 1. interior_designs: generated room redesigns
-- -----------------------------------------------------------
create table if not exists interior_designs (
    id                  uuid primary key default gen_random_uuid(),
    created_by          uuid,
    room_type           text not null,
    style               text not null,
    budget_tier         text not null,
    upload_image_url    text not null,
    enhanced_prompt     text,
    generated_images    jsonb,
    cost_estimate       jsonb,
    status              text not null default 'pending',
    error_message       text,
    created_at          timestamptz default now()
);

create index if not exists idx_interior_designs_created_by on interior_designs(created_by);
create index if not exists idx_interior_designs_status on interior_designs(status);
create index if not exists idx_interior_designs_created_at on interior_designs(created_at desc);

alter table interior_designs enable row level security;
do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'interior_designs' and policyname = 'Allow all'
    ) then
        create policy "Allow all" on interior_designs for all to anon using (true) with check (true);
    end if;
end $$;

-- -----------------------------------------------------------
-- 2. design_cost_rates: reference rates for cost estimates
-- -----------------------------------------------------------
create table if not exists design_cost_rates (
    id                      uuid primary key default gen_random_uuid(),
    room_type               text not null,
    budget_tier             text not null,
    material_rate_per_sqft  numeric not null,
    labor_rate_per_sqft     numeric not null,
    updated_at              timestamptz default now(),
    unique(room_type, budget_tier)
);

alter table design_cost_rates enable row level security;
do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'design_cost_rates' and policyname = 'Allow all'
    ) then
        create policy "Allow all" on design_cost_rates for all to anon using (true) with check (true);
    end if;
end $$;

-- -----------------------------------------------------------
-- 3. marketplace_materials: construction material catalog
-- -----------------------------------------------------------
create table if not exists marketplace_materials (
    id          uuid primary key default gen_random_uuid(),
    category    text not null,
    name        text not null,
    unit        text not null,
    description text,
    is_active   boolean default true,
    created_at  timestamptz default now()
);

create index if not exists idx_marketplace_materials_category on marketplace_materials(category);
create index if not exists idx_marketplace_materials_name on marketplace_materials(name);

alter table marketplace_materials enable row level security;
do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'marketplace_materials' and policyname = 'Allow all'
    ) then
        create policy "Allow all" on marketplace_materials for all to anon using (true) with check (true);
    end if;
end $$;

-- -----------------------------------------------------------
-- 4. marketplace_suppliers: verified suppliers per material
-- -----------------------------------------------------------
create table if not exists marketplace_suppliers (
    id                      uuid primary key default gen_random_uuid(),
    material_id             uuid not null references marketplace_materials(id),
    company_name            text not null,
    brand_name              text not null,
    price_low               numeric not null,
    price_high              numeric not null,
    currency                text default 'INR',
    trust_level             text,
    email                   text,
    phone                   text,
    price_last_verified_at  date,
    source_note             text,
    created_at              timestamptz default now()
);

create index if not exists idx_marketplace_suppliers_material on marketplace_suppliers(material_id);
create index if not exists idx_marketplace_suppliers_company on marketplace_suppliers(company_name);

alter table marketplace_suppliers enable row level security;
do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'marketplace_suppliers' and policyname = 'Allow all'
    ) then
        create policy "Allow all" on marketplace_suppliers for all to anon using (true) with check (true);
    end if;
end $$;
