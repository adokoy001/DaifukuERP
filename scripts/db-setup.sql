-- One-time local setup (run as a superuser): roles and databases.
-- owner: migrations, seeds, login lookups, system context. BYPASSRLS by design (ADR-0004).
-- app:   request handling; subject to row-level security.
CREATE ROLE daifuku_owner LOGIN PASSWORD 'owner' CREATEDB BYPASSRLS;
CREATE ROLE daifuku_app LOGIN PASSWORD 'app';
CREATE DATABASE daifuku_dev OWNER daifuku_owner;
CREATE DATABASE daifuku_test OWNER daifuku_owner;
