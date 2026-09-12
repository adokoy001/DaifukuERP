CREATE TABLE "sales_invoice" (
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
	"partner_id" uuid NOT NULL,
	"date" date DEFAULT CURRENT_DATE NOT NULL,
	"due_date" date,
	"price_includes_tax" boolean DEFAULT false NOT NULL,
	"subtotal" numeric(20, 6) DEFAULT '0' NOT NULL,
	"tax_total" numeric(20, 6) DEFAULT '0' NOT NULL,
	"total" numeric(20, 6) DEFAULT '0' NOT NULL,
	"paid_amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"balance" numeric(20, 6) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"tax_summary" jsonb NOT NULL,
	"note" text,
	"journal_entry_id" uuid,
	CONSTRAINT "sales_invoice_status_chk" CHECK (status IN ('draft', 'open', 'paid', 'cancelled')),
	CONSTRAINT "sales_invoice_docstatus_chk" CHECK (docstatus IN (0, 1, 2))
);

--> statement-breakpoint
ALTER TABLE "sales_invoice" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "sales_invoice_line" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"ext" jsonb,
	"invoice_id" uuid NOT NULL,
	"seq" integer DEFAULT 1 NOT NULL,
	"product_id" uuid,
	"description" text NOT NULL,
	"quantity" numeric(20, 6) DEFAULT '1' NOT NULL,
	"unit_price" numeric(20, 6) NOT NULL,
	"tax_category" text NOT NULL,
	"amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	CONSTRAINT "sales_invoice_line_tax_category_chk" CHECK (tax_category IN ('standard', 'reduced', 'exempt', 'non_taxable', 'out_of_scope'))
);

--> statement-breakpoint
ALTER TABLE "sales_invoice_line" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "purchase_invoice" (
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
	"partner_id" uuid NOT NULL,
	"date" date DEFAULT CURRENT_DATE NOT NULL,
	"supplier_invoice_no" text,
	"due_date" date,
	"price_includes_tax" boolean DEFAULT true NOT NULL,
	"subtotal" numeric(20, 6) DEFAULT '0' NOT NULL,
	"tax_total" numeric(20, 6) DEFAULT '0' NOT NULL,
	"deductible_tax" numeric(20, 6) DEFAULT '0' NOT NULL,
	"non_deductible_tax" numeric(20, 6) DEFAULT '0' NOT NULL,
	"total" numeric(20, 6) DEFAULT '0' NOT NULL,
	"paid_amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"balance" numeric(20, 6) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"supplier_tax_status" text DEFAULT 'registered' NOT NULL,
	"credit_ratio" numeric(20, 6) DEFAULT '1' NOT NULL,
	"tax_summary" jsonb,
	"note" text,
	"journal_entry_id" uuid,
	CONSTRAINT "purchase_invoice_status_chk" CHECK (status IN ('draft', 'open', 'paid', 'cancelled')),
	CONSTRAINT "purchase_invoice_supplier_tax_status_chk" CHECK (supplier_tax_status IN ('registered', 'exempt')),
	CONSTRAINT "purchase_invoice_docstatus_chk" CHECK (docstatus IN (0, 1, 2))
);

--> statement-breakpoint
ALTER TABLE "purchase_invoice" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "purchase_invoice_line" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"ext" jsonb,
	"invoice_id" uuid NOT NULL,
	"seq" integer DEFAULT 1 NOT NULL,
	"product_id" uuid,
	"account_id" uuid,
	"description" text NOT NULL,
	"quantity" numeric(20, 6) DEFAULT '1' NOT NULL,
	"unit_price" numeric(20, 6) NOT NULL,
	"tax_category" text NOT NULL,
	"amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	CONSTRAINT "purchase_invoice_line_tax_category_chk" CHECK (tax_category IN ('standard', 'reduced', 'exempt', 'non_taxable', 'out_of_scope'))
);

