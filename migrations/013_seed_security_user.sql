-- ------------------------------------------------------------
-- Migration 013: Seed default security guard account
-- This ensures the security login works on any device that
-- connects to the same Supabase database.
--   Email:    security@vgrand.local
--   Password:  Security123
-- ------------------------------------------------------------

INSERT INTO security_users (id, name, email, password_hash, role, active)
VALUES (
    '33333333-3333-3333-3333-333333333333',
    'Gate Security',
    'security@vgrand.local',
    'pbkdf2:sha256:1000000$SgcmDZdUL5KBLwlk$955b212c8a1d4e376265a8f04d367aeada233760b7e34d02b9f5fe3693e303a5',
    'security',
    true
)
ON CONFLICT (email) DO UPDATE SET
    password_hash = EXCLUDED.password_hash,
    active = EXCLUDED.active;
