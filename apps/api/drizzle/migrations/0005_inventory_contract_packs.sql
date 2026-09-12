CREATE TABLE "stock_count" (
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
	"warehouse_id" uuid NOT NULL,
	"date" date DEFAULT CURRENT_DATE NOT NULL,
	"note" text,
	"adjustment_entry_id" uuid,
	CONSTRAINT "stock_count_docstatus_chk" CHECK (docstatus IN (0, 1, 2))
);

--> statement-breakpoint
ALTER TABLE "stock_count" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "stock_count_line" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"ext" jsonb,
	"count_id" uuid NOT NULL,
	"seq" integer DEFAULT 1 NOT NULL,
	"product_id" uuid NOT NULL,
	"counted_qty" numeric(20, 6) NOT NULL,
	"system_qty" numeric(20, 6) DEFAULT '0' NOT NULL,
	"variance_qty" numeric(20, 6) DEFAULT '0' NOT NULL
);

--> statement-breakpoint
ALTER TABLE "stock_count_line" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "stock_entry_line" (
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
	"product_id" uuid NOT NULL,
	"quantity" numeric(20, 6) NOT NULL,
	"sign" text,
	"unit_cost" numeric(20, 6),
	"amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	CONSTRAINT "stock_entry_line_sign_chk" CHECK (sign IN ('in', 'out'))
);

--> statement-breakpoint
ALTER TABLE "stock_entry_line" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "stock_balance" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"ext" jsonb,
	"product_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"qty" numeric(20, 6) DEFAULT '0' NOT NULL,
	"avg_cost" numeric(20, 6) DEFAULT '0' NOT NULL,
	"value" numeric(20, 6) DEFAULT '0' NOT NULL,
	"last_seq" integer DEFAULT 0 NOT NULL
);

--> statement-breakpoint
ALTER TABLE "stock_balance" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "stock_ledger" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"ext" jsonb,
	"date" date NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty_delta" numeric(20, 6) NOT NULL,
	"unit_cost" numeric(20, 6) NOT NULL,
	"cost_delta" numeric(20, 6) NOT NULL,
	"balance_qty" numeric(20, 6) NOT NULL,
	"balance_cost" numeric(20, 6) NOT NULL,
	"source_entity" text NOT NULL,
	"source_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"reversal" boolean DEFAULT false NOT NULL
);

--> statement-breakpoint
ALTER TABLE "stock_ledger" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "warehouse" (
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
	"is_default" boolean DEFAULT false NOT NULL
);

--> statement-breakpoint
ALTER TABLE "warehouse" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "stock_entry" (
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
	"type" text NOT NULL,
	"date" date DEFAULT CURRENT_DATE NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"to_warehouse_id" uuid,
	"partner_id" uuid,
	"note" text,
	"source_entity" text,
	"source_id" uuid,
	CONSTRAINT "stock_entry_type_chk" CHECK (type IN ('receipt', 'issue', 'transfer', 'adjustment')),
	CONSTRAINT "stock_entry_docstatus_chk" CHECK (docstatus IN (0, 1, 2))
);

--> statement-breakpoint
ALTER TABLE "stock_entry" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "contract" (
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
	"title" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"billing_day" integer DEFAULT 1 NOT NULL,
	"billing_timing" text DEFAULT 'advance' NOT NULL,
	"interval_months" integer DEFAULT 1 NOT NULL,
	"proration_rule" text DEFAULT 'daily' NOT NULL,
	"rounding_mode" text DEFAULT 'down' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"next_period" text,
	"note" text,
	CONSTRAINT "contract_billing_timing_chk" CHECK (billing_timing IN ('advance', 'arrears')),
	CONSTRAINT "contract_proration_rule_chk" CHECK (proration_rule IN ('daily', 'none')),
	CONSTRAINT "contract_rounding_mode_chk" CHECK (rounding_mode IN ('half_up', 'down', 'up')),
	CONSTRAINT "contract_status_chk" CHECK (status IN ('draft', 'active', 'ended', 'cancelled')),
	CONSTRAINT "contract_docstatus_chk" CHECK (docstatus IN (0, 1, 2))
);

--> statement-breakpoint
ALTER TABLE "contract" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "contract_line" (
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
	"seq" integer DEFAULT 1 NOT NULL,
	"product_id" uuid,
	"description" text NOT NULL,
	"quantity" numeric(20, 6) DEFAULT '1' NOT NULL,
	"unit_price" numeric(20, 6) NOT NULL,
	"tax_category" text NOT NULL,
	"amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	CONSTRAINT "contract_line_tax_category_chk" CHECK (tax_category IN ('standard', 'reduced', 'exempt', 'non_taxable', 'out_of_scope'))
);

