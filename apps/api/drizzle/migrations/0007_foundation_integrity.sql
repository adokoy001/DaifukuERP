-- No exchange-rate conversion is implied by adding the explicit JPY transaction contract.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM companies c
    WHERE c.currency <> 'JPY' AND (
      EXISTS (SELECT 1 FROM sales_invoice i WHERE i.tenant_id=c.tenant_id AND i.company_id=c.id)
      OR EXISTS (SELECT 1 FROM purchase_invoice i WHERE i.tenant_id=c.tenant_id AND i.company_id=c.id)
      OR EXISTS (SELECT 1 FROM payment p WHERE p.tenant_id=c.tenant_id AND p.company_id=c.id)
    )
  ) THEN
    RAISE EXCEPTION 'Foundation migration cannot relabel non-JPY financial records. Preserve their original currency and prepare an explicit currency migration.';
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE "sales_settlement" (
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
	"date" date NOT NULL,
	"amount" numeric(20, 6) NOT NULL,
	CONSTRAINT "sales_settlement_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "sales_settlement_tenant_id_uq" UNIQUE("tenant_id","id")
);

--> statement-breakpoint
ALTER TABLE "sales_settlement" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "purchase_settlement" (
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
	"date" date NOT NULL,
	"amount" numeric(20, 6) NOT NULL,
	CONSTRAINT "purchase_settlement_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "purchase_settlement_tenant_id_uq" UNIQUE("tenant_id","id")
);

--> statement-breakpoint
ALTER TABLE "purchase_settlement" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "inventory_period_close" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"ext" jsonb,
	"through_date" date NOT NULL,
	"source_entity" text NOT NULL,
	"source_id" uuid NOT NULL,
	CONSTRAINT "inventory_period_close_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "inventory_period_close_tenant_id_uq" UNIQUE("tenant_id","id")
);

