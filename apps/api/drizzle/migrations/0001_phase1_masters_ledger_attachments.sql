CREATE TABLE "product" (
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
	"kind" text DEFAULT 'goods' NOT NULL,
	"tax_category" text DEFAULT 'standard' NOT NULL,
	"uom_id" uuid,
	"sale_price" numeric(20, 6),
	"purchase_price" numeric(20, 6),
	"is_sold" boolean DEFAULT true NOT NULL,
	"is_purchased" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"description" text,
	CONSTRAINT "product_kind_chk" CHECK (kind IN ('goods', 'service')),
	CONSTRAINT "product_tax_category_chk" CHECK (tax_category IN ('standard', 'reduced', 'exempt', 'non_taxable', 'out_of_scope'))
);

--> statement-breakpoint
ALTER TABLE "product" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "uom" (
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
	"symbol" text
);

--> statement-breakpoint
ALTER TABLE "uom" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "tax_rate" (
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
	"category" text NOT NULL,
	"rate" numeric(20, 6) NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"label" text NOT NULL,
	CONSTRAINT "tax_rate_category_chk" CHECK (category IN ('standard', 'reduced', 'exempt', 'non_taxable', 'out_of_scope'))
);

--> statement-breakpoint
ALTER TABLE "tax_rate" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "fiscal_period" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"ext" jsonb,
	"fiscal_year_id" uuid NOT NULL,
	"code" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"is_closed" boolean DEFAULT false NOT NULL
);

--> statement-breakpoint
ALTER TABLE "fiscal_period" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "fiscal_year" (
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
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"is_closed" boolean DEFAULT false NOT NULL
);

--> statement-breakpoint
ALTER TABLE "fiscal_year" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "journal_entry" (
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
	"date" date NOT NULL,
	"description" text,
	"source_entity" text,
	"source_id" uuid,
	"reversal_of" uuid,
	"total_debit" numeric(20, 6) DEFAULT '0' NOT NULL,
	"total_credit" numeric(20, 6) DEFAULT '0' NOT NULL,
	CONSTRAINT "journal_entry_docstatus_chk" CHECK (docstatus IN (0, 1, 2))
);

--> statement-breakpoint
ALTER TABLE "journal_entry" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "account" (
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
	"name_kana" text,
	"type" text NOT NULL,
	"subtype" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"tax_category_default" text,
	"partner_required" boolean DEFAULT false NOT NULL,
	CONSTRAINT "account_type_chk" CHECK (type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
	CONSTRAINT "account_tax_category_default_chk" CHECK (tax_category_default IN ('standard', 'reduced', 'exempt', 'non_taxable', 'out_of_scope'))
);

--> statement-breakpoint
ALTER TABLE "account" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "journal_line" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"ext" jsonb,
	"entry_id" uuid NOT NULL,
	"seq" integer DEFAULT 1 NOT NULL,
	"account_id" uuid NOT NULL,
	"debit" numeric(20, 6) DEFAULT '0' NOT NULL,
	"credit" numeric(20, 6) DEFAULT '0' NOT NULL,
	"partner_id" uuid,
	"tax_category" text,
	"tax_rate" numeric(20, 6),
	"memo" text,
	"entry_date" date,
	"posted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "journal_line_tax_category_chk" CHECK (tax_category IN ('standard', 'reduced', 'exempt', 'non_taxable', 'out_of_scope'))
);

--> statement-breakpoint
ALTER TABLE "journal_line" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "attachment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"ext" jsonb,
	"storage_key" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"txn_date" date,
	"amount" numeric(20, 6),
	"partner_id" uuid,
	"linked_entity" text,
	"linked_id" uuid,
	"note" text,
	"superseded_by_id" uuid,
	CONSTRAINT "attachment_kind_chk" CHECK (kind IN ('invoice_received', 'invoice_issued', 'receipt', 'contract', 'bank_statement', 'other'))
);

