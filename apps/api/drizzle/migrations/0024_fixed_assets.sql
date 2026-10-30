CREATE TABLE "depreciation_run" (
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
	"period_id" uuid NOT NULL,
	"fiscal_year_id" uuid NOT NULL,
	"date" date NOT NULL,
	"total_amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"asset_count" integer DEFAULT 0 NOT NULL,
	"rule_set_id" text,
	"journal_entry_id" uuid,
	CONSTRAINT "depreciation_run_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "depreciation_run_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "depreciation_run_docstatus_chk" CHECK (docstatus IN (0, 1, 2))
);

--> statement-breakpoint
ALTER TABLE "depreciation_run" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "depreciation_run_line" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"ext" jsonb,
	"run_id" uuid NOT NULL,
	"seq" integer DEFAULT 1 NOT NULL,
	"asset_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"fiscal_year_id" uuid NOT NULL,
	"date" date NOT NULL,
	"amount" numeric(20, 6) NOT NULL,
	"annual_amount" numeric(20, 6) NOT NULL,
	"expense_account_id" uuid NOT NULL,
	"accumulated_account_id" uuid NOT NULL,
	"basis" jsonb,
	CONSTRAINT "depreciation_run_line_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "depreciation_run_line_tenant_id_uq" UNIQUE("tenant_id","id")
);

--> statement-breakpoint
ALTER TABLE "depreciation_run_line" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "fixed_asset" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"ext" jsonb,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"asset_class" text NOT NULL,
	"acquisition_date" date NOT NULL,
	"in_service_date" date,
	"cost" numeric(20, 6) NOT NULL,
	"method" text NOT NULL,
	"useful_life" integer NOT NULL,
	"asset_account_id" uuid NOT NULL,
	"accumulated_account_id" uuid,
	"expense_account_id" uuid,
	"location" text,
	"municipality" text,
	"property_tax_class" text,
	"opening_date" date,
	"opening_accumulated_depreciation" numeric(20, 6),
	"opening_year_depreciation" numeric(20, 6),
	"opening_revised_base" numeric(20, 6),
	"memo" text,
	"status" text DEFAULT 'active' NOT NULL,
	"depreciation_start" date,
	"disposed_on" date,
	CONSTRAINT "fixed_asset_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "fixed_asset_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "fixed_asset_asset_class_chk" CHECK (asset_class IN ('building', 'building_equipment', 'structure', 'machinery', 'vehicle', 'tools_furniture', 'software')),
	CONSTRAINT "fixed_asset_method_chk" CHECK (method IN ('straight_line', 'declining_200')),
	CONSTRAINT "fixed_asset_property_tax_class_chk" CHECK (property_tax_class IN ('structure', 'machinery', 'vessel', 'aircraft', 'vehicle', 'tools', 'excluded')),
	CONSTRAINT "fixed_asset_status_chk" CHECK (status IN ('active', 'disposed'))
);

--> statement-breakpoint
ALTER TABLE "fixed_asset" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "fixed_asset_disposal" (
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
	"asset_id" uuid NOT NULL,
	"date" date DEFAULT CURRENT_DATE NOT NULL,
	"kind" text DEFAULT 'retirement' NOT NULL,
	"proceeds" numeric(20, 6) DEFAULT '0' NOT NULL,
	"tax_category" text,
	"proceeds_account_id" uuid,
	"partner_id" uuid,
	"memo" text,
	"tax_rate" numeric(20, 6),
	"tax_amount" numeric(20, 6),
	"disposal_year_depreciation" numeric(20, 6),
	"accumulated_depreciation" numeric(20, 6),
	"book_value" numeric(20, 6),
	"gain" numeric(20, 6),
	"loss" numeric(20, 6),
	"journal_entry_id" uuid,
	CONSTRAINT "fixed_asset_disposal_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "fixed_asset_disposal_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "fixed_asset_disposal_kind_chk" CHECK (kind IN ('retirement', 'sale')),
	CONSTRAINT "fixed_asset_disposal_tax_category_chk" CHECK (tax_category IN ('standard', 'reduced', 'exempt', 'non_taxable', 'out_of_scope')),
	CONSTRAINT "fixed_asset_disposal_docstatus_chk" CHECK (docstatus IN (0, 1, 2))
);

