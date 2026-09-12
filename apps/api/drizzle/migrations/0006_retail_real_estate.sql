CREATE TABLE "retail_month_close" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"ext" jsonb,
	"period" text NOT NULL,
	"as_of" date NOT NULL,
	"valuation_total" numeric(20, 6) NOT NULL,
	"opening_amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"journal_entry_id" uuid
);

--> statement-breakpoint
ALTER TABLE "retail_month_close" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "retail_closing" (
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
	"date" date DEFAULT CURRENT_DATE NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"cash_amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"card_amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"subtotal" numeric(20, 6) DEFAULT '0' NOT NULL,
	"tax_total" numeric(20, 6) DEFAULT '0' NOT NULL,
	"total" numeric(20, 6) DEFAULT '0' NOT NULL,
	"tax_summary" jsonb,
	"sales_invoice_id" uuid,
	"payment_id" uuid,
	"note" text,
	CONSTRAINT "retail_closing_docstatus_chk" CHECK (docstatus IN (0, 1, 2))
);

--> statement-breakpoint
ALTER TABLE "retail_closing" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "retail_closing_line" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"ext" jsonb,
	"closing_id" uuid NOT NULL,
	"seq" integer DEFAULT 1 NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" numeric(20, 6) NOT NULL,
	"unit_price" numeric(20, 6) NOT NULL,
	"tax_category" text NOT NULL,
	"amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	CONSTRAINT "retail_closing_line_tax_category_chk" CHECK (tax_category IN ('standard', 'reduced', 'exempt', 'non_taxable', 'out_of_scope'))
);

--> statement-breakpoint
ALTER TABLE "retail_closing_line" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "real_estate_unit" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"ext" jsonb,
	"property_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"usage" text NOT NULL,
	"floor_area" numeric(20, 6),
	"monthly_rent" numeric(20, 6) NOT NULL,
	"status" text DEFAULT 'vacant' NOT NULL,
	"note" text,
	CONSTRAINT "real_estate_unit_usage_chk" CHECK (usage IN ('residential', 'office', 'store', 'parking')),
	CONSTRAINT "real_estate_unit_status_chk" CHECK (status IN ('vacant', 'occupied'))
);

--> statement-breakpoint
ALTER TABLE "real_estate_unit" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "real_estate_property" (
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
	"address" text,
	"note" text
);

--> statement-breakpoint
ALTER TABLE "real_estate_property" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "real_estate_deposit" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"ext" jsonb,
	"contract_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"unit_id" uuid,
	"amount" numeric(20, 6) NOT NULL,
	"received_date" date,
	"returned_date" date,
	"returned_amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"deduction_amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"journal_entry_id" uuid,
	"return_journal_entry_id" uuid
);