--> statement-breakpoint
ALTER TABLE "attachment" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_uom_id_uom_id_fk" FOREIGN KEY ("uom_id") REFERENCES "public"."uom"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fiscal_period" ADD CONSTRAINT "fiscal_period_fiscal_year_id_fiscal_year_id_fk" FOREIGN KEY ("fiscal_year_id") REFERENCES "public"."fiscal_year"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_reversal_of_journal_entry_id_fk" FOREIGN KEY ("reversal_of") REFERENCES "public"."journal_entry"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_entry_id_journal_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entry"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_superseded_by_id_attachment_id_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "public"."attachment"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "product_tenant_idx" ON "product" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "product_code_uq" ON "product" USING btree ("tenant_id","company_id","code");
--> statement-breakpoint
CREATE INDEX "product_uom_id_idx" ON "product" USING btree ("tenant_id","company_id","uom_id");
--> statement-breakpoint
CREATE INDEX "uom_tenant_idx" ON "uom" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "uom_code_uq" ON "uom" USING btree ("tenant_id","company_id","code");
--> statement-breakpoint
CREATE INDEX "tax_rate_tenant_idx" ON "tax_rate" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "tax_rate_code_uq" ON "tax_rate" USING btree ("tenant_id","company_id","code");
--> statement-breakpoint
CREATE INDEX "tax_rate_category_valid_from_idx" ON "tax_rate" USING btree ("tenant_id","company_id","category","valid_from");
--> statement-breakpoint
CREATE INDEX "fiscal_period_tenant_idx" ON "fiscal_period" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "fiscal_period_fiscal_year_id_idx" ON "fiscal_period" USING btree ("tenant_id","company_id","fiscal_year_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_period_code_uq" ON "fiscal_period" USING btree ("tenant_id","company_id","code");
--> statement-breakpoint
CREATE INDEX "fiscal_year_tenant_idx" ON "fiscal_year" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_year_code_uq" ON "fiscal_year" USING btree ("tenant_id","company_id","code");
--> statement-breakpoint
CREATE INDEX "journal_entry_tenant_idx" ON "journal_entry" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "journal_entry_date_idx" ON "journal_entry" USING btree ("tenant_id","company_id","date");
--> statement-breakpoint
CREATE INDEX "journal_entry_reversal_of_idx" ON "journal_entry" USING btree ("tenant_id","company_id","reversal_of");
--> statement-breakpoint
CREATE INDEX "journal_entry_source_entity_source_id_idx" ON "journal_entry" USING btree ("tenant_id","company_id","source_entity","source_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entry_number_uq" ON "journal_entry" USING btree ("tenant_id","company_id","number");
--> statement-breakpoint
CREATE INDEX "account_tenant_idx" ON "account" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "account_code_uq" ON "account" USING btree ("tenant_id","company_id","code");
--> statement-breakpoint
CREATE INDEX "account_subtype_idx" ON "account" USING btree ("tenant_id","company_id","subtype");
--> statement-breakpoint
CREATE INDEX "journal_line_tenant_idx" ON "journal_line" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "journal_line_entry_id_idx" ON "journal_line" USING btree ("tenant_id","company_id","entry_id");
--> statement-breakpoint
CREATE INDEX "journal_line_account_id_idx" ON "journal_line" USING btree ("tenant_id","company_id","account_id");
--> statement-breakpoint
CREATE INDEX "journal_line_partner_id_idx" ON "journal_line" USING btree ("tenant_id","company_id","partner_id");
--> statement-breakpoint
CREATE INDEX "journal_line_account_id_posted_entry_date_idx" ON "journal_line" USING btree ("tenant_id","company_id","account_id","posted","entry_date");
--> statement-breakpoint
CREATE INDEX "attachment_tenant_idx" ON "attachment" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "attachment_sha256_uq" ON "attachment" USING btree ("tenant_id","company_id","sha256");
--> statement-breakpoint
CREATE INDEX "attachment_txn_date_idx" ON "attachment" USING btree ("tenant_id","company_id","txn_date");
--> statement-breakpoint
CREATE INDEX "attachment_amount_idx" ON "attachment" USING btree ("tenant_id","company_id","amount");
--> statement-breakpoint
CREATE INDEX "attachment_partner_id_idx" ON "attachment" USING btree ("tenant_id","company_id","partner_id");
--> statement-breakpoint
CREATE INDEX "attachment_superseded_by_id_idx" ON "attachment" USING btree ("tenant_id","company_id","superseded_by_id");
--> statement-breakpoint
CREATE INDEX "attachment_linked_entity_linked_id_idx" ON "attachment" USING btree ("tenant_id","company_id","linked_entity","linked_id");
--> statement-breakpoint
CREATE POLICY "product_tenant_isolation" ON "product" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "uom_tenant_isolation" ON "uom" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "tax_rate_tenant_isolation" ON "tax_rate" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "fiscal_period_tenant_isolation" ON "fiscal_period" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "fiscal_year_tenant_isolation" ON "fiscal_year" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "journal_entry_tenant_isolation" ON "journal_entry" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "account_tenant_isolation" ON "account" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "journal_line_tenant_isolation" ON "journal_line" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "attachment_tenant_isolation" ON "attachment" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