--> statement-breakpoint
ALTER TABLE "inventory_period_close" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "journal_line" ADD COLUMN "account_type" text;
--> statement-breakpoint
ALTER TABLE "journal_line" ADD COLUMN "account_tax_role" text;
--> statement-breakpoint
ALTER TABLE "sales_invoice" ADD COLUMN "cancelled_date" date;
--> statement-breakpoint
ALTER TABLE "sales_invoice" ADD COLUMN "issued_snapshot" jsonb;
--> statement-breakpoint
ALTER TABLE "sales_invoice" ADD COLUMN "control_account_id" uuid;
--> statement-breakpoint
ALTER TABLE "sales_invoice" ADD COLUMN "settlement_history" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "sales_invoice" ADD COLUMN "currency" text DEFAULT 'JPY' NOT NULL;
--> statement-breakpoint
ALTER TABLE "sales_invoice_line" ADD COLUMN "uom_id" uuid;
--> statement-breakpoint
ALTER TABLE "sales_invoice_line" ADD COLUMN "uom_code" text;
--> statement-breakpoint
ALTER TABLE "purchase_invoice" ADD COLUMN "cancelled_date" date;
--> statement-breakpoint
ALTER TABLE "purchase_invoice" ADD COLUMN "control_account_id" uuid;
--> statement-breakpoint
ALTER TABLE "purchase_invoice" ADD COLUMN "settlement_history" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "purchase_invoice" ADD COLUMN "currency" text DEFAULT 'JPY' NOT NULL;
--> statement-breakpoint
ALTER TABLE "purchase_invoice_line" ADD COLUMN "uom_id" uuid;
--> statement-breakpoint
ALTER TABLE "purchase_invoice_line" ADD COLUMN "uom_code" text;
--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "cancelled_date" date;
--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "currency" text DEFAULT 'JPY' NOT NULL;
--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_tenant_id_uq" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "partner" ADD CONSTRAINT "partner_scope_id_uq" UNIQUE("tenant_id","company_id","id");
--> statement-breakpoint
ALTER TABLE "partner" ADD CONSTRAINT "partner_tenant_id_uq" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_scope_id_uq" UNIQUE("tenant_id","company_id","id");
--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_tenant_id_uq" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "uom" ADD CONSTRAINT "uom_scope_id_uq" UNIQUE("tenant_id","company_id","id");
--> statement-breakpoint
ALTER TABLE "uom" ADD CONSTRAINT "uom_tenant_id_uq" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "tax_rate" ADD CONSTRAINT "tax_rate_scope_id_uq" UNIQUE("tenant_id","company_id","id");
--> statement-breakpoint
ALTER TABLE "tax_rate" ADD CONSTRAINT "tax_rate_tenant_id_uq" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "fiscal_period" ADD CONSTRAINT "fiscal_period_scope_id_uq" UNIQUE("tenant_id","company_id","id");
--> statement-breakpoint
ALTER TABLE "fiscal_period" ADD CONSTRAINT "fiscal_period_tenant_id_uq" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "fiscal_year" ADD CONSTRAINT "fiscal_year_scope_id_uq" UNIQUE("tenant_id","company_id","id");
--> statement-breakpoint
ALTER TABLE "fiscal_year" ADD CONSTRAINT "fiscal_year_tenant_id_uq" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_scope_id_uq" UNIQUE("tenant_id","company_id","id");
--> statement-breakpoint
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_tenant_id_uq" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_scope_id_uq" UNIQUE("tenant_id","company_id","id");
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_tenant_id_uq" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_scope_id_uq" UNIQUE("tenant_id","company_id","id");
--> statement-breakpoint
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_tenant_id_uq" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_scope_id_uq" UNIQUE("tenant_id","company_id","id");
--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_tenant_id_uq" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "sales_invoice" ADD CONSTRAINT "sales_invoice_scope_id_uq" UNIQUE("tenant_id","company_id","id");
--> statement-breakpoint
ALTER TABLE "sales_invoice" ADD CONSTRAINT "sales_invoice_tenant_id_uq" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "sales_invoice_line" ADD CONSTRAINT "sales_invoice_line_scope_id_uq" UNIQUE("tenant_id","company_id","id");
--> statement-breakpoint
ALTER TABLE "sales_invoice_line" ADD CONSTRAINT "sales_invoice_line_tenant_id_uq" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "purchase_invoice" ADD CONSTRAINT "purchase_invoice_scope_id_uq" UNIQUE("tenant_id","company_id","id");
--> statement-breakpoint
ALTER TABLE "purchase_invoice" ADD CONSTRAINT "purchase_invoice_tenant_id_uq" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "purchase_invoice_line" ADD CONSTRAINT "purchase_invoice_line_scope_id_uq" UNIQUE("tenant_id","company_id","id");
--> statement-breakpoint
ALTER TABLE "purchase_invoice_line" ADD CONSTRAINT "purchase_invoice_line_tenant_id_uq" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_scope_id_uq" UNIQUE("tenant_id","company_id","id");
--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_tenant_id_uq" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_scope_id_uq" UNIQUE("tenant_id","company_id","id");
--> statement-breakpoint
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_tenant_id_uq" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "stock_count" ADD CONSTRAINT "stock_count_scope_id_uq" UNIQUE("tenant_id","company_id","id");
--> statement-breakpoint
ALTER TABLE "stock_count" ADD CONSTRAINT "stock_count_tenant_id_uq" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "stock_count_line" ADD CONSTRAINT "stock_count_line_scope_id_uq" UNIQUE("tenant_id","company_id","id");
--> statement-breakpoint
ALTER TABLE "stock_count_line" ADD CONSTRAINT "stock_count_line_tenant_id_uq" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "stock_entry_line" ADD CONSTRAINT "stock_entry_line_scope_id_uq" UNIQUE("tenant_id","company_id","id");
--> statement-breakpoint
ALTER TABLE "stock_entry_line" ADD CONSTRAINT "stock_entry_line_tenant_id_uq" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "stock_balance" ADD CONSTRAINT "stock_balance_scope_id_uq" UNIQUE("tenant_id","company_id","id");
--> statement-breakpoint
ALTER TABLE "stock_balance" ADD CONSTRAINT "stock_balance_tenant_id_uq" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_scope_id_uq" UNIQUE("tenant_id","company_id","id");
--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_tenant_id_uq" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "warehouse" ADD CONSTRAINT "warehouse_scope_id_uq" UNIQUE("tenant_id","company_id","id");
--> statement-breakpoint
ALTER TABLE "warehouse" ADD CONSTRAINT "warehouse_tenant_id_uq" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "stock_entry" ADD CONSTRAINT "stock_entry_scope_id_uq" UNIQUE("tenant_id","company_id","id");
--> statement-breakpoint
ALTER TABLE "stock_entry" ADD CONSTRAINT "stock_entry_tenant_id_uq" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_scope_id_uq" UNIQUE("tenant_id","company_id","id");
--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_tenant_id_uq" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "contract_line" ADD CONSTRAINT "contract_line_scope_id_uq" UNIQUE("tenant_id","company_id","id");
--> statement-breakpoint
ALTER TABLE "contract_line" ADD CONSTRAINT "contract_line_tenant_id_uq" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "contract_billing" ADD CONSTRAINT "contract_billing_scope_id_uq" UNIQUE("tenant_id","company_id","id");
--> statement-breakpoint
ALTER TABLE "contract_billing" ADD CONSTRAINT "contract_billing_tenant_id_uq" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "example_tag" ADD CONSTRAINT "example_tag_scope_id_uq" UNIQUE("tenant_id","company_id","id");
--> statement-breakpoint
ALTER TABLE "example_tag" ADD CONSTRAINT "example_tag_tenant_id_uq" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "retail_month_close" ADD CONSTRAINT "retail_month_close_scope_id_uq" UNIQUE("tenant_id","company_id","id");
--> statement-breakpoint
ALTER TABLE "retail_month_close" ADD CONSTRAINT "retail_month_close_tenant_id_uq" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "retail_closing" ADD CONSTRAINT "retail_closing_scope_id_uq" UNIQUE("tenant_id","company_id","id");
--> statement-breakpoint
ALTER TABLE "retail_closing" ADD CONSTRAINT "retail_closing_tenant_id_uq" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "retail_closing_line" ADD CONSTRAINT "retail_closing_line_scope_id_uq" UNIQUE("tenant_id","company_id","id");
--> statement-breakpoint
ALTER TABLE "retail_closing_line" ADD CONSTRAINT "retail_closing_line_tenant_id_uq" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "real_estate_unit" ADD CONSTRAINT "real_estate_unit_scope_id_uq" UNIQUE("tenant_id","company_id","id");
--> statement-breakpoint
ALTER TABLE "real_estate_unit" ADD CONSTRAINT "real_estate_unit_tenant_id_uq" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "real_estate_property" ADD CONSTRAINT "real_estate_property_scope_id_uq" UNIQUE("tenant_id","company_id","id");
--> statement-breakpoint
ALTER TABLE "real_estate_property" ADD CONSTRAINT "real_estate_property_tenant_id_uq" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "real_estate_deposit" ADD CONSTRAINT "real_estate_deposit_scope_id_uq" UNIQUE("tenant_id","company_id","id");
--> statement-breakpoint
ALTER TABLE "real_estate_deposit" ADD CONSTRAINT "real_estate_deposit_tenant_id_uq" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "sales_settlement" ADD CONSTRAINT "sales_settlement_invoice_id_sales_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."sales_invoice"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_settlement" ADD CONSTRAINT "sales_settlement_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_settlement" ADD CONSTRAINT "sales_settlement_invoice_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","invoice_id") REFERENCES "public"."sales_invoice"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_settlement" ADD CONSTRAINT "purchase_settlement_invoice_id_purchase_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."purchase_invoice"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_settlement" ADD CONSTRAINT "purchase_settlement_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_settlement" ADD CONSTRAINT "purchase_settlement_invoice_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","invoice_id") REFERENCES "public"."purchase_invoice"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inventory_period_close" ADD CONSTRAINT "inventory_period_close_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "sales_settlement_tenant_idx" ON "sales_settlement" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "sales_settlement_invoice_id_idx" ON "sales_settlement" USING btree ("tenant_id","company_id","invoice_id");
--> statement-breakpoint
CREATE INDEX "sales_settlement_invoice_id_date_idx" ON "sales_settlement" USING btree ("tenant_id","company_id","invoice_id","date");
--> statement-breakpoint
CREATE INDEX "purchase_settlement_tenant_idx" ON "purchase_settlement" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "purchase_settlement_invoice_id_idx" ON "purchase_settlement" USING btree ("tenant_id","company_id","invoice_id");
--> statement-breakpoint
CREATE INDEX "purchase_settlement_invoice_id_date_idx" ON "purchase_settlement" USING btree ("tenant_id","company_id","invoice_id","date");
--> statement-breakpoint
CREATE INDEX "inventory_period_close_tenant_idx" ON "inventory_period_close" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_period_close_through_date_uq" ON "inventory_period_close" USING btree ("tenant_id","company_id","through_date");
--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_default_company_scope_fk" FOREIGN KEY ("tenant_id","default_company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "partner" ADD CONSTRAINT "partner_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_uom_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","uom_id") REFERENCES "public"."uom"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "uom" ADD CONSTRAINT "uom_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tax_rate" ADD CONSTRAINT "tax_rate_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fiscal_period" ADD CONSTRAINT "fiscal_period_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fiscal_period" ADD CONSTRAINT "fiscal_period_fiscal_year_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","fiscal_year_id") REFERENCES "public"."fiscal_year"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fiscal_year" ADD CONSTRAINT "fiscal_year_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_reversal_of_scope_fk" FOREIGN KEY ("tenant_id","company_id","reversal_of") REFERENCES "public"."journal_entry"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_entry_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","entry_id") REFERENCES "public"."journal_entry"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_account_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","account_id") REFERENCES "public"."account"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_partner_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","partner_id") REFERENCES "public"."partner"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_partner_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","partner_id") REFERENCES "public"."partner"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_superseded_by_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","superseded_by_id") REFERENCES "public"."attachment"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_invoice" ADD CONSTRAINT "sales_invoice_control_account_id_account_id_fk" FOREIGN KEY ("control_account_id") REFERENCES "public"."account"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_invoice" ADD CONSTRAINT "sales_invoice_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_invoice" ADD CONSTRAINT "sales_invoice_control_account_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","control_account_id") REFERENCES "public"."account"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_invoice" ADD CONSTRAINT "sales_invoice_partner_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","partner_id") REFERENCES "public"."partner"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_invoice" ADD CONSTRAINT "sales_invoice_journal_entry_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","journal_entry_id") REFERENCES "public"."journal_entry"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_invoice_line" ADD CONSTRAINT "sales_invoice_line_uom_id_uom_id_fk" FOREIGN KEY ("uom_id") REFERENCES "public"."uom"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_invoice_line" ADD CONSTRAINT "sales_invoice_line_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_invoice_line" ADD CONSTRAINT "sales_invoice_line_uom_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","uom_id") REFERENCES "public"."uom"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_invoice_line" ADD CONSTRAINT "sales_invoice_line_invoice_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","invoice_id") REFERENCES "public"."sales_invoice"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_invoice_line" ADD CONSTRAINT "sales_invoice_line_product_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","product_id") REFERENCES "public"."product"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_invoice" ADD CONSTRAINT "purchase_invoice_control_account_id_account_id_fk" FOREIGN KEY ("control_account_id") REFERENCES "public"."account"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_invoice" ADD CONSTRAINT "purchase_invoice_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_invoice" ADD CONSTRAINT "purchase_invoice_control_account_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","control_account_id") REFERENCES "public"."account"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_invoice" ADD CONSTRAINT "purchase_invoice_partner_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","partner_id") REFERENCES "public"."partner"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_invoice" ADD CONSTRAINT "purchase_invoice_journal_entry_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","journal_entry_id") REFERENCES "public"."journal_entry"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_invoice_line" ADD CONSTRAINT "purchase_invoice_line_uom_id_uom_id_fk" FOREIGN KEY ("uom_id") REFERENCES "public"."uom"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_invoice_line" ADD CONSTRAINT "purchase_invoice_line_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_invoice_line" ADD CONSTRAINT "purchase_invoice_line_uom_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","uom_id") REFERENCES "public"."uom"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_invoice_line" ADD CONSTRAINT "purchase_invoice_line_invoice_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","invoice_id") REFERENCES "public"."purchase_invoice"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_invoice_line" ADD CONSTRAINT "purchase_invoice_line_product_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","product_id") REFERENCES "public"."product"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "purchase_invoice_line" ADD CONSTRAINT "purchase_invoice_line_account_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","account_id") REFERENCES "public"."account"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_partner_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","partner_id") REFERENCES "public"."partner"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_account_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","account_id") REFERENCES "public"."account"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_journal_entry_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","journal_entry_id") REFERENCES "public"."journal_entry"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_payment_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","payment_id") REFERENCES "public"."payment"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_count" ADD CONSTRAINT "stock_count_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_count" ADD CONSTRAINT "stock_count_warehouse_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","warehouse_id") REFERENCES "public"."warehouse"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_count" ADD CONSTRAINT "stock_count_adjustment_entry_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","adjustment_entry_id") REFERENCES "public"."stock_entry"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_count_line" ADD CONSTRAINT "stock_count_line_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_count_line" ADD CONSTRAINT "stock_count_line_count_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","count_id") REFERENCES "public"."stock_count"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_count_line" ADD CONSTRAINT "stock_count_line_product_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","product_id") REFERENCES "public"."product"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_entry_line" ADD CONSTRAINT "stock_entry_line_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_entry_line" ADD CONSTRAINT "stock_entry_line_entry_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","entry_id") REFERENCES "public"."stock_entry"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_entry_line" ADD CONSTRAINT "stock_entry_line_product_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","product_id") REFERENCES "public"."product"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_balance" ADD CONSTRAINT "stock_balance_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_balance" ADD CONSTRAINT "stock_balance_product_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","product_id") REFERENCES "public"."product"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_balance" ADD CONSTRAINT "stock_balance_warehouse_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","warehouse_id") REFERENCES "public"."warehouse"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_warehouse_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","warehouse_id") REFERENCES "public"."warehouse"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_product_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","product_id") REFERENCES "public"."product"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "warehouse" ADD CONSTRAINT "warehouse_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_entry" ADD CONSTRAINT "stock_entry_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_entry" ADD CONSTRAINT "stock_entry_warehouse_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","warehouse_id") REFERENCES "public"."warehouse"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_entry" ADD CONSTRAINT "stock_entry_to_warehouse_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","to_warehouse_id") REFERENCES "public"."warehouse"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stock_entry" ADD CONSTRAINT "stock_entry_partner_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","partner_id") REFERENCES "public"."partner"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_partner_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","partner_id") REFERENCES "public"."partner"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "contract_line" ADD CONSTRAINT "contract_line_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "contract_line" ADD CONSTRAINT "contract_line_contract_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","contract_id") REFERENCES "public"."contract"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "contract_line" ADD CONSTRAINT "contract_line_product_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","product_id") REFERENCES "public"."product"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "contract_billing" ADD CONSTRAINT "contract_billing_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "contract_billing" ADD CONSTRAINT "contract_billing_contract_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","contract_id") REFERENCES "public"."contract"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "contract_billing" ADD CONSTRAINT "contract_billing_invoice_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","invoice_id") REFERENCES "public"."sales_invoice"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "example_tag" ADD CONSTRAINT "example_tag_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "retail_month_close" ADD CONSTRAINT "retail_month_close_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "retail_month_close" ADD CONSTRAINT "retail_month_close_journal_entry_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","journal_entry_id") REFERENCES "public"."journal_entry"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "retail_closing" ADD CONSTRAINT "retail_closing_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "retail_closing" ADD CONSTRAINT "retail_closing_warehouse_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","warehouse_id") REFERENCES "public"."warehouse"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "retail_closing" ADD CONSTRAINT "retail_closing_sales_invoice_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","sales_invoice_id") REFERENCES "public"."sales_invoice"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "retail_closing" ADD CONSTRAINT "retail_closing_payment_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","payment_id") REFERENCES "public"."payment"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "retail_closing_line" ADD CONSTRAINT "retail_closing_line_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "retail_closing_line" ADD CONSTRAINT "retail_closing_line_closing_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","closing_id") REFERENCES "public"."retail_closing"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "retail_closing_line" ADD CONSTRAINT "retail_closing_line_product_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","product_id") REFERENCES "public"."product"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "real_estate_unit" ADD CONSTRAINT "real_estate_unit_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "real_estate_unit" ADD CONSTRAINT "real_estate_unit_property_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","property_id") REFERENCES "public"."real_estate_property"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "real_estate_property" ADD CONSTRAINT "real_estate_property_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "real_estate_deposit" ADD CONSTRAINT "real_estate_deposit_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "real_estate_deposit" ADD CONSTRAINT "real_estate_deposit_contract_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","contract_id") REFERENCES "public"."contract"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "real_estate_deposit" ADD CONSTRAINT "real_estate_deposit_partner_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","partner_id") REFERENCES "public"."partner"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "real_estate_deposit" ADD CONSTRAINT "real_estate_deposit_unit_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","unit_id") REFERENCES "public"."real_estate_unit"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "real_estate_deposit" ADD CONSTRAINT "real_estate_deposit_journal_entry_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","journal_entry_id") REFERENCES "public"."journal_entry"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "real_estate_deposit" ADD CONSTRAINT "real_estate_deposit_return_journal_entry_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","return_journal_entry_id") REFERENCES "public"."journal_entry"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "sales_invoice_control_account_id_idx" ON "sales_invoice" USING btree ("tenant_id","company_id","control_account_id");
--> statement-breakpoint
CREATE INDEX "sales_invoice_line_uom_id_idx" ON "sales_invoice_line" USING btree ("tenant_id","company_id","uom_id");
--> statement-breakpoint
CREATE INDEX "purchase_invoice_control_account_id_idx" ON "purchase_invoice" USING btree ("tenant_id","company_id","control_account_id");
--> statement-breakpoint
CREATE INDEX "purchase_invoice_line_uom_id_idx" ON "purchase_invoice_line" USING btree ("tenant_id","company_id","uom_id");
--> statement-breakpoint
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_account_type_chk" CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense'));
--> statement-breakpoint
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_account_tax_role_chk" CHECK (account_tax_role IN ('none', 'output_tax', 'input_tax'));
--> statement-breakpoint
ALTER TABLE "sales_invoice" ADD CONSTRAINT "sales_invoice_currency_chk" CHECK (currency IN ('JPY'));
--> statement-breakpoint
ALTER TABLE "purchase_invoice" ADD CONSTRAINT "purchase_invoice_currency_chk" CHECK (currency IN ('JPY'));
--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_currency_chk" CHECK (currency IN ('JPY'));
--> statement-breakpoint
CREATE POLICY "sales_settlement_tenant_isolation" ON "sales_settlement" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "purchase_settlement_tenant_isolation" ON "purchase_settlement" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "inventory_period_close_tenant_isolation" ON "inventory_period_close" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