--> statement-breakpoint
ALTER TABLE "fixed_asset_disposal" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "depreciation_run" ADD CONSTRAINT "depreciation_run_period_id_fiscal_period_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."fiscal_period"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "depreciation_run" ADD CONSTRAINT "depreciation_run_fiscal_year_id_fiscal_year_id_fk" FOREIGN KEY ("fiscal_year_id") REFERENCES "public"."fiscal_year"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "depreciation_run" ADD CONSTRAINT "depreciation_run_journal_entry_id_journal_entry_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entry"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "depreciation_run" ADD CONSTRAINT "depreciation_run_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "depreciation_run" ADD CONSTRAINT "depreciation_run_period_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","period_id") REFERENCES "public"."fiscal_period"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "depreciation_run" ADD CONSTRAINT "depreciation_run_fiscal_year_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","fiscal_year_id") REFERENCES "public"."fiscal_year"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "depreciation_run" ADD CONSTRAINT "depreciation_run_journal_entry_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","journal_entry_id") REFERENCES "public"."journal_entry"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "depreciation_run_line" ADD CONSTRAINT "depreciation_run_line_run_id_depreciation_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."depreciation_run"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "depreciation_run_line" ADD CONSTRAINT "depreciation_run_line_asset_id_fixed_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."fixed_asset"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "depreciation_run_line" ADD CONSTRAINT "depreciation_run_line_period_id_fiscal_period_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."fiscal_period"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "depreciation_run_line" ADD CONSTRAINT "depreciation_run_line_fiscal_year_id_fiscal_year_id_fk" FOREIGN KEY ("fiscal_year_id") REFERENCES "public"."fiscal_year"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "depreciation_run_line" ADD CONSTRAINT "depreciation_run_line_expense_account_id_account_id_fk" FOREIGN KEY ("expense_account_id") REFERENCES "public"."account"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "depreciation_run_line" ADD CONSTRAINT "depreciation_run_line_accumulated_account_id_account_id_fk" FOREIGN KEY ("accumulated_account_id") REFERENCES "public"."account"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "depreciation_run_line" ADD CONSTRAINT "depreciation_run_line_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "depreciation_run_line" ADD CONSTRAINT "depreciation_run_line_run_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","run_id") REFERENCES "public"."depreciation_run"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "depreciation_run_line" ADD CONSTRAINT "depreciation_run_line_asset_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","asset_id") REFERENCES "public"."fixed_asset"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "depreciation_run_line" ADD CONSTRAINT "depreciation_run_line_period_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","period_id") REFERENCES "public"."fiscal_period"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "depreciation_run_line" ADD CONSTRAINT "depreciation_run_line_fiscal_year_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","fiscal_year_id") REFERENCES "public"."fiscal_year"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "depreciation_run_line" ADD CONSTRAINT "depreciation_run_line_expense_account_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","expense_account_id") REFERENCES "public"."account"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "depreciation_run_line" ADD CONSTRAINT "depreciation_run_line_accumulated_account_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","accumulated_account_id") REFERENCES "public"."account"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fixed_asset" ADD CONSTRAINT "fixed_asset_asset_account_id_account_id_fk" FOREIGN KEY ("asset_account_id") REFERENCES "public"."account"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fixed_asset" ADD CONSTRAINT "fixed_asset_accumulated_account_id_account_id_fk" FOREIGN KEY ("accumulated_account_id") REFERENCES "public"."account"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fixed_asset" ADD CONSTRAINT "fixed_asset_expense_account_id_account_id_fk" FOREIGN KEY ("expense_account_id") REFERENCES "public"."account"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fixed_asset" ADD CONSTRAINT "fixed_asset_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fixed_asset" ADD CONSTRAINT "fixed_asset_asset_account_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","asset_account_id") REFERENCES "public"."account"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fixed_asset" ADD CONSTRAINT "fixed_asset_accumulated_account_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","accumulated_account_id") REFERENCES "public"."account"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fixed_asset" ADD CONSTRAINT "fixed_asset_expense_account_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","expense_account_id") REFERENCES "public"."account"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fixed_asset_disposal" ADD CONSTRAINT "fixed_asset_disposal_asset_id_fixed_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."fixed_asset"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fixed_asset_disposal" ADD CONSTRAINT "fixed_asset_disposal_proceeds_account_id_account_id_fk" FOREIGN KEY ("proceeds_account_id") REFERENCES "public"."account"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fixed_asset_disposal" ADD CONSTRAINT "fixed_asset_disposal_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fixed_asset_disposal" ADD CONSTRAINT "fixed_asset_disposal_journal_entry_id_journal_entry_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entry"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fixed_asset_disposal" ADD CONSTRAINT "fixed_asset_disposal_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fixed_asset_disposal" ADD CONSTRAINT "fixed_asset_disposal_asset_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","asset_id") REFERENCES "public"."fixed_asset"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fixed_asset_disposal" ADD CONSTRAINT "fixed_asset_disposal_proceeds_account_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","proceeds_account_id") REFERENCES "public"."account"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fixed_asset_disposal" ADD CONSTRAINT "fixed_asset_disposal_partner_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","partner_id") REFERENCES "public"."partner"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fixed_asset_disposal" ADD CONSTRAINT "fixed_asset_disposal_journal_entry_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","journal_entry_id") REFERENCES "public"."journal_entry"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "depreciation_run_tenant_idx" ON "depreciation_run" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "depreciation_run_period_id_idx" ON "depreciation_run" USING btree ("tenant_id","company_id","period_id");
--> statement-breakpoint
CREATE INDEX "depreciation_run_fiscal_year_id_idx" ON "depreciation_run" USING btree ("tenant_id","company_id","fiscal_year_id");
--> statement-breakpoint
CREATE INDEX "depreciation_run_date_idx" ON "depreciation_run" USING btree ("tenant_id","company_id","date");
--> statement-breakpoint
CREATE INDEX "depreciation_run_journal_entry_id_idx" ON "depreciation_run" USING btree ("tenant_id","company_id","journal_entry_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "depreciation_run_number_uq" ON "depreciation_run" USING btree ("tenant_id","company_id","number");
--> statement-breakpoint
CREATE INDEX "depreciation_run_line_tenant_idx" ON "depreciation_run_line" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "depreciation_run_line_run_id_idx" ON "depreciation_run_line" USING btree ("tenant_id","company_id","run_id");
--> statement-breakpoint
CREATE INDEX "depreciation_run_line_asset_id_idx" ON "depreciation_run_line" USING btree ("tenant_id","company_id","asset_id");
--> statement-breakpoint
CREATE INDEX "depreciation_run_line_period_id_idx" ON "depreciation_run_line" USING btree ("tenant_id","company_id","period_id");
--> statement-breakpoint
CREATE INDEX "depreciation_run_line_fiscal_year_id_idx" ON "depreciation_run_line" USING btree ("tenant_id","company_id","fiscal_year_id");
--> statement-breakpoint
CREATE INDEX "depreciation_run_line_expense_account_id_idx" ON "depreciation_run_line" USING btree ("tenant_id","company_id","expense_account_id");
--> statement-breakpoint
CREATE INDEX "depreciation_run_line_accumulated_account_id_idx" ON "depreciation_run_line" USING btree ("tenant_id","company_id","accumulated_account_id");
--> statement-breakpoint
CREATE INDEX "depreciation_run_line_asset_id_fiscal_year_id_idx" ON "depreciation_run_line" USING btree ("tenant_id","company_id","asset_id","fiscal_year_id");
--> statement-breakpoint
CREATE INDEX "fixed_asset_tenant_idx" ON "fixed_asset" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "fixed_asset_code_uq" ON "fixed_asset" USING btree ("tenant_id","company_id","code");
--> statement-breakpoint
CREATE INDEX "fixed_asset_acquisition_date_idx" ON "fixed_asset" USING btree ("tenant_id","company_id","acquisition_date");
--> statement-breakpoint
CREATE INDEX "fixed_asset_asset_account_id_idx" ON "fixed_asset" USING btree ("tenant_id","company_id","asset_account_id");
--> statement-breakpoint
CREATE INDEX "fixed_asset_accumulated_account_id_idx" ON "fixed_asset" USING btree ("tenant_id","company_id","accumulated_account_id");
--> statement-breakpoint
CREATE INDEX "fixed_asset_expense_account_id_idx" ON "fixed_asset" USING btree ("tenant_id","company_id","expense_account_id");
--> statement-breakpoint
CREATE INDEX "fixed_asset_municipality_idx" ON "fixed_asset" USING btree ("tenant_id","company_id","municipality");
--> statement-breakpoint
CREATE INDEX "fixed_asset_status_idx" ON "fixed_asset" USING btree ("tenant_id","company_id","status");
--> statement-breakpoint
CREATE INDEX "fixed_asset_status_asset_class_idx" ON "fixed_asset" USING btree ("tenant_id","company_id","status","asset_class");
--> statement-breakpoint
CREATE INDEX "fixed_asset_disposal_tenant_idx" ON "fixed_asset_disposal" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "fixed_asset_disposal_asset_id_idx" ON "fixed_asset_disposal" USING btree ("tenant_id","company_id","asset_id");
--> statement-breakpoint
CREATE INDEX "fixed_asset_disposal_date_idx" ON "fixed_asset_disposal" USING btree ("tenant_id","company_id","date");
--> statement-breakpoint
CREATE INDEX "fixed_asset_disposal_proceeds_account_id_idx" ON "fixed_asset_disposal" USING btree ("tenant_id","company_id","proceeds_account_id");
--> statement-breakpoint
CREATE INDEX "fixed_asset_disposal_partner_id_idx" ON "fixed_asset_disposal" USING btree ("tenant_id","company_id","partner_id");
--> statement-breakpoint
CREATE INDEX "fixed_asset_disposal_journal_entry_id_idx" ON "fixed_asset_disposal" USING btree ("tenant_id","company_id","journal_entry_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "fixed_asset_disposal_number_uq" ON "fixed_asset_disposal" USING btree ("tenant_id","company_id","number");
--> statement-breakpoint
CREATE POLICY "depreciation_run_tenant_isolation" ON "depreciation_run" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "depreciation_run_line_tenant_isolation" ON "depreciation_run_line" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "fixed_asset_tenant_isolation" ON "fixed_asset" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "fixed_asset_disposal_tenant_isolation" ON "fixed_asset_disposal" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
