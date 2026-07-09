-- -----------------------------------------------------------
-- Migration 004: Seed role-based user accounts
--   supervisor : Vgrand01  / Infra1234
--   manager    : vgrand02  / infra 123
--   admin      : vgrand03  / infra 12345
-- Password hashes are generated via werkzeug.security.generate_password_hash
-- and are compatible with check_password_hash() in app.py.
-- -----------------------------------------------------------

insert into users (org_id, email, password_hash, full_name, role, active)
values
  (
    '11111111-1111-1111-1111-111111111111',
    'Vgrand01',
    'scrypt:32768:8:1$UgxHTUD9sMCUDaF6$b7d61c783826ebb2cc1799d152352563ae5525d909108b1d5aaf04273e57049b485428ccdbb910972171599db3d6e006151f40aacd3ba5e88e43d0b2a68c6d20',
    'VGrand Supervisor',
    'supervisor',
    true
  ),
  (
    '11111111-1111-1111-1111-111111111111',
    'vgrand02',
    'scrypt:32768:8:1$xHnyYKjN0yjvfazz$8e562e9e24256eafa5cc072d60b8567a159398d084264a6723da98145c797c8d88c608572299c7cc3740f61cc910efb315105c347d4d2d9fef8601d6e4cd9f2d',
    'VGrand Manager',
    'manager',
    true
  ),
  (
    '11111111-1111-1111-1111-111111111111',
    'vgrand03',
    'scrypt:32768:8:1$tra5Y6vs2PQ8tVZw$252663c4dd243e92b76b09272895487d65158842ffe66e105ed621a0d846b5abda747268bc3fdfd4d86db009be9ec4ef118f878e79f2564c8284e69250653585',
    'VGrand Admin',
    'admin',
    true
  )
on conflict (email) do nothing;