--> statement-breakpoint
ALTER TABLE "real_estate_deposit" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "retail_month_close" ADD CONSTRAINT "retail_month_close_journal_entry_id_journal_entry_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entry"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "retail_closing" ADD CONSTRAINT "retail_closing_warehouse_id_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "retail_closing" ADD CONSTRAINT "retail_closing_sales_invoice_id_sales_invoice_id_fk" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoice"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "retail_closing" ADD CONSTRAINT "retail_closing_payment_id_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "retail_closing_line" ADD CONSTRAINT "retail_closing_line_closing_id_retail_closing_id_fk" FOREIGN KEY ("closing_id") REFERENCES "public"."retail_closing"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "retail_closing_line" ADD CONSTRAINT "retail_closing_line_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "real_estate_unit" ADD CONSTRAINT "real_estate_unit_property_id_real_estate_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."real_estate_property"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "real_estate_deposit" ADD CONSTRAINT "real_estate_deposit_contract_id_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "real_estate_deposit" ADD CONSTRAINT "real_estate_deposit_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "real_estate_deposit" ADD CONSTRAINT "real_estate_deposit_unit_id_real_estate_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."real_estate_unit"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "real_estate_deposit" ADD CONSTRAINT "real_estate_deposit_journal_entry_id_journal_entry_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entry"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "real_estate_deposit" ADD CONSTRAINT "real_estate_deposit_return_journal_entry_id_journal_entry_id_fk" FOREIGN KEY ("return_journal_entry_id") REFERENCES "public"."journal_entry"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "retail_month_close_tenant_idx" ON "retail_month_close" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "retail_month_close_period_uq" ON "retail_month_close" USING btree ("tenant_id","company_id","period");
--> statement-breakpoint
CREATE INDEX "retail_month_close_journal_entry_id_idx" ON "retail_month_close" USING btree ("tenant_id","company_id","journal_entry_id");
--> statement-breakpoint
CREATE INDEX "retail_closing_tenant_idx" ON "retail_closing" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "retail_closing_date_idx" ON "retail_closing" USING btree ("tenant_id","company_id","date");
--> statement-breakpoint
CREATE INDEX "retail_closing_warehouse_id_idx" ON "retail_closing" USING btree ("tenant_id","company_id","warehouse_id");
--> statement-breakpoint
CREATE INDEX "retail_closing_sales_invoice_id_idx" ON "retail_closing" USING btree ("tenant_id","company_id","sales_invoice_id");
--> statement-breakpoint
CREATE INDEX "retail_closing_payment_id_idx" ON "retail_closing" USING btree ("tenant_id","company_id","payment_id");
--> statement-breakpoint
CREATE INDEX "retail_closing_date_warehouse_id_idx" ON "retail_closing" USING btree ("tenant_id","company_id","date","warehouse_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "retail_closing_number_uq" ON "retail_closing" USING btree ("tenant_id","company_id","number");
--> statement-breakpoint
CREATE INDEX "retail_closing_line_tenant_idx" ON "retail_closing_line" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "retail_closing_line_closing_id_idx" ON "retail_closing_line" USING btree ("tenant_id","company_id","closing_id");
--> statement-breakpoint
CREATE INDEX "retail_closing_line_product_id_idx" ON "retail_closing_line" USING btree ("tenant_id","company_id","product_id");
--> statement-breakpoint
CREATE INDEX "retail_closing_line_closing_id_seq_idx" ON "retail_closing_line" USING btree ("tenant_id","company_id","closing_id","seq");
--> statement-breakpoint
CREATE INDEX "real_estate_unit_tenant_idx" ON "real_estate_unit" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "real_estate_unit_property_id_idx" ON "real_estate_unit" USING btree ("tenant_id","company_id","property_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "real_estate_unit_property_id_code_uq" ON "real_estate_unit" USING btree ("tenant_id","company_id","property_id","code");
--> statement-breakpoint
CREATE INDEX "real_estate_property_tenant_idx" ON "real_estate_property" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "real_estate_property_code_uq" ON "real_estate_property" USING btree ("tenant_id","company_id","code");
--> statement-breakpoint
CREATE INDEX "real_estate_deposit_tenant_idx" ON "real_estate_deposit" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "real_estate_deposit_contract_id_idx" ON "real_estate_deposit" USING btree ("tenant_id","company_id","contract_id");
--> statement-breakpoint
CREATE INDEX "real_estate_deposit_partner_id_idx" ON "real_estate_deposit" USING btree ("tenant_id","company_id","partner_id");
--> statement-breakpoint
CREATE INDEX "real_estate_deposit_unit_id_idx" ON "real_estate_deposit" USING btree ("tenant_id","company_id","unit_id");
--> statement-breakpoint
CREATE INDEX "real_estate_deposit_journal_entry_id_idx" ON "real_estate_deposit" USING btree ("tenant_id","company_id","journal_entry_id");
--> statement-breakpoint
CREATE INDEX "real_estate_deposit_return_journal_entry_id_idx" ON "real_estate_deposit" USING btree ("tenant_id","company_id","return_journal_entry_id");
--> statement-breakpoint
CREATE POLICY "retail_month_close_tenant_isolation" ON "retail_month_close" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "retail_closing_tenant_isolation" ON "retail_closing" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "retail_closing_line_tenant_isolation" ON "retail_closing_line" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "real_estate_unit_tenant_isolation" ON "real_estate_unit" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "real_estate_property_tenant_isolation" ON "real_estate_property" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "real_estate_deposit_tenant_isolation" ON "real_estate_deposit" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
