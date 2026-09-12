CREATE TABLE "trade_quotation" (
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
	"direction" text NOT NULL,
	"partner_id" uuid NOT NULL,
	"partner_name" text,
	"date" date DEFAULT CURRENT_DATE NOT NULL,
	"currency" text DEFAULT 'JPY' NOT NULL,
	"note" text,
	"cancelled_date" date,
	"subtotal" numeric(20, 6) DEFAULT '0' NOT NULL,
	"tax_total" numeric(20, 6) DEFAULT '0' NOT NULL,
	"total" numeric(20, 6) DEFAULT '0' NOT NULL,
	"tax_summary" jsonb,
	"valid_until" date,
	CONSTRAINT "trade_quotation_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "trade_quotation_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "trade_quotation_direction_chk" CHECK (direction IN ('sales', 'purchase')),
	CONSTRAINT "trade_quotation_currency_chk" CHECK (currency IN ('JPY')),
	CONSTRAINT "trade_quotation_docstatus_chk" CHECK (docstatus IN (0, 1, 2))
);

--> statement-breakpoint
ALTER TABLE "trade_quotation" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "trade_quotation_line" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"ext" jsonb,
	"direction" text NOT NULL,
	"seq" integer DEFAULT 1 NOT NULL,
	"product_id" uuid NOT NULL,
	"description" text NOT NULL,
	"uom_id" uuid,
	"uom_code" text,
	"quantity" numeric(20, 6) DEFAULT '1' NOT NULL,
	"unit_price" numeric(20, 6) NOT NULL,
	"tax_category" text NOT NULL,
	"amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"quotation_id" uuid NOT NULL,
	CONSTRAINT "trade_quotation_line_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "trade_quotation_line_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "trade_quotation_line_direction_chk" CHECK (direction IN ('sales', 'purchase')),
	CONSTRAINT "trade_quotation_line_tax_category_chk" CHECK (tax_category IN ('standard', 'reduced', 'exempt', 'non_taxable', 'out_of_scope'))
);

--> statement-breakpoint
ALTER TABLE "trade_quotation_line" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "trade_order" (
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
	"direction" text NOT NULL,
	"partner_id" uuid NOT NULL,
	"partner_name" text,
	"date" date DEFAULT CURRENT_DATE NOT NULL,
	"currency" text DEFAULT 'JPY' NOT NULL,
	"note" text,
	"cancelled_date" date,
	"subtotal" numeric(20, 6) DEFAULT '0' NOT NULL,
	"tax_total" numeric(20, 6) DEFAULT '0' NOT NULL,
	"total" numeric(20, 6) DEFAULT '0' NOT NULL,
	"tax_summary" jsonb,
	"quotation_id" uuid,
	"required_date" date,
	"closed" boolean DEFAULT false NOT NULL,
	"closed_reason" text,
	CONSTRAINT "trade_order_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "trade_order_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "trade_order_direction_chk" CHECK (direction IN ('sales', 'purchase')),
	CONSTRAINT "trade_order_currency_chk" CHECK (currency IN ('JPY')),
	CONSTRAINT "trade_order_docstatus_chk" CHECK (docstatus IN (0, 1, 2))
);

--> statement-breakpoint
ALTER TABLE "trade_order" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "trade_order_line" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"ext" jsonb,
	"direction" text NOT NULL,
	"seq" integer DEFAULT 1 NOT NULL,
	"product_id" uuid NOT NULL,
	"description" text NOT NULL,
	"uom_id" uuid,
	"uom_code" text,
	"quantity" numeric(20, 6) DEFAULT '1' NOT NULL,
	"unit_price" numeric(20, 6) NOT NULL,
	"tax_category" text NOT NULL,
	"amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"order_id" uuid NOT NULL,
	CONSTRAINT "trade_order_line_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "trade_order_line_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "trade_order_line_direction_chk" CHECK (direction IN ('sales', 'purchase')),
	CONSTRAINT "trade_order_line_tax_category_chk" CHECK (tax_category IN ('standard', 'reduced', 'exempt', 'non_taxable', 'out_of_scope'))
);

--> statement-breakpoint
ALTER TABLE "trade_order_line" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "trade_fulfillment" (
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
	"direction" text NOT NULL,
	"partner_id" uuid NOT NULL,
	"partner_name" text,
	"date" date DEFAULT CURRENT_DATE NOT NULL,
	"currency" text DEFAULT 'JPY' NOT NULL,
	"note" text,
	"cancelled_date" date,
	"order_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"cancel_reason" text,
	"warehouse_name" text,
	"stock_entry_id" uuid,
	"request_id" uuid NOT NULL,
	"request_hash" text,
	CONSTRAINT "trade_fulfillment_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "trade_fulfillment_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "trade_fulfillment_direction_chk" CHECK (direction IN ('sales', 'purchase')),
	CONSTRAINT "trade_fulfillment_currency_chk" CHECK (currency IN ('JPY')),
	CONSTRAINT "trade_fulfillment_docstatus_chk" CHECK (docstatus IN (0, 1, 2))
);

