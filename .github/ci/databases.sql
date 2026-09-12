-- CI ONLY: a fresh, job-local PostgreSQL service. Known passwords are public synthetic fixtures, never deployments.
-- Existing roles/databases cause failure; this file never alters roles, drops databases or resets data.
CREATE ROLE daifuku_owner LOGIN PASSWORD 'owner' CREATEDB BYPASSRLS;
CREATE ROLE daifuku_app LOGIN PASSWORD 'app' NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE DATABASE daifuku_ci_test OWNER daifuku_owner;
CREATE DATABASE daifuku_ci_e2e OWNER daifuku_owner;
CREATE DATABASE daifuku_ci_enterprise_e2e OWNER daifuku_owner;
