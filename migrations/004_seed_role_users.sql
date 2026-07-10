-- -----------------------------------------------------------
-- Migration 004: Seed role-based user accounts (live credentials)
--   supervisor : Vgrand01  / Infra1234
--   manager    : vgrand02  / Infra123
--   admin      : vgrand03  / Infra12345
-- Password hashes are generated via werkzeug.security.generate_password_hash
-- using pbkdf2:sha256 method, compatible with check_password_hash() in app.py.
-- -----------------------------------------------------------

insert into users (org_id, email, password_hash, full_name, role, active)
values
  (
    '11111111-1111-1111-1111-111111111111',
    'Vgrand01',
    'pbkdf2:sha256:1000000$fAvUvaaUnaYTOqDw$e497e88fb51c96ecdd3287910e8e97b776fc1b787f419394eceec5c489737267',
    'VGrand Supervisor',
    'supervisor',
    true
  ),
  (
    '11111111-1111-1111-1111-111111111111',
    'vgrand02',
    'pbkdf2:sha256:1000000$v4R233OOiYqFYwdn$af8b04bc426fefa01f8e3d55fb4e351d03308ac4a10a33f4139bd2dbcc2b6a94',
    'VGrand Manager',
    'manager',
    true
  ),
  (
    '11111111-1111-1111-1111-111111111111',
    'vgrand03',
    'pbkdf2:sha256:1000000$VQCwp5yOcATCSF2b$4f7c1f5a7eb7faba9acab7be6f4880206c6816e2431b026cfe4dc800a3299b5a',
    'VGrand Admin',
    'admin',
    true
  )
on conflict (email) do update set
  password_hash = excluded.password_hash,
  active = excluded.active;