--> statement-breakpoint
ALTER TABLE "contract_line" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "contract_billing" (
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
	"period" text NOT NULL,
	"invoice_id" uuid NOT NULL
);

--> statement-breakpoint
ALTER TABLE "contract_billing" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "example_tag" (
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
	"name" text NOT NULL
);

--> statement-breakpoint
ALTER TABLE "example_tag" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "stock_count" ADD CONSTRAINT "stock_count_warehouse_id_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_count" ADD CONSTRAINT "stock_count_adjustment_entry_id_stock_entry_id_fk" FOREIGN KEY ("adjustment_entry_id") REFERENCES "public"."stock_entry"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_count_line" ADD CONSTRAINT "stock_count_line_count_id_stock_count_id_fk" FOREIGN KEY ("count_id") REFERENCES "public"."stock_count"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_count_line" ADD CONSTRAINT "stock_count_line_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_entry_line" ADD CONSTRAINT "stock_entry_line_entry_id_stock_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."stock_entry"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_entry_line" ADD CONSTRAINT "stock_entry_line_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_balance" ADD CONSTRAINT "stock_balance_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_balance" ADD CONSTRAINT "stock_balance_warehouse_id_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_warehouse_id_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_entry" ADD CONSTRAINT "stock_entry_warehouse_id_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_entry" ADD CONSTRAINT "stock_entry_to_warehouse_id_warehouse_id_fk" FOREIGN KEY ("to_warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_entry" ADD CONSTRAINT "stock_entry_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "contract_line" ADD CONSTRAINT "contract_line_contract_id_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "contract_line" ADD CONSTRAINT "contract_line_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "contract_billing" ADD CONSTRAINT "contract_billing_contract_id_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "contract_billing" ADD CONSTRAINT "contract_billing_invoice_id_sales_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."sales_invoice"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "stock_count_tenant_idx" ON "stock_count" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "stock_count_warehouse_id_idx" ON "stock_count" USING btree ("tenant_id","company_id","warehouse_id");
--> statement-breakpoint
CREATE INDEX "stock_count_date_idx" ON "stock_count" USING btree ("tenant_id","company_id","date");
--> statement-breakpoint
CREATE INDEX "stock_count_adjustment_entry_id_idx" ON "stock_count" USING btree ("tenant_id","company_id","adjustment_entry_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "stock_count_number_uq" ON "stock_count" USING btree ("tenant_id","company_id","number");
--> statement-breakpoint
CREATE INDEX "stock_count_line_tenant_idx" ON "stock_count_line" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "stock_count_line_count_id_idx" ON "stock_count_line" USING btree ("tenant_id","company_id","count_id");
--> statement-breakpoint
CREATE INDEX "stock_count_line_product_id_idx" ON "stock_count_line" USING btree ("tenant_id","company_id","product_id");
--> statement-breakpoint
CREATE INDEX "stock_count_line_count_id_seq_idx" ON "stock_count_line" USING btree ("tenant_id","company_id","count_id","seq");
--> statement-breakpoint
CREATE INDEX "stock_entry_line_tenant_idx" ON "stock_entry_line" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "stock_entry_line_entry_id_idx" ON "stock_entry_line" USING btree ("tenant_id","company_id","entry_id");
--> statement-breakpoint
CREATE INDEX "stock_entry_line_product_id_idx" ON "stock_entry_line" USING btree ("tenant_id","company_id","product_id");
--> statement-breakpoint
CREATE INDEX "stock_entry_line_entry_id_seq_idx" ON "stock_entry_line" USING btree ("tenant_id","company_id","entry_id","seq");
--> statement-breakpoint
CREATE INDEX "stock_balance_tenant_idx" ON "stock_balance" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "stock_balance_product_id_idx" ON "stock_balance" USING btree ("tenant_id","company_id","product_id");
--> statement-breakpoint
CREATE INDEX "stock_balance_warehouse_id_idx" ON "stock_balance" USING btree ("tenant_id","company_id","warehouse_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "stock_balance_product_id_warehouse_id_uq" ON "stock_balance" USING btree ("tenant_id","company_id","product_id","warehouse_id");
--> statement-breakpoint
CREATE INDEX "stock_ledger_tenant_idx" ON "stock_ledger" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "stock_ledger_date_idx" ON "stock_ledger" USING btree ("tenant_id","company_id","date");
--> statement-breakpoint
CREATE INDEX "stock_ledger_warehouse_id_idx" ON "stock_ledger" USING btree ("tenant_id","company_id","warehouse_id");
--> statement-breakpoint
CREATE INDEX "stock_ledger_product_id_idx" ON "stock_ledger" USING btree ("tenant_id","company_id","product_id");
--> statement-breakpoint
CREATE INDEX "stock_ledger_source_id_idx" ON "stock_ledger" USING btree ("tenant_id","company_id","source_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "stock_ledger_product_id_warehouse_id_seq_uq" ON "stock_ledger" USING btree ("tenant_id","company_id","product_id","warehouse_id","seq");
--> statement-breakpoint
CREATE INDEX "stock_ledger_product_id_warehouse_id_date_idx" ON "stock_ledger" USING btree ("tenant_id","company_id","product_id","warehouse_id","date");
--> statement-breakpoint
CREATE INDEX "warehouse_tenant_idx" ON "warehouse" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "warehouse_code_uq" ON "warehouse" USING btree ("tenant_id","company_id","code");
--> statement-breakpoint
CREATE INDEX "stock_entry_tenant_idx" ON "stock_entry" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "stock_entry_type_idx" ON "stock_entry" USING btree ("tenant_id","company_id","type");
--> statement-breakpoint
CREATE INDEX "stock_entry_date_idx" ON "stock_entry" USING btree ("tenant_id","company_id","date");
--> statement-breakpoint
CREATE INDEX "stock_entry_warehouse_id_idx" ON "stock_entry" USING btree ("tenant_id","company_id","warehouse_id");
--> statement-breakpoint
CREATE INDEX "stock_entry_to_warehouse_id_idx" ON "stock_entry" USING btree ("tenant_id","company_id","to_warehouse_id");
--> statement-breakpoint
CREATE INDEX "stock_entry_partner_id_idx" ON "stock_entry" USING btree ("tenant_id","company_id","partner_id");
--> statement-breakpoint
CREATE INDEX "stock_entry_source_id_idx" ON "stock_entry" USING btree ("tenant_id","company_id","source_id");
--> statement-breakpoint
CREATE INDEX "stock_entry_source_entity_source_id_idx" ON "stock_entry" USING btree ("tenant_id","company_id","source_entity","source_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "stock_entry_number_uq" ON "stock_entry" USING btree ("tenant_id","company_id","number");
--> statement-breakpoint
CREATE INDEX "contract_tenant_idx" ON "contract" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "contract_partner_id_idx" ON "contract" USING btree ("tenant_id","company_id","partner_id");
--> statement-breakpoint
CREATE INDEX "contract_status_partner_id_idx" ON "contract" USING btree ("tenant_id","company_id","status","partner_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "contract_number_uq" ON "contract" USING btree ("tenant_id","company_id","number");
--> statement-breakpoint
CREATE INDEX "contract_line_tenant_idx" ON "contract_line" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "contract_line_contract_id_idx" ON "contract_line" USING btree ("tenant_id","company_id","contract_id");
--> statement-breakpoint
CREATE INDEX "contract_line_product_id_idx" ON "contract_line" USING btree ("tenant_id","company_id","product_id");
--> statement-breakpoint
CREATE INDEX "contract_line_contract_id_seq_idx" ON "contract_line" USING btree ("tenant_id","company_id","contract_id","seq");
--> statement-breakpoint
CREATE INDEX "contract_billing_tenant_idx" ON "contract_billing" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "contract_billing_contract_id_idx" ON "contract_billing" USING btree ("tenant_id","company_id","contract_id");
--> statement-breakpoint
CREATE INDEX "contract_billing_invoice_id_idx" ON "contract_billing" USING btree ("tenant_id","company_id","invoice_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "contract_billing_contract_id_period_uq" ON "contract_billing" USING btree ("tenant_id","company_id","contract_id","period");
--> statement-breakpoint
CREATE INDEX "contract_billing_period_idx" ON "contract_billing" USING btree ("tenant_id","company_id","period");
--> statement-breakpoint
CREATE INDEX "example_tag_tenant_idx" ON "example_tag" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "example_tag_code_uq" ON "example_tag" USING btree ("tenant_id","company_id","code");
--> statement-breakpoint
CREATE POLICY "stock_count_tenant_isolation" ON "stock_count" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "stock_count_line_tenant_isolation" ON "stock_count_line" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "stock_entry_line_tenant_isolation" ON "stock_entry_line" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "stock_balance_tenant_isolation" ON "stock_balance" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "stock_ledger_tenant_isolation" ON "stock_ledger" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "warehouse_tenant_isolation" ON "warehouse" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "stock_entry_tenant_isolation" ON "stock_entry" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "contract_tenant_isolation" ON "contract" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "contract_line_tenant_isolation" ON "contract_line" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "contract_billing_tenant_isolation" ON "contract_billing" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "example_tag_tenant_isolation" ON "example_tag" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
