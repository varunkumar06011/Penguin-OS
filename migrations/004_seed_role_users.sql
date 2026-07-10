-- -----------------------------------------------------------
-- Migration 004: Seed role-based user accounts
--   supervisor : Vgrand01  / Infra1234
--   manager    : vgrand02  / infra 123
--   admin      : vgrand03  / infra 12345
-- Password hashes are generated via werkzeug.security.generate_password_hash
-- using pbkdf2:sha256 method, compatible with check_password_hash() in app.py.
-- -----------------------------------------------------------

insert into users (org_id, email, password_hash, full_name, role, active)
values
  (
    '11111111-1111-1111-1111-111111111111',
    'Vgrand01',
    'pbkdf2:sha256:1000000$gUVP6e0OtGzfALdP$13248bc6f05843f05bc89cf2db320abb9ad6678ca772fef4c9ee71bae738a71a',
    'VGrand Supervisor',
    'supervisor',
    true
  ),
  (
    '11111111-1111-1111-1111-111111111111',
    'vgrand02',
    'pbkdf2:sha256:1000000$EFBVIAqvG1wPdGUB$5e294cf53abae0321d9f2aa766913dae1f4ab0fa8a03bd1c743813606554415d',
    'VGrand Manager',
    'manager',
    true
  ),
  (
    '11111111-1111-1111-1111-111111111111',
    'vgrand03',
    'pbkdf2:sha256:1000000$cio6ZtO3M7r9ovh7$6bc319a4285d6aaef1ec9276f0739b29609236ce9e1fd91fdad65a59719d03f7',
    'VGrand Admin',
    'admin',
    true
  )
on conflict (email) do update set
  password_hash = excluded.password_hash,
  active = excluded.active;

