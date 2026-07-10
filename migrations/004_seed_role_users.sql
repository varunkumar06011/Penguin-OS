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
    'pbkdf2:sha256:1000000$2vLLC532D9Dp7Zz9$94496795730daed9417aaca66bcff75350cc6267c8419e8f74c1f5fd979c67bb',
    'VGrand Supervisor',
    'supervisor',
    true
  ),
  (
    '11111111-1111-1111-1111-111111111111',
    'vgrand02',
    'pbkdf2:sha256:1000000$qlJIYAt8qaSIaUuF$f28d130b3d818d4657b017ffa4861d48305bb779cc8857325308de5e41076028',
    'VGrand Manager',
    'manager',
    true
  ),
  (
    '11111111-1111-1111-1111-111111111111',
    'vgrand03',
    'pbkdf2:sha256:1000000$71ch0Yu9noKuDBQc$245b248cae798640b42d9b37533fbb720eb757bdc8bbbe2fb8438704a7df2245',
    'VGrand Admin',
    'admin',
    true
  )
on conflict (email) do update set
  password_hash = excluded.password_hash,
  active = excluded.active;

