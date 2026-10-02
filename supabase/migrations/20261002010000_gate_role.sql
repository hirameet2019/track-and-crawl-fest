-- A "gate" role for the walk-in desk accounts (2026-10-02): Walk-in and Scan only,
-- nothing about online orders or buyers. Ranks: scanner < gate < staff < admin.
--
-- The role checks live in the app (src/lib/roles.ts); no database function reads
-- the role, and the read policies use is_staff(), which any active staff passes.
-- So the database only needs to accept the new value.
--
-- Deploy the app before giving anyone this role: code that predates it does not
-- know "gate", and the old rank lookup let an unknown role through.

alter type staff_role add value if not exists 'gate';
