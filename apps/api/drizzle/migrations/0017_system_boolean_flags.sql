-- One transaction (Drizzle migrator): stop application writers before applying this type change.
-- Fail closed if the setup role cannot inspect every tenant, even with FORCE RLS enabled.
SET LOCAL row_security = off;
--> statement-breakpoint
LOCK TABLE "users", "ext_field_definitions", "relay_credentials" IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "users" WHERE "active" NOT IN (0, 1) OR "active" IS NULL
      OR "tenant_admin" NOT IN (0, 1) OR "tenant_admin" IS NULL
      OR "mfa_enabled" NOT IN (0, 1) OR "mfa_enabled" IS NULL)
    OR EXISTS (SELECT 1 FROM "ext_field_definitions" WHERE "required" NOT IN (0, 1) OR "required" IS NULL)
    OR EXISTS (SELECT 1 FROM "relay_credentials" WHERE "active" NOT IN (0, 1) OR "active" IS NULL) THEN
    RAISE EXCEPTION 'Boolean flag migration requires only 0 or 1; correct the legacy values explicitly before retrying';
  END IF;
END $$;
--> statement-breakpoint
DROP INDEX "relay_credential_active_uq";
--> statement-breakpoint
ALTER TABLE "users"
  ALTER COLUMN "active" DROP DEFAULT,
  ALTER COLUMN "tenant_admin" DROP DEFAULT,
  ALTER COLUMN "mfa_enabled" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "users"
  ALTER COLUMN "active" TYPE boolean USING ("active" = 1),
  ALTER COLUMN "tenant_admin" TYPE boolean USING ("tenant_admin" = 1),
  ALTER COLUMN "mfa_enabled" TYPE boolean USING ("mfa_enabled" = 1);
--> statement-breakpoint
ALTER TABLE "users"
  ALTER COLUMN "active" SET DEFAULT true,
  ALTER COLUMN "tenant_admin" SET DEFAULT false,
  ALTER COLUMN "mfa_enabled" SET DEFAULT false;
--> statement-breakpoint
ALTER TABLE "ext_field_definitions" ALTER COLUMN "required" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "ext_field_definitions" ALTER COLUMN "required" TYPE boolean USING ("required" = 1);
--> statement-breakpoint
ALTER TABLE "ext_field_definitions" ALTER COLUMN "required" SET DEFAULT false;
--> statement-breakpoint
ALTER TABLE "relay_credentials" ALTER COLUMN "active" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "relay_credentials" ALTER COLUMN "active" TYPE boolean USING ("active" = 1);
--> statement-breakpoint
ALTER TABLE "relay_credentials" ALTER COLUMN "active" SET DEFAULT true;
--> statement-breakpoint
CREATE UNIQUE INDEX "relay_credential_active_uq" ON "relay_credentials" USING btree ("tenant_id","company_id","gateway_id") WHERE "relay_credentials"."active" = true;
--> statement-breakpoint
ANALYZE "users", "ext_field_definitions", "relay_credentials";
