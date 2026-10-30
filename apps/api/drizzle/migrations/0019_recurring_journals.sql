CREATE TABLE "recurring_journal" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"ext" jsonb,
	"name" text NOT NULL,
	"description" text,
	"kind" text DEFAULT 'fixed' NOT NULL,
	"frequency" text DEFAULT 'monthly' NOT NULL,
	"day_of_month" integer DEFAULT 31 NOT NULL,
	"start_date" date DEFAULT CURRENT_DATE NOT NULL,
	"end_date" date,
	"allocation_periods" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"next_run_date" date,
	"last_occurrence_date" date,
	CONSTRAINT "recurring_journal_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "recurring_journal_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "recurring_journal_kind_chk" CHECK (kind IN ('fixed', 'allocation')),
	CONSTRAINT "recurring_journal_frequency_chk" CHECK (frequency IN ('monthly', 'quarterly', 'yearly'))
);

--> statement-breakpoint
ALTER TABLE "recurring_journal" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "recurring_journal_line" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"ext" jsonb,
	"template_id" uuid NOT NULL,
	"seq" integer DEFAULT 1 NOT NULL,
	"account_id" uuid NOT NULL,
	"debit" numeric(20, 6) DEFAULT '0' NOT NULL,
	"credit" numeric(20, 6) DEFAULT '0' NOT NULL,
	"partner_id" uuid,
	"tax_category" text,
	"tax_rate" numeric(20, 6),
	"memo" text,
	CONSTRAINT "recurring_journal_line_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "recurring_journal_line_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "recurring_journal_line_tax_category_chk" CHECK (tax_category IN ('standard', 'reduced', 'exempt', 'non_taxable', 'out_of_scope'))
);

--> statement-breakpoint
ALTER TABLE "recurring_journal_line" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "recurring_journal_run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"ext" jsonb,
	"template_id" uuid NOT NULL,
	"occurrence_date" date NOT NULL,
	"occurrence_no" integer,
	"entry_id" uuid,
	CONSTRAINT "recurring_journal_run_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "recurring_journal_run_tenant_id_uq" UNIQUE("tenant_id","id")
);

--> statement-breakpoint
ALTER TABLE "recurring_journal_run" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "recurring_journal" ADD CONSTRAINT "recurring_journal_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "recurring_journal_line" ADD CONSTRAINT "recurring_journal_line_template_id_recurring_journal_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."recurring_journal"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "recurring_journal_line" ADD CONSTRAINT "recurring_journal_line_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "recurring_journal_line" ADD CONSTRAINT "recurring_journal_line_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "recurring_journal_line" ADD CONSTRAINT "recurring_journal_line_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "recurring_journal_line" ADD CONSTRAINT "recurring_journal_line_template_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","template_id") REFERENCES "public"."recurring_journal"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "recurring_journal_line" ADD CONSTRAINT "recurring_journal_line_account_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","account_id") REFERENCES "public"."account"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "recurring_journal_line" ADD CONSTRAINT "recurring_journal_line_partner_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","partner_id") REFERENCES "public"."partner"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "recurring_journal_run" ADD CONSTRAINT "recurring_journal_run_template_id_recurring_journal_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."recurring_journal"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "recurring_journal_run" ADD CONSTRAINT "recurring_journal_run_entry_id_journal_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entry"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "recurring_journal_run" ADD CONSTRAINT "recurring_journal_run_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "recurring_journal_run" ADD CONSTRAINT "recurring_journal_run_template_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","template_id") REFERENCES "public"."recurring_journal"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "recurring_journal_run" ADD CONSTRAINT "recurring_journal_run_entry_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","entry_id") REFERENCES "public"."journal_entry"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "recurring_journal_tenant_idx" ON "recurring_journal" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "recurring_journal_is_active_next_run_date_idx" ON "recurring_journal" USING btree ("tenant_id","company_id","is_active","next_run_date");
--> statement-breakpoint
CREATE INDEX "recurring_journal_line_tenant_idx" ON "recurring_journal_line" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "recurring_journal_line_template_id_idx" ON "recurring_journal_line" USING btree ("tenant_id","company_id","template_id");
--> statement-breakpoint
CREATE INDEX "recurring_journal_line_account_id_idx" ON "recurring_journal_line" USING btree ("tenant_id","company_id","account_id");
--> statement-breakpoint
CREATE INDEX "recurring_journal_line_partner_id_idx" ON "recurring_journal_line" USING btree ("tenant_id","company_id","partner_id");
--> statement-breakpoint
CREATE INDEX "recurring_journal_run_tenant_idx" ON "recurring_journal_run" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "recurring_journal_run_template_id_idx" ON "recurring_journal_run" USING btree ("tenant_id","company_id","template_id");
--> statement-breakpoint
CREATE INDEX "recurring_journal_run_entry_id_idx" ON "recurring_journal_run" USING btree ("tenant_id","company_id","entry_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_journal_run_template_id_occurrence_date_uq" ON "recurring_journal_run" USING btree ("tenant_id","company_id","template_id","occurrence_date");
--> statement-breakpoint
CREATE POLICY "recurring_journal_tenant_isolation" ON "recurring_journal" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "recurring_journal_line_tenant_isolation" ON "recurring_journal_line" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "recurring_journal_run_tenant_isolation" ON "recurring_journal_run" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
