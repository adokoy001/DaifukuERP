CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"country" text DEFAULT 'JP' NOT NULL,
	"currency" text DEFAULT 'JPY' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text,
	"roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"default_company_id" uuid,
	"active" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "sequences" (
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"key" text NOT NULL,
	"period" text DEFAULT '' NOT NULL,
	"next_value" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "sequences_tenant_id_company_id_key_period_pk" PRIMARY KEY("tenant_id","company_id","key","period")
);

--> statement-breakpoint
ALTER TABLE "sequences" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid,
	"entity" text NOT NULL,
	"record_id" uuid NOT NULL,
	"op" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"on_behalf_of" text,
	"action" text,
	"request_id" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"before" jsonb,
	"after" jsonb
);

--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid,
	"topic" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text
);

--> statement-breakpoint
ALTER TABLE "outbox" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "ext_field_definitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"label" jsonb NOT NULL,
	"owner" text NOT NULL,
	"required" integer DEFAULT 0 NOT NULL,
	"options" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
ALTER TABLE "ext_field_definitions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "partner" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"ext" jsonb,
	"code" text,
	"name" text NOT NULL,
	"name_kana" text,
	"is_customer" boolean DEFAULT false NOT NULL,
	"is_supplier" boolean DEFAULT false NOT NULL,
	"invoice_registration_no" text,
	"tax_status" text DEFAULT 'registered' NOT NULL,
	"closing_day" integer DEFAULT 31 NOT NULL,
	"payment_month_offset" integer DEFAULT 1 NOT NULL,
	"payment_day" integer DEFAULT 31 NOT NULL,
	"postal_code" text,
	"prefecture" text,
	"address1" text,
	"address2" text,
	"phone" text,
	"email" text,
	"bank_name" text,
	"bank_branch" text,
	"bank_account_type" text,
	"bank_account_no" text,
	"bank_account_holder_kana" text,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "partner_tax_status_chk" CHECK (tax_status IN ('registered', 'exempt')),
	CONSTRAINT "partner_bank_account_type_chk" CHECK (bank_account_type IN ('ordinary', 'current', 'savings'))
);

--> statement-breakpoint
ALTER TABLE "partner" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE UNIQUE INDEX "companies_code_uq" ON "companies" USING btree ("tenant_id","code");
--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("tenant_id","email");
--> statement-breakpoint
CREATE INDEX "audit_log_record_idx" ON "audit_log" USING btree ("tenant_id","entity","record_id");
--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("tenant_id","at");
--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "outbox" USING btree ("tenant_id","published_at","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "ext_field_definitions_uq" ON "ext_field_definitions" USING btree ("tenant_id","entity","key");
--> statement-breakpoint
CREATE INDEX "partner_tenant_idx" ON "partner" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "partner_code_uq" ON "partner" USING btree ("tenant_id","company_id","code");
--> statement-breakpoint
CREATE POLICY "companies_tenant_isolation" ON "companies" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "users_tenant_isolation" ON "users" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "sequences_tenant_isolation" ON "sequences" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "audit_log_tenant_isolation" ON "audit_log" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "outbox_tenant_isolation" ON "outbox" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "ext_field_definitions_tenant_isolation" ON "ext_field_definitions" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "partner_tenant_isolation" ON "partner" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