--> statement-breakpoint
ALTER TABLE "purchase_invoice_line" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sales_invoice" ADD CONSTRAINT "sales_invoice_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_invoice" ADD CONSTRAINT "sales_invoice_journal_entry_id_journal_entry_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entry"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_invoice_line" ADD CONSTRAINT "sales_invoice_line_invoice_id_sales_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."sales_invoice"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_invoice_line" ADD CONSTRAINT "sales_invoice_line_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_invoice" ADD CONSTRAINT "purchase_invoice_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_invoice" ADD CONSTRAINT "purchase_invoice_journal_entry_id_journal_entry_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entry"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_invoice_line" ADD CONSTRAINT "purchase_invoice_line_invoice_id_purchase_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."purchase_invoice"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_invoice_line" ADD CONSTRAINT "purchase_invoice_line_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_invoice_line" ADD CONSTRAINT "purchase_invoice_line_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "sales_invoice_tenant_idx" ON "sales_invoice" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "sales_invoice_partner_id_idx" ON "sales_invoice" USING btree ("tenant_id","company_id","partner_id");
--> statement-breakpoint
CREATE INDEX "sales_invoice_date_idx" ON "sales_invoice" USING btree ("tenant_id","company_id","date");
--> statement-breakpoint
CREATE INDEX "sales_invoice_due_date_idx" ON "sales_invoice" USING btree ("tenant_id","company_id","due_date");
--> statement-breakpoint
CREATE INDEX "sales_invoice_journal_entry_id_idx" ON "sales_invoice" USING btree ("tenant_id","company_id","journal_entry_id");
--> statement-breakpoint
CREATE INDEX "sales_invoice_status_due_date_idx" ON "sales_invoice" USING btree ("tenant_id","company_id","status","due_date");
--> statement-breakpoint
CREATE UNIQUE INDEX "sales_invoice_number_uq" ON "sales_invoice" USING btree ("tenant_id","company_id","number");
--> statement-breakpoint
CREATE INDEX "sales_invoice_line_tenant_idx" ON "sales_invoice_line" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "sales_invoice_line_invoice_id_idx" ON "sales_invoice_line" USING btree ("tenant_id","company_id","invoice_id");
--> statement-breakpoint
CREATE INDEX "sales_invoice_line_product_id_idx" ON "sales_invoice_line" USING btree ("tenant_id","company_id","product_id");
--> statement-breakpoint
CREATE INDEX "purchase_invoice_tenant_idx" ON "purchase_invoice" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "purchase_invoice_partner_id_idx" ON "purchase_invoice" USING btree ("tenant_id","company_id","partner_id");
--> statement-breakpoint
CREATE INDEX "purchase_invoice_date_idx" ON "purchase_invoice" USING btree ("tenant_id","company_id","date");
--> statement-breakpoint
CREATE INDEX "purchase_invoice_due_date_idx" ON "purchase_invoice" USING btree ("tenant_id","company_id","due_date");
--> statement-breakpoint
CREATE INDEX "purchase_invoice_status_idx" ON "purchase_invoice" USING btree ("tenant_id","company_id","status");
--> statement-breakpoint
CREATE INDEX "purchase_invoice_journal_entry_id_idx" ON "purchase_invoice" USING btree ("tenant_id","company_id","journal_entry_id");
--> statement-breakpoint
CREATE INDEX "purchase_invoice_status_due_date_idx" ON "purchase_invoice" USING btree ("tenant_id","company_id","status","due_date");
--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_invoice_number_uq" ON "purchase_invoice" USING btree ("tenant_id","company_id","number");
--> statement-breakpoint
CREATE INDEX "purchase_invoice_line_tenant_idx" ON "purchase_invoice_line" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "purchase_invoice_line_invoice_id_idx" ON "purchase_invoice_line" USING btree ("tenant_id","company_id","invoice_id");
--> statement-breakpoint
CREATE INDEX "purchase_invoice_line_product_id_idx" ON "purchase_invoice_line" USING btree ("tenant_id","company_id","product_id");
--> statement-breakpoint
CREATE INDEX "purchase_invoice_line_account_id_idx" ON "purchase_invoice_line" USING btree ("tenant_id","company_id","account_id");
--> statement-breakpoint
CREATE INDEX "purchase_invoice_line_invoice_id_seq_idx" ON "purchase_invoice_line" USING btree ("tenant_id","company_id","invoice_id","seq");
--> statement-breakpoint
CREATE POLICY "sales_invoice_tenant_isolation" ON "sales_invoice" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "sales_invoice_line_tenant_isolation" ON "sales_invoice_line" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "purchase_invoice_tenant_isolation" ON "purchase_invoice" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "purchase_invoice_line_tenant_isolation" ON "purchase_invoice_line" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