--> statement-breakpoint
ALTER TABLE "trade_fulfillment" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "trade_fulfillment_line" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"ext" jsonb,
	"direction" text NOT NULL,
	"seq" integer DEFAULT 1 NOT NULL,
	"product_id" uuid NOT NULL,
	"description" text NOT NULL,
	"uom_id" uuid,
	"uom_code" text,
	"quantity" numeric(20, 6) DEFAULT '1' NOT NULL,
	"unit_price" numeric(20, 6) NOT NULL,
	"tax_category" text NOT NULL,
	"amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"fulfillment_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	CONSTRAINT "trade_fulfillment_line_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "trade_fulfillment_line_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "trade_fulfillment_line_direction_chk" CHECK (direction IN ('sales', 'purchase')),
	CONSTRAINT "trade_fulfillment_line_tax_category_chk" CHECK (tax_category IN ('standard', 'reduced', 'exempt', 'non_taxable', 'out_of_scope'))
);

--> statement-breakpoint
ALTER TABLE "trade_fulfillment_line" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "trade_billing" (
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
	"direction" text NOT NULL,
	"partner_id" uuid NOT NULL,
	"partner_name" text,
	"date" date DEFAULT CURRENT_DATE NOT NULL,
	"currency" text DEFAULT 'JPY' NOT NULL,
	"note" text,
	"cancelled_date" date,
	"fulfillment_id" uuid NOT NULL,
	"due_date" date,
	"supplier_invoice_no" text,
	"sales_invoice_id" uuid,
	"purchase_invoice_id" uuid,
	"total" numeric(20, 6) DEFAULT '0' NOT NULL,
	"request_id" uuid NOT NULL,
	"request_hash" text,
	"cancel_reason" text,
	CONSTRAINT "trade_billing_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "trade_billing_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "trade_billing_direction_chk" CHECK (direction IN ('sales', 'purchase')),
	CONSTRAINT "trade_billing_currency_chk" CHECK (currency IN ('JPY')),
	CONSTRAINT "trade_billing_docstatus_chk" CHECK (docstatus IN (0, 1, 2))
);

--> statement-breakpoint
ALTER TABLE "trade_billing" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "trade_billing_line" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"ext" jsonb,
	"direction" text NOT NULL,
	"seq" integer DEFAULT 1 NOT NULL,
	"product_id" uuid NOT NULL,
	"description" text NOT NULL,
	"uom_id" uuid,
	"uom_code" text,
	"quantity" numeric(20, 6) DEFAULT '1' NOT NULL,
	"unit_price" numeric(20, 6) NOT NULL,
	"tax_category" text NOT NULL,
	"amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"billing_id" uuid NOT NULL,
	"fulfillment_line_id" uuid NOT NULL,
	CONSTRAINT "trade_billing_line_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "trade_billing_line_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "trade_billing_line_direction_chk" CHECK (direction IN ('sales', 'purchase')),
	CONSTRAINT "trade_billing_line_tax_category_chk" CHECK (tax_category IN ('standard', 'reduced', 'exempt', 'non_taxable', 'out_of_scope'))
);

--> statement-breakpoint
ALTER TABLE "trade_billing_line" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "bank_account" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"ledger_account_id" uuid NOT NULL,
	"requester_code" text NOT NULL,
	"bank_code" text NOT NULL,
	"branch_code" text NOT NULL,
	"account_type" text NOT NULL,
	"account_number" text NOT NULL,
	"holder_kana" text NOT NULL,
	"active" boolean NOT NULL,
	CONSTRAINT "bank_account_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "bank_account_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "bank_account_account_type_chk" CHECK (account_type IN ('ordinary', 'current'))
);

--> statement-breakpoint
ALTER TABLE "bank_account" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "bank_payee" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"bank_code" text NOT NULL,
	"branch_code" text NOT NULL,
	"account_type" text NOT NULL,
	"account_number" text NOT NULL,
	"holder_kana" text NOT NULL,
	"active" boolean NOT NULL,
	CONSTRAINT "bank_payee_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "bank_payee_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "bank_payee_account_type_chk" CHECK (account_type IN ('ordinary', 'current'))
);

