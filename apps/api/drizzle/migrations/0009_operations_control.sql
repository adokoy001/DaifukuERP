CREATE TABLE "user_company_memberships" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"access_scope" text DEFAULT 'all' NOT NULL,
	"store_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "user_company_memberships_tenant_id_user_id_company_id_pk" PRIMARY KEY("tenant_id","user_id","company_id")
);

--> statement-breakpoint
ALTER TABLE "user_company_memberships" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "restaurant_chain_day_plan" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"ext" jsonb,
	"docstatus" smallint DEFAULT 0 NOT NULL,
	"number" text,
	"amended_from" uuid,
	"store_id" uuid NOT NULL,
	"date" date DEFAULT CURRENT_DATE NOT NULL,
	"expected_open" boolean DEFAULT true NOT NULL,
	"gross_sales_target" numeric(20, 6) DEFAULT '0' NOT NULL,
	"note" text,
	CONSTRAINT "restaurant_chain_day_plan_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "restaurant_chain_day_plan_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "restaurant_chain_day_plan_docstatus_chk" CHECK (docstatus IN (0, 1, 2))
);

--> statement-breakpoint
ALTER TABLE "restaurant_chain_day_plan" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "tenant_admin" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "session_version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "restaurant_chain_closing" ADD COLUMN "day_status" text DEFAULT 'sales' NOT NULL;
--> statement-breakpoint
ALTER TABLE "restaurant_chain_closing" ADD COLUMN "cash_sales_counted" numeric(20, 6);
--> statement-breakpoint
ALTER TABLE "restaurant_chain_closing" ADD COLUMN "review_status" text DEFAULT 'draft' NOT NULL;
--> statement-breakpoint
ALTER TABLE "restaurant_chain_closing" ADD COLUMN "submitted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "restaurant_chain_closing" ADD COLUMN "submitted_by" text;
--> statement-breakpoint
ALTER TABLE "restaurant_chain_closing" ADD COLUMN "reviewed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "restaurant_chain_closing" ADD COLUMN "reviewed_by" text;
--> statement-breakpoint
ALTER TABLE "restaurant_chain_closing" ADD COLUMN "review_note" text;
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_uq" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "user_company_memberships" ADD CONSTRAINT "membership_user_scope_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "user_company_memberships" ADD CONSTRAINT "membership_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "restaurant_chain_day_plan" ADD CONSTRAINT "restaurant_chain_day_plan_store_id_restaurant_chain_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."restaurant_chain_store"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "restaurant_chain_day_plan" ADD CONSTRAINT "restaurant_chain_day_plan_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "restaurant_chain_day_plan" ADD CONSTRAINT "restaurant_chain_day_plan_store_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","store_id") REFERENCES "public"."restaurant_chain_store"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "restaurant_chain_day_plan_tenant_idx" ON "restaurant_chain_day_plan" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "restaurant_chain_day_plan_store_id_idx" ON "restaurant_chain_day_plan" USING btree ("tenant_id","company_id","store_id");
--> statement-breakpoint
CREATE INDEX "restaurant_chain_day_plan_date_idx" ON "restaurant_chain_day_plan" USING btree ("tenant_id","company_id","date");
--> statement-breakpoint
CREATE INDEX "restaurant_chain_day_plan_store_id_date_idx" ON "restaurant_chain_day_plan" USING btree ("tenant_id","company_id","store_id","date");
--> statement-breakpoint
CREATE UNIQUE INDEX "restaurant_chain_day_plan_number_uq" ON "restaurant_chain_day_plan" USING btree ("tenant_id","company_id","number");
--> statement-breakpoint
ALTER TABLE "restaurant_chain_closing" ADD CONSTRAINT "restaurant_chain_closing_day_status_chk" CHECK (day_status IN ('sales', 'no_sales', 'closed'));
--> statement-breakpoint
ALTER TABLE "restaurant_chain_closing" ADD CONSTRAINT "restaurant_chain_closing_review_status_chk" CHECK (review_status IN ('draft', 'submitted', 'approved', 'returned'));
--> statement-breakpoint
CREATE POLICY "user_company_memberships_tenant_isolation" ON "user_company_memberships" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "restaurant_chain_day_plan_tenant_isolation" ON "restaurant_chain_day_plan" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
-- Preserve the previous tenant-wide role contract as explicit memberships.
-- Existing owner connections are FORCE-RLS scoped, so migrate one tenant at a time.
DO $$
DECLARE scope_tenant uuid;
BEGIN
  FOR scope_tenant IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', scope_tenant::text, true);
    IF EXISTS (SELECT 1 FROM users WHERE tenant_id = scope_tenant AND jsonb_typeof(roles) <> 'array') THEN
      RAISE EXCEPTION 'Legacy user roles must be a JSON array; review the original access records before migration';
    END IF;
    UPDATE users SET tenant_admin = 1 WHERE tenant_id = scope_tenant AND roles @> '["admin"]'::jsonb;
    INSERT INTO user_company_memberships (tenant_id, user_id, company_id, roles, access_scope, store_ids, version)
      SELECT u.tenant_id, u.id, c.id, u.roles, 'all', '[]'::jsonb, 1
      FROM users u JOIN companies c ON c.tenant_id = u.tenant_id
      WHERE u.tenant_id = scope_tenant
      ON CONFLICT (tenant_id, user_id, company_id) DO NOTHING;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END $$;