--> statement-breakpoint
-- Historical facts supported by original documents. Do not infer historical issuer/account metadata from today's master.
WITH candidates AS (
 SELECT i.id, (array_agg(j.account_id))[1] AS account_id
 FROM sales_invoice i JOIN journal_entry e ON e.id=i.journal_entry_id AND e.tenant_id=i.tenant_id AND e.company_id=i.company_id
 JOIN journal_line j ON j.entry_id=e.id AND j.tenant_id=i.tenant_id AND j.company_id=i.company_id
 WHERE i.docstatus IN (1,2) AND e.docstatus=1 AND e.source_entity='sales_invoice' AND e.source_id=i.id
 AND j.partner_id=i.partner_id AND j.posted=true AND i.total<>0 AND (j.debit - j.credit)=i.total
 GROUP BY i.id HAVING count(*)=1
)
UPDATE sales_invoice i SET control_account_id=c.account_id FROM candidates c WHERE i.id=c.id;
--> statement-breakpoint
INSERT INTO sales_settlement (id,tenant_id,company_id,invoice_id,date,amount)
SELECT gen_random_uuid(),a.tenant_id,a.company_id,a.invoice_id,p.date,a.amount
FROM payment_allocation a JOIN payment p ON p.id=a.payment_id AND p.tenant_id=a.tenant_id AND p.company_id=a.company_id
JOIN sales_invoice i ON i.id=a.invoice_id AND i.tenant_id=a.tenant_id AND i.company_id=a.company_id
WHERE a.invoice_entity='sales_invoice' AND p.docstatus IN (1,2) AND i.docstatus IN (1,2);
--> statement-breakpoint
-- Legacy cancellation posted at the original payment date. Preserve that effective date.
INSERT INTO sales_settlement (id,tenant_id,company_id,invoice_id,date,amount)
SELECT gen_random_uuid(),a.tenant_id,a.company_id,a.invoice_id,p.date,-a.amount
FROM payment_allocation a JOIN payment p ON p.id=a.payment_id AND p.tenant_id=a.tenant_id AND p.company_id=a.company_id
JOIN sales_invoice i ON i.id=a.invoice_id AND i.tenant_id=a.tenant_id AND i.company_id=a.company_id
WHERE a.invoice_entity='sales_invoice' AND p.docstatus=2 AND i.docstatus IN (1,2);
--> statement-breakpoint
-- Partial or unreconstructable history remains explicitly unavailable.
UPDATE sales_invoice i SET settlement_history=true
WHERE EXISTS (SELECT 1 FROM sales_settlement h WHERE h.invoice_id=i.id)
AND i.paid_amount=(SELECT COALESCE(sum(h.amount),0) FROM sales_settlement h WHERE h.invoice_id=i.id);
--> statement-breakpoint
UPDATE sales_invoice SET cancelled_date=date WHERE docstatus=2;
--> statement-breakpoint
-- Historical facts supported by original documents. Do not infer historical issuer/account metadata from today's master.
WITH candidates AS (
 SELECT i.id, (array_agg(j.account_id))[1] AS account_id
 FROM purchase_invoice i JOIN journal_entry e ON e.id=i.journal_entry_id AND e.tenant_id=i.tenant_id AND e.company_id=i.company_id
 JOIN journal_line j ON j.entry_id=e.id AND j.tenant_id=i.tenant_id AND j.company_id=i.company_id
 WHERE i.docstatus IN (1,2) AND e.docstatus=1 AND e.source_entity='purchase_invoice' AND e.source_id=i.id
 AND j.partner_id=i.partner_id AND j.posted=true AND i.total<>0 AND (j.credit - j.debit)=i.total
 GROUP BY i.id HAVING count(*)=1
)
UPDATE purchase_invoice i SET control_account_id=c.account_id FROM candidates c WHERE i.id=c.id;
--> statement-breakpoint
INSERT INTO purchase_settlement (id,tenant_id,company_id,invoice_id,date,amount)
SELECT gen_random_uuid(),a.tenant_id,a.company_id,a.invoice_id,p.date,a.amount
FROM payment_allocation a JOIN payment p ON p.id=a.payment_id AND p.tenant_id=a.tenant_id AND p.company_id=a.company_id
JOIN purchase_invoice i ON i.id=a.invoice_id AND i.tenant_id=a.tenant_id AND i.company_id=a.company_id
WHERE a.invoice_entity='purchase_invoice' AND p.docstatus IN (1,2) AND i.docstatus IN (1,2);
--> statement-breakpoint
-- Legacy cancellation posted at the original payment date. Preserve that effective date.
INSERT INTO purchase_settlement (id,tenant_id,company_id,invoice_id,date,amount)
SELECT gen_random_uuid(),a.tenant_id,a.company_id,a.invoice_id,p.date,-a.amount
FROM payment_allocation a JOIN payment p ON p.id=a.payment_id AND p.tenant_id=a.tenant_id AND p.company_id=a.company_id
JOIN purchase_invoice i ON i.id=a.invoice_id AND i.tenant_id=a.tenant_id AND i.company_id=a.company_id
WHERE a.invoice_entity='purchase_invoice' AND p.docstatus=2 AND i.docstatus IN (1,2);
--> statement-breakpoint
-- Partial or unreconstructable history remains explicitly unavailable.
UPDATE purchase_invoice i SET settlement_history=true
WHERE EXISTS (SELECT 1 FROM purchase_settlement h WHERE h.invoice_id=i.id)
AND i.paid_amount=(SELECT COALESCE(sum(h.amount),0) FROM purchase_settlement h WHERE h.invoice_id=i.id);
--> statement-breakpoint
UPDATE purchase_invoice SET cancelled_date=date WHERE docstatus=2;
--> statement-breakpoint
UPDATE payment SET cancelled_date=date WHERE docstatus=2;
--> statement-breakpoint
INSERT INTO inventory_period_close (id,tenant_id,company_id,through_date,source_entity,source_id)
SELECT gen_random_uuid(),tenant_id,company_id,as_of,'retail_month_close',id FROM retail_month_close;