--> statement-breakpoint
ALTER TABLE "bank_payee" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "bank_import" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"import_key" text NOT NULL,
	"content_hash" text NOT NULL,
	"row_count" integer NOT NULL,
	"imported" integer NOT NULL,
	"duplicates" integer NOT NULL,
	CONSTRAINT "bank_import_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "bank_import_tenant_id_uq" UNIQUE("tenant_id","id")
);

--> statement-breakpoint
ALTER TABLE "bank_import" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "bank_statement" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"import_id" uuid NOT NULL,
	"identity_key" text NOT NULL,
	"content_hash" text NOT NULL,
	"external_id" text NOT NULL,
	"booked_on" date NOT NULL,
	"direction" text NOT NULL,
	"amount" numeric(20, 6) NOT NULL,
	"description" text,
	CONSTRAINT "bank_statement_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "bank_statement_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "bank_statement_direction_chk" CHECK (direction IN ('receive', 'pay'))
);

--> statement-breakpoint
ALTER TABLE "bank_statement" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "bank_reconciliation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"request_id" text NOT NULL,
	"request_hash" text NOT NULL,
	"statement_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"created_payment" boolean NOT NULL,
	"state" text NOT NULL,
	"reason" text NOT NULL,
	"reversed_on" date,
	"reversal_reason" text,
	CONSTRAINT "bank_reconciliation_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "bank_reconciliation_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "bank_reconciliation_state_chk" CHECK (state IN ('active', 'reversed'))
);

--> statement-breakpoint
ALTER TABLE "bank_reconciliation" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "bank_transfer" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"request_id" text NOT NULL,
	"request_hash" text NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"account_version" integer NOT NULL,
	"transfer_date" date NOT NULL,
	"state" text NOT NULL,
	"item_count" integer NOT NULL,
	"total" numeric(20, 6) NOT NULL,
	"snapshot" jsonb NOT NULL,
	"format" text,
	"line_ending" text,
	"content_hash" text,
	"export_bytes" jsonb,
	"cancel_reason" text,
	CONSTRAINT "bank_transfer_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "bank_transfer_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "bank_transfer_state_chk" CHECK (state IN ('prepared', 'exported', 'cancelled')),
	CONSTRAINT "bank_transfer_format_chk" CHECK (format IN ('canonical_csv', 'zengin120')),
	CONSTRAINT "bank_transfer_line_ending_chk" CHECK (line_ending IN ('none', 'crlf'))
);

--> statement-breakpoint
ALTER TABLE "bank_transfer" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "bank_transfer_reservation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"active" boolean NOT NULL,
	CONSTRAINT "bank_transfer_reservation_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "bank_transfer_reservation_tenant_id_uq" UNIQUE("tenant_id","id")
);

--> statement-breakpoint
ALTER TABLE "bank_transfer_reservation" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "filing_accounting_profile" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"key" text NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "filing_accounting_profile_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "filing_accounting_profile_tenant_id_uq" UNIQUE("tenant_id","id")
);

--> statement-breakpoint
ALTER TABLE "filing_accounting_profile" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "filing_payroll_profile" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"key" text NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "filing_payroll_profile_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "filing_payroll_profile_tenant_id_uq" UNIQUE("tenant_id","id")
);

--> statement-breakpoint
ALTER TABLE "filing_payroll_profile" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "filing_accounting_pack" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"country_profile" text NOT NULL,
	"from" date NOT NULL,
	"to" date NOT NULL,
	"fiscal_year_id" uuid,
	"tax_year" integer,
	"previous_id" uuid,
	"idempotency_key" uuid NOT NULL,
	"request" jsonb NOT NULL,
	"source" jsonb NOT NULL,
	"prepared" jsonb NOT NULL,
	"source_hash" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"prepared_by" uuid NOT NULL,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"review_reason" text,
	CONSTRAINT "filing_accounting_pack_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "filing_accounting_pack_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "filing_accounting_pack_status_chk" CHECK (status IN ('draft', 'confirmed', 'cancelled'))
);

--> statement-breakpoint
ALTER TABLE "filing_accounting_pack" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "filing_payroll_pack" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"country_profile" text NOT NULL,
	"from" date NOT NULL,
	"to" date NOT NULL,
	"fiscal_year_id" uuid,
	"tax_year" integer,
	"previous_id" uuid,
	"idempotency_key" uuid NOT NULL,
	"request" jsonb NOT NULL,
	"source" jsonb NOT NULL,
	"prepared" jsonb NOT NULL,
	"source_hash" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"prepared_by" uuid NOT NULL,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"review_reason" text,
	CONSTRAINT "filing_payroll_pack_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "filing_payroll_pack_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "filing_payroll_pack_status_chk" CHECK (status IN ('draft', 'confirmed', 'cancelled'))
);

