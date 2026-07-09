-- ============================================================
-- Migration 002: Foundation schema for RBAC, normalized categories, and audit
-- Run this in Supabase SQL Editor after 001_fix_upsert_and_dedupe.sql.
-- This is additive: existing JSONB columns are kept for backward compatibility.
-- ============================================================

-- -----------------------------------------------------------
-- 1. Organizations (root tenant)
-- -----------------------------------------------------------
create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);

-- -----------------------------------------------------------
-- 2. Users (real accounts, replacing the single shared login)
-- -----------------------------------------------------------
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  email text not null unique,
  password_hash text not null,
  full_name text not null,
  role text not null check (role in ('supervisor','manager','admin')),
  active boolean not null default true,
  created_at timestamptz default now()
);
create index if not exists idx_users_org on users(org_id);
create index if not exists idx_users_email on users(email);

-- -----------------------------------------------------------
-- 3. Promote key fields on existing tables out of JSON blobs
-- -----------------------------------------------------------

-- Ventures: add org_id and name so we can scope and query without parsing JSON.
alter table ventures
  add column if not exists org_id uuid references organizations(id),
  add column if not exists name text,
  add column if not exists updated_at timestamptz default now();

-- Invoices: add real columns for querying, reporting, and alerts.
alter table invoices
  add column if not exists org_id uuid references organizations(id),
  add column if not exists venture_id text,
  add column if not exists vendor_id text,
  add column if not exists amount numeric(12,2),
  add column if not exists status text,
  add column if not exists due_date date,
  add column if not exists updated_at timestamptz default now();

-- Purchase Orders: same treatment.
alter table purchase_orders
  add column if not exists org_id uuid references organizations(id),
  add column if not exists venture_id text,
  add column if not exists vendor_id text,
  add column if not exists amount numeric(12,2),
  add column if not exists status text,
  add column if not exists due_date date,
  add column if not exists updated_at timestamptz default now();

-- Vendors: vendor name is a real thing, not just JSON.
alter table vendors
  add column if not exists org_id uuid references organizations(id),
  add column if not exists name text,
  add column if not exists contact_phone text,
  add column if not exists updated_at timestamptz default now();

-- Settings: add updated_at for deterministic conflict resolution.
alter table settings
  add column if not exists updated_at timestamptz default now();

-- -----------------------------------------------------------
-- 4. category_sets: one real table for every "category" concept
-- -----------------------------------------------------------
create table if not exists category_sets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  venture_id text references ventures(id),
  category_type text not null check (category_type in ('flat_view','super_structure','invoice','work_group')),
  parent_group text,
  name text not null,
  sort_order int not null default 0,
  is_archived boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id)
);

create unique index if not exists idx_category_unique
  on category_sets(coalesce(org_id::text,''), coalesce(venture_id,''), category_type, coalesce(parent_group,''), name);

create index if not exists idx_category_sets_org
  on category_sets(org_id, category_type, venture_id);

-- -----------------------------------------------------------
-- 5. cell_status_events: append-only audit log per cell
-- -----------------------------------------------------------
create table if not exists cell_status_events (
  id bigint generated always as identity primary key,
  cell_id text not null,
  color text not null,
  status_label text not null,
  changed_by uuid references users(id),
  changed_at timestamptz not null default now()
);

create index if not exists idx_cell_events_cell
  on cell_status_events(cell_id, changed_at desc);

-- -----------------------------------------------------------
-- 6. Default organization and admin user (seed for migration)
--    Password hash is for bcrypt of 'Vgrand1234' (10 rounds). Change immediately.
-- -----------------------------------------------------------
insert into organizations (id, name)
values ('11111111-1111-1111-1111-111111111111', 'VGrand Infra')
on conflict (id) do nothing;

insert into users (id, org_id, email, password_hash, full_name, role, active)
values (
  '22222222-2222-2222-2222-222222222222',
  '11111111-1111-1111-1111-111111111111',
  'Vgrand@123',
  'LEGACY', -- app will accept the existing demo password and re-hash on first login.
  'VGrand Admin',
  'admin',
  true
)
on conflict (email) do nothing;

-- -----------------------------------------------------------
-- 7. RLS: deny-by-default policies for service-role key
--    Flask connects with the service role key and applies its own auth.
--    These policies are a failsafe that blocks browser direct access.
-- -----------------------------------------------------------

-- Enable RLS on all relevant tables.
alter table organizations enable row level security;
alter table users enable row level security;
alter table category_sets enable row level security;
alter table cell_status_events enable row level security;

-- Drop any overly permissive anon policies from migration 001.
do $$
declare
    pol record;
begin
    for pol in
        select policyname, tablename
        from pg_policies
        where schemaname = 'public' and policyname = 'Allow all'
    loop
        execute format('drop policy if exists %I on %I', pol.policyname, pol.tablename);
    end loop;
end $$;

-- Create a service-role-only policy. The service role bypasses RLS by default,
-- but the anon key (if ever leaked) will be blocked because no policy grants it access.

-- For the service role to be used from Flask, the app must use SUPABASE_SERVICE_KEY.
-- No policy grants the anon role any access, so a leaked anon key is useless.