--> statement-breakpoint
ALTER TABLE "filing_payroll_pack" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "trade_quotation" ADD CONSTRAINT "trade_quotation_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_quotation" ADD CONSTRAINT "trade_quotation_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_quotation" ADD CONSTRAINT "trade_quotation_partner_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","partner_id") REFERENCES "public"."partner"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_quotation_line" ADD CONSTRAINT "trade_quotation_line_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_quotation_line" ADD CONSTRAINT "trade_quotation_line_uom_id_uom_id_fk" FOREIGN KEY ("uom_id") REFERENCES "public"."uom"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_quotation_line" ADD CONSTRAINT "trade_quotation_line_quotation_id_trade_quotation_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."trade_quotation"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_quotation_line" ADD CONSTRAINT "trade_quotation_line_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_quotation_line" ADD CONSTRAINT "trade_quotation_line_product_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","product_id") REFERENCES "public"."product"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_quotation_line" ADD CONSTRAINT "trade_quotation_line_uom_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","uom_id") REFERENCES "public"."uom"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_quotation_line" ADD CONSTRAINT "trade_quotation_line_quotation_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","quotation_id") REFERENCES "public"."trade_quotation"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_order" ADD CONSTRAINT "trade_order_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_order" ADD CONSTRAINT "trade_order_quotation_id_trade_quotation_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."trade_quotation"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_order" ADD CONSTRAINT "trade_order_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_order" ADD CONSTRAINT "trade_order_partner_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","partner_id") REFERENCES "public"."partner"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_order" ADD CONSTRAINT "trade_order_quotation_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","quotation_id") REFERENCES "public"."trade_quotation"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_order_line" ADD CONSTRAINT "trade_order_line_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_order_line" ADD CONSTRAINT "trade_order_line_uom_id_uom_id_fk" FOREIGN KEY ("uom_id") REFERENCES "public"."uom"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_order_line" ADD CONSTRAINT "trade_order_line_order_id_trade_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."trade_order"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_order_line" ADD CONSTRAINT "trade_order_line_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_order_line" ADD CONSTRAINT "trade_order_line_product_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","product_id") REFERENCES "public"."product"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_order_line" ADD CONSTRAINT "trade_order_line_uom_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","uom_id") REFERENCES "public"."uom"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_order_line" ADD CONSTRAINT "trade_order_line_order_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","order_id") REFERENCES "public"."trade_order"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_fulfillment" ADD CONSTRAINT "trade_fulfillment_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_fulfillment" ADD CONSTRAINT "trade_fulfillment_order_id_trade_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."trade_order"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_fulfillment" ADD CONSTRAINT "trade_fulfillment_warehouse_id_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_fulfillment" ADD CONSTRAINT "trade_fulfillment_stock_entry_id_stock_entry_id_fk" FOREIGN KEY ("stock_entry_id") REFERENCES "public"."stock_entry"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_fulfillment" ADD CONSTRAINT "trade_fulfillment_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_fulfillment" ADD CONSTRAINT "trade_fulfillment_partner_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","partner_id") REFERENCES "public"."partner"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_fulfillment" ADD CONSTRAINT "trade_fulfillment_order_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","order_id") REFERENCES "public"."trade_order"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_fulfillment" ADD CONSTRAINT "trade_fulfillment_warehouse_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","warehouse_id") REFERENCES "public"."warehouse"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_fulfillment" ADD CONSTRAINT "trade_fulfillment_stock_entry_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","stock_entry_id") REFERENCES "public"."stock_entry"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_fulfillment_line" ADD CONSTRAINT "trade_fulfillment_line_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_fulfillment_line" ADD CONSTRAINT "trade_fulfillment_line_uom_id_uom_id_fk" FOREIGN KEY ("uom_id") REFERENCES "public"."uom"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_fulfillment_line" ADD CONSTRAINT "trade_fulfillment_line_fulfillment_id_trade_fulfillment_id_fk" FOREIGN KEY ("fulfillment_id") REFERENCES "public"."trade_fulfillment"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_fulfillment_line" ADD CONSTRAINT "trade_fulfillment_line_order_line_id_trade_order_line_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "public"."trade_order_line"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_fulfillment_line" ADD CONSTRAINT "trade_fulfillment_line_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_fulfillment_line" ADD CONSTRAINT "trade_fulfillment_line_product_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","product_id") REFERENCES "public"."product"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_fulfillment_line" ADD CONSTRAINT "trade_fulfillment_line_uom_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","uom_id") REFERENCES "public"."uom"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_fulfillment_line" ADD CONSTRAINT "trade_fulfillment_line_fulfillment_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","fulfillment_id") REFERENCES "public"."trade_fulfillment"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_fulfillment_line" ADD CONSTRAINT "trade_fulfillment_line_order_line_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","order_line_id") REFERENCES "public"."trade_order_line"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_billing" ADD CONSTRAINT "trade_billing_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_billing" ADD CONSTRAINT "trade_billing_fulfillment_id_trade_fulfillment_id_fk" FOREIGN KEY ("fulfillment_id") REFERENCES "public"."trade_fulfillment"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_billing" ADD CONSTRAINT "trade_billing_sales_invoice_id_sales_invoice_id_fk" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoice"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_billing" ADD CONSTRAINT "trade_billing_purchase_invoice_id_purchase_invoice_id_fk" FOREIGN KEY ("purchase_invoice_id") REFERENCES "public"."purchase_invoice"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_billing" ADD CONSTRAINT "trade_billing_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_billing" ADD CONSTRAINT "trade_billing_partner_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","partner_id") REFERENCES "public"."partner"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_billing" ADD CONSTRAINT "trade_billing_fulfillment_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","fulfillment_id") REFERENCES "public"."trade_fulfillment"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_billing" ADD CONSTRAINT "trade_billing_sales_invoice_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","sales_invoice_id") REFERENCES "public"."sales_invoice"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_billing" ADD CONSTRAINT "trade_billing_purchase_invoice_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","purchase_invoice_id") REFERENCES "public"."purchase_invoice"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_billing_line" ADD CONSTRAINT "trade_billing_line_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_billing_line" ADD CONSTRAINT "trade_billing_line_uom_id_uom_id_fk" FOREIGN KEY ("uom_id") REFERENCES "public"."uom"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_billing_line" ADD CONSTRAINT "trade_billing_line_billing_id_trade_billing_id_fk" FOREIGN KEY ("billing_id") REFERENCES "public"."trade_billing"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_billing_line" ADD CONSTRAINT "trade_billing_line_fulfillment_line_id_trade_fulfillment_line_id_fk" FOREIGN KEY ("fulfillment_line_id") REFERENCES "public"."trade_fulfillment_line"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_billing_line" ADD CONSTRAINT "trade_billing_line_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_billing_line" ADD CONSTRAINT "trade_billing_line_product_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","product_id") REFERENCES "public"."product"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_billing_line" ADD CONSTRAINT "trade_billing_line_uom_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","uom_id") REFERENCES "public"."uom"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_billing_line" ADD CONSTRAINT "trade_billing_line_billing_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","billing_id") REFERENCES "public"."trade_billing"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trade_billing_line" ADD CONSTRAINT "trade_billing_line_fulfillment_line_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","fulfillment_line_id") REFERENCES "public"."trade_fulfillment_line"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_account" ADD CONSTRAINT "bank_account_ledger_account_id_account_id_fk" FOREIGN KEY ("ledger_account_id") REFERENCES "public"."account"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_account" ADD CONSTRAINT "bank_account_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_account" ADD CONSTRAINT "bank_account_ledger_account_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","ledger_account_id") REFERENCES "public"."account"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_payee" ADD CONSTRAINT "bank_payee_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_payee" ADD CONSTRAINT "bank_payee_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_payee" ADD CONSTRAINT "bank_payee_partner_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","partner_id") REFERENCES "public"."partner"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_import" ADD CONSTRAINT "bank_import_bank_account_id_bank_account_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_account"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_import" ADD CONSTRAINT "bank_import_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_import" ADD CONSTRAINT "bank_import_bank_account_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","bank_account_id") REFERENCES "public"."bank_account"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_statement" ADD CONSTRAINT "bank_statement_bank_account_id_bank_account_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_account"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_statement" ADD CONSTRAINT "bank_statement_import_id_bank_import_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."bank_import"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_statement" ADD CONSTRAINT "bank_statement_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_statement" ADD CONSTRAINT "bank_statement_bank_account_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","bank_account_id") REFERENCES "public"."bank_account"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_statement" ADD CONSTRAINT "bank_statement_import_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","import_id") REFERENCES "public"."bank_import"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_reconciliation" ADD CONSTRAINT "bank_reconciliation_statement_id_bank_statement_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."bank_statement"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_reconciliation" ADD CONSTRAINT "bank_reconciliation_payment_id_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_reconciliation" ADD CONSTRAINT "bank_reconciliation_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_reconciliation" ADD CONSTRAINT "bank_reconciliation_statement_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","statement_id") REFERENCES "public"."bank_statement"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_reconciliation" ADD CONSTRAINT "bank_reconciliation_payment_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","payment_id") REFERENCES "public"."payment"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_transfer" ADD CONSTRAINT "bank_transfer_bank_account_id_bank_account_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_account"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_transfer" ADD CONSTRAINT "bank_transfer_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_transfer" ADD CONSTRAINT "bank_transfer_bank_account_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","bank_account_id") REFERENCES "public"."bank_account"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_transfer_reservation" ADD CONSTRAINT "bank_transfer_reservation_batch_id_bank_transfer_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."bank_transfer"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_transfer_reservation" ADD CONSTRAINT "bank_transfer_reservation_invoice_id_purchase_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."purchase_invoice"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_transfer_reservation" ADD CONSTRAINT "bank_transfer_reservation_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_transfer_reservation" ADD CONSTRAINT "bank_transfer_reservation_batch_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","batch_id") REFERENCES "public"."bank_transfer"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_transfer_reservation" ADD CONSTRAINT "bank_transfer_reservation_invoice_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","invoice_id") REFERENCES "public"."purchase_invoice"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "filing_accounting_profile" ADD CONSTRAINT "filing_accounting_profile_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "filing_payroll_profile" ADD CONSTRAINT "filing_payroll_profile_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "filing_accounting_pack" ADD CONSTRAINT "filing_accounting_pack_fiscal_year_id_fiscal_year_id_fk" FOREIGN KEY ("fiscal_year_id") REFERENCES "public"."fiscal_year"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "filing_accounting_pack" ADD CONSTRAINT "filing_accounting_pack_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "filing_accounting_pack" ADD CONSTRAINT "filing_accounting_pack_fiscal_year_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","fiscal_year_id") REFERENCES "public"."fiscal_year"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "filing_payroll_pack" ADD CONSTRAINT "filing_payroll_pack_fiscal_year_id_fiscal_year_id_fk" FOREIGN KEY ("fiscal_year_id") REFERENCES "public"."fiscal_year"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "filing_payroll_pack" ADD CONSTRAINT "filing_payroll_pack_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "filing_payroll_pack" ADD CONSTRAINT "filing_payroll_pack_fiscal_year_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","fiscal_year_id") REFERENCES "public"."fiscal_year"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "trade_quotation_tenant_idx" ON "trade_quotation" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "trade_quotation_partner_id_idx" ON "trade_quotation" USING btree ("tenant_id","company_id","partner_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "trade_quotation_number_uq" ON "trade_quotation" USING btree ("tenant_id","company_id","number");
--> statement-breakpoint
CREATE INDEX "trade_quotation_line_tenant_idx" ON "trade_quotation_line" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "trade_quotation_line_product_id_idx" ON "trade_quotation_line" USING btree ("tenant_id","company_id","product_id");
--> statement-breakpoint
CREATE INDEX "trade_quotation_line_uom_id_idx" ON "trade_quotation_line" USING btree ("tenant_id","company_id","uom_id");
--> statement-breakpoint
CREATE INDEX "trade_quotation_line_quotation_id_idx" ON "trade_quotation_line" USING btree ("tenant_id","company_id","quotation_id");
--> statement-breakpoint
CREATE INDEX "trade_order_tenant_idx" ON "trade_order" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "trade_order_partner_id_idx" ON "trade_order" USING btree ("tenant_id","company_id","partner_id");
--> statement-breakpoint
CREATE INDEX "trade_order_quotation_id_idx" ON "trade_order" USING btree ("tenant_id","company_id","quotation_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "trade_order_number_uq" ON "trade_order" USING btree ("tenant_id","company_id","number");
--> statement-breakpoint
CREATE INDEX "trade_order_line_tenant_idx" ON "trade_order_line" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "trade_order_line_product_id_idx" ON "trade_order_line" USING btree ("tenant_id","company_id","product_id");
--> statement-breakpoint
CREATE INDEX "trade_order_line_uom_id_idx" ON "trade_order_line" USING btree ("tenant_id","company_id","uom_id");
--> statement-breakpoint
CREATE INDEX "trade_order_line_order_id_idx" ON "trade_order_line" USING btree ("tenant_id","company_id","order_id");
--> statement-breakpoint
CREATE INDEX "trade_fulfillment_tenant_idx" ON "trade_fulfillment" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "trade_fulfillment_partner_id_idx" ON "trade_fulfillment" USING btree ("tenant_id","company_id","partner_id");
--> statement-breakpoint
CREATE INDEX "trade_fulfillment_order_id_idx" ON "trade_fulfillment" USING btree ("tenant_id","company_id","order_id");
--> statement-breakpoint
CREATE INDEX "trade_fulfillment_warehouse_id_idx" ON "trade_fulfillment" USING btree ("tenant_id","company_id","warehouse_id");
--> statement-breakpoint
CREATE INDEX "trade_fulfillment_stock_entry_id_idx" ON "trade_fulfillment" USING btree ("tenant_id","company_id","stock_entry_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "trade_fulfillment_request_id_uq" ON "trade_fulfillment" USING btree ("tenant_id","company_id","request_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "trade_fulfillment_number_uq" ON "trade_fulfillment" USING btree ("tenant_id","company_id","number");
--> statement-breakpoint
CREATE INDEX "trade_fulfillment_line_tenant_idx" ON "trade_fulfillment_line" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "trade_fulfillment_line_product_id_idx" ON "trade_fulfillment_line" USING btree ("tenant_id","company_id","product_id");
--> statement-breakpoint
CREATE INDEX "trade_fulfillment_line_uom_id_idx" ON "trade_fulfillment_line" USING btree ("tenant_id","company_id","uom_id");
--> statement-breakpoint
CREATE INDEX "trade_fulfillment_line_fulfillment_id_idx" ON "trade_fulfillment_line" USING btree ("tenant_id","company_id","fulfillment_id");
--> statement-breakpoint
CREATE INDEX "trade_fulfillment_line_order_line_id_idx" ON "trade_fulfillment_line" USING btree ("tenant_id","company_id","order_line_id");
--> statement-breakpoint
CREATE INDEX "trade_billing_tenant_idx" ON "trade_billing" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "trade_billing_partner_id_idx" ON "trade_billing" USING btree ("tenant_id","company_id","partner_id");
--> statement-breakpoint
CREATE INDEX "trade_billing_fulfillment_id_idx" ON "trade_billing" USING btree ("tenant_id","company_id","fulfillment_id");
--> statement-breakpoint
CREATE INDEX "trade_billing_sales_invoice_id_idx" ON "trade_billing" USING btree ("tenant_id","company_id","sales_invoice_id");
--> statement-breakpoint
CREATE INDEX "trade_billing_purchase_invoice_id_idx" ON "trade_billing" USING btree ("tenant_id","company_id","purchase_invoice_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "trade_billing_request_id_uq" ON "trade_billing" USING btree ("tenant_id","company_id","request_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "trade_billing_number_uq" ON "trade_billing" USING btree ("tenant_id","company_id","number");
--> statement-breakpoint
CREATE INDEX "trade_billing_line_tenant_idx" ON "trade_billing_line" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "trade_billing_line_product_id_idx" ON "trade_billing_line" USING btree ("tenant_id","company_id","product_id");
--> statement-breakpoint
CREATE INDEX "trade_billing_line_uom_id_idx" ON "trade_billing_line" USING btree ("tenant_id","company_id","uom_id");
--> statement-breakpoint
CREATE INDEX "trade_billing_line_billing_id_idx" ON "trade_billing_line" USING btree ("tenant_id","company_id","billing_id");
--> statement-breakpoint
CREATE INDEX "trade_billing_line_fulfillment_line_id_idx" ON "trade_billing_line" USING btree ("tenant_id","company_id","fulfillment_line_id");
--> statement-breakpoint
CREATE INDEX "bank_account_tenant_idx" ON "bank_account" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "bank_account_code_uq" ON "bank_account" USING btree ("tenant_id","company_id","code");
--> statement-breakpoint
CREATE INDEX "bank_account_ledger_account_id_idx" ON "bank_account" USING btree ("tenant_id","company_id","ledger_account_id");
--> statement-breakpoint
CREATE INDEX "bank_payee_tenant_idx" ON "bank_payee" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "bank_payee_partner_id_uq" ON "bank_payee" USING btree ("tenant_id","company_id","partner_id");
--> statement-breakpoint
CREATE INDEX "bank_import_tenant_idx" ON "bank_import" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "bank_import_bank_account_id_idx" ON "bank_import" USING btree ("tenant_id","company_id","bank_account_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "bank_import_import_key_uq" ON "bank_import" USING btree ("tenant_id","company_id","import_key");
--> statement-breakpoint
CREATE INDEX "bank_statement_tenant_idx" ON "bank_statement" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "bank_statement_bank_account_id_idx" ON "bank_statement" USING btree ("tenant_id","company_id","bank_account_id");
--> statement-breakpoint
CREATE INDEX "bank_statement_import_id_idx" ON "bank_statement" USING btree ("tenant_id","company_id","import_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "bank_statement_identity_key_uq" ON "bank_statement" USING btree ("tenant_id","company_id","identity_key");
--> statement-breakpoint
CREATE INDEX "bank_statement_bank_account_id_booked_on_idx" ON "bank_statement" USING btree ("tenant_id","company_id","bank_account_id","booked_on");
--> statement-breakpoint
CREATE INDEX "bank_reconciliation_tenant_idx" ON "bank_reconciliation" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "bank_reconciliation_request_id_uq" ON "bank_reconciliation" USING btree ("tenant_id","company_id","request_id");
--> statement-breakpoint
CREATE INDEX "bank_reconciliation_statement_id_idx" ON "bank_reconciliation" USING btree ("tenant_id","company_id","statement_id");
--> statement-breakpoint
CREATE INDEX "bank_reconciliation_payment_id_idx" ON "bank_reconciliation" USING btree ("tenant_id","company_id","payment_id");
--> statement-breakpoint
CREATE INDEX "bank_reconciliation_statement_id_state_idx" ON "bank_reconciliation" USING btree ("tenant_id","company_id","statement_id","state");
--> statement-breakpoint
CREATE INDEX "bank_reconciliation_payment_id_state_idx" ON "bank_reconciliation" USING btree ("tenant_id","company_id","payment_id","state");
--> statement-breakpoint
CREATE INDEX "bank_transfer_tenant_idx" ON "bank_transfer" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "bank_transfer_request_id_uq" ON "bank_transfer" USING btree ("tenant_id","company_id","request_id");
--> statement-breakpoint
CREATE INDEX "bank_transfer_bank_account_id_idx" ON "bank_transfer" USING btree ("tenant_id","company_id","bank_account_id");
--> statement-breakpoint
CREATE INDEX "bank_transfer_reservation_tenant_idx" ON "bank_transfer_reservation" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "bank_transfer_reservation_batch_id_idx" ON "bank_transfer_reservation" USING btree ("tenant_id","company_id","batch_id");
--> statement-breakpoint
CREATE INDEX "bank_transfer_reservation_invoice_id_idx" ON "bank_transfer_reservation" USING btree ("tenant_id","company_id","invoice_id");
--> statement-breakpoint
CREATE INDEX "bank_transfer_reservation_invoice_id_active_idx" ON "bank_transfer_reservation" USING btree ("tenant_id","company_id","invoice_id","active");
--> statement-breakpoint
CREATE INDEX "filing_accounting_profile_tenant_idx" ON "filing_accounting_profile" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "filing_accounting_profile_key_uq" ON "filing_accounting_profile" USING btree ("tenant_id","company_id","key");
--> statement-breakpoint
CREATE INDEX "filing_payroll_profile_tenant_idx" ON "filing_payroll_profile" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "filing_payroll_profile_key_uq" ON "filing_payroll_profile" USING btree ("tenant_id","company_id","key");
--> statement-breakpoint
CREATE INDEX "filing_accounting_pack_tenant_idx" ON "filing_accounting_pack" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "filing_accounting_pack_fiscal_year_id_idx" ON "filing_accounting_pack" USING btree ("tenant_id","company_id","fiscal_year_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "filing_accounting_pack_idempotency_key_uq" ON "filing_accounting_pack" USING btree ("tenant_id","company_id","idempotency_key");
--> statement-breakpoint
CREATE INDEX "filing_payroll_pack_tenant_idx" ON "filing_payroll_pack" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "filing_payroll_pack_fiscal_year_id_idx" ON "filing_payroll_pack" USING btree ("tenant_id","company_id","fiscal_year_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "filing_payroll_pack_idempotency_key_uq" ON "filing_payroll_pack" USING btree ("tenant_id","company_id","idempotency_key");
--> statement-breakpoint
CREATE POLICY "trade_quotation_tenant_isolation" ON "trade_quotation" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "trade_quotation_line_tenant_isolation" ON "trade_quotation_line" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "trade_order_tenant_isolation" ON "trade_order" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "trade_order_line_tenant_isolation" ON "trade_order_line" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "trade_fulfillment_tenant_isolation" ON "trade_fulfillment" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "trade_fulfillment_line_tenant_isolation" ON "trade_fulfillment_line" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "trade_billing_tenant_isolation" ON "trade_billing" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "trade_billing_line_tenant_isolation" ON "trade_billing_line" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "bank_account_tenant_isolation" ON "bank_account" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "bank_payee_tenant_isolation" ON "bank_payee" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "bank_import_tenant_isolation" ON "bank_import" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "bank_statement_tenant_isolation" ON "bank_statement" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "bank_reconciliation_tenant_isolation" ON "bank_reconciliation" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "bank_transfer_tenant_isolation" ON "bank_transfer" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "bank_transfer_reservation_tenant_isolation" ON "bank_transfer_reservation" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "filing_accounting_profile_tenant_isolation" ON "filing_accounting_profile" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "filing_payroll_profile_tenant_isolation" ON "filing_payroll_profile" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "filing_accounting_pack_tenant_isolation" ON "filing_accounting_pack" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "filing_payroll_pack_tenant_isolation" ON "filing_payroll_pack" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
