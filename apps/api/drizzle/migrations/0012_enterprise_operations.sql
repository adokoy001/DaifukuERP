CREATE TABLE "identity_challenges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"purpose" text NOT NULL,
	"token_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
ALTER TABLE "identity_challenges" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "identity_factors" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"secret_cipher" text NOT NULL,
	"recovery_hashes" jsonb NOT NULL,
	"last_step" integer DEFAULT -1 NOT NULL
);

--> statement-breakpoint
ALTER TABLE "identity_factors" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "identity_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"issuer" text NOT NULL,
	"subject" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
ALTER TABLE "identity_links" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "identity_mail_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payload_cipher" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"lease_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"delivered_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
ALTER TABLE "identity_mail_outbox" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "identity_rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL
);

--> statement-breakpoint
CREATE TABLE "workforce_payroll_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"tax_year" integer NOT NULL,
	"data" jsonb NOT NULL,
	"sources" jsonb NOT NULL,
	"verified_on" date NOT NULL,
	CONSTRAINT "workforce_payroll_rules_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "workforce_payroll_rules_tenant_id_uq" UNIQUE("tenant_id","id")
);

--> statement-breakpoint
ALTER TABLE "workforce_payroll_rules" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "workforce_payroll_condition" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date NOT NULL,
	"condition" jsonb NOT NULL,
	CONSTRAINT "workforce_payroll_condition_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "workforce_payroll_condition_tenant_id_uq" UNIQUE("tenant_id","id")
);

--> statement-breakpoint
ALTER TABLE "workforce_payroll_condition" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "workforce_payroll_tax_evidence" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"payroll_id" uuid NOT NULL,
	"payment_date" date NOT NULL,
	"taxable_pay" numeric(20, 6) NOT NULL,
	"social_premium" numeric(20, 6) NOT NULL,
	"income_tax" numeric(20, 6) NOT NULL,
	"basis" text NOT NULL,
	CONSTRAINT "workforce_payroll_tax_evidence_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "workforce_payroll_tax_evidence_tenant_id_uq" UNIQUE("tenant_id","id")
);

--> statement-breakpoint
ALTER TABLE "workforce_payroll_tax_evidence" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "workforce_year_end_declaration" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"tax_year" integer NOT NULL,
	"declaration" jsonb NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_reason" text,
	CONSTRAINT "workforce_year_end_declaration_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "workforce_year_end_declaration_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "workforce_year_end_declaration_status_chk" CHECK (status IN ('submitted', 'accepted', 'returned'))
);

--> statement-breakpoint
ALTER TABLE "workforce_year_end_declaration" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "workforce_year_end_adjustment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"docstatus" smallint DEFAULT 0 NOT NULL,
	"number" text,
	"amended_from" uuid,
	"employee_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"tax_year" integer NOT NULL,
	"declaration_id" uuid NOT NULL,
	"adjusted_on" date NOT NULL,
	"taxable_pay" numeric(20, 6) NOT NULL,
	"annual_tax" numeric(20, 6) NOT NULL,
	"withheld_tax" numeric(20, 6) NOT NULL,
	"refund" numeric(20, 6) NOT NULL,
	"additional_tax" numeric(20, 6) NOT NULL,
	"calculation" jsonb NOT NULL,
	"source_fingerprint" text NOT NULL,
	"settled_on" date,
	"settlement_reference" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_reason" text,
	CONSTRAINT "workforce_year_end_adjustment_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "workforce_year_end_adjustment_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "workforce_year_end_adjustment_docstatus_chk" CHECK (docstatus IN (0, 1, 2))
);

--> statement-breakpoint
ALTER TABLE "workforce_year_end_adjustment" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "workforce_work_system_period" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"mode" text NOT NULL,
	"weekly_minutes" integer NOT NULL,
	"standard_day_minutes" integer NOT NULL,
	"agreed_total_minutes" integer NOT NULL,
	"days" jsonb NOT NULL,
	"agreement_reference" text NOT NULL,
	"agreement_confirmed" boolean NOT NULL,
	"employee_choice_confirmed" boolean NOT NULL,
	"filing_confirmed" boolean NOT NULL,
	"basis" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_reason" text,
	CONSTRAINT "workforce_work_system_period_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "workforce_work_system_period_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "workforce_work_system_period_mode_chk" CHECK (mode IN ('ordinary', 'monthly_variable', 'flex')),
	CONSTRAINT "workforce_work_system_period_status_chk" CHECK (status IN ('draft', 'confirmed', 'cancelled'))
);

--> statement-breakpoint
ALTER TABLE "workforce_work_system_period" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "pos_integration_location" (
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
	"provider" text DEFAULT 'square' NOT NULL,
	"merchant_id" text NOT NULL,
	"external_location_id" text NOT NULL,
	"mapping_key" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"settlement_account_id" uuid NOT NULL,
	"suspense_account_id" uuid NOT NULL,
	CONSTRAINT "pos_integration_location_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "pos_integration_location_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "pos_integration_location_provider_chk" CHECK (provider IN ('square'))
);

--> statement-breakpoint
ALTER TABLE "pos_integration_location" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "pos_integration_inbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"event_id" text NOT NULL,
	"kind" text NOT NULL,
	"external_id" text NOT NULL,
	"payment_id" text,
	"event" jsonb NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"transaction_id" uuid,
	"received_at" timestamp with time zone NOT NULL,
	"last_attempt_at" timestamp with time zone,
	CONSTRAINT "pos_integration_inbox_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "pos_integration_inbox_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "pos_integration_inbox_status_chk" CHECK (status IN ('received', 'ignored', 'deferred', 'blocked', 'posted'))
);

--> statement-breakpoint
ALTER TABLE "pos_integration_inbox" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "pos_integration_transaction" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"external_id" text NOT NULL,
	"payment_id" uuid,
	"date" date NOT NULL,
	"amount" numeric(20, 6) NOT NULL,
	"currency" text DEFAULT 'JPY' NOT NULL,
	"refunded" numeric(20, 6) DEFAULT '0' NOT NULL,
	"raw_hash" text NOT NULL,
	"settlement_account_id" uuid NOT NULL,
	"suspense_account_id" uuid NOT NULL,
	"journal_entry_id" uuid,
	"status" text DEFAULT 'posted' NOT NULL,
	"cancelled_date" date,
	"cancel_reason" text,
	CONSTRAINT "pos_integration_transaction_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "pos_integration_transaction_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "pos_integration_transaction_kind_chk" CHECK (kind IN ('payment', 'refund')),
	CONSTRAINT "pos_integration_transaction_currency_chk" CHECK (currency IN ('JPY')),
	CONSTRAINT "pos_integration_transaction_status_chk" CHECK (status IN ('posted', 'cancelled'))
);

--> statement-breakpoint
ALTER TABLE "pos_integration_transaction" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "group_accounting_run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"from" date NOT NULL,
	"to" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"sources" jsonb NOT NULL,
	"mapping" jsonb NOT NULL,
	"adjustments" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"review_basis" text NOT NULL,
	"confirmed_at" timestamp with time zone,
	"reason" text,
	CONSTRAINT "group_accounting_run_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "group_accounting_run_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "group_accounting_run_status_chk" CHECK (status IN ('draft', 'confirmed', 'cancelled'))
);

--> statement-breakpoint
ALTER TABLE "group_accounting_run" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "franchise_agreement" (
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
	"partner_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"basis" text NOT NULL,
	"rate" numeric(20, 6) NOT NULL,
	"fixed_amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"rounding" text NOT NULL,
	"tax_category" text NOT NULL,
	"expense_account_id" uuid,
	CONSTRAINT "franchise_agreement_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "franchise_agreement_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "franchise_agreement_direction_chk" CHECK (direction IN ('bill', 'pay')),
	CONSTRAINT "franchise_agreement_basis_chk" CHECK (basis IN ('gross', 'net')),
	CONSTRAINT "franchise_agreement_rounding_chk" CHECK (rounding IN ('down', 'half_up', 'up')),
	CONSTRAINT "franchise_agreement_tax_category_chk" CHECK (tax_category IN ('standard', 'reduced', 'exempt', 'non_taxable', 'out_of_scope'))
);

--> statement-breakpoint
ALTER TABLE "franchise_agreement" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "franchise_settlement" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"agreement_id" uuid NOT NULL,
	"month" text NOT NULL,
	"direction" text NOT NULL,
	"status" text NOT NULL,
	"gross_sales" numeric(20, 6) NOT NULL,
	"net_sales" numeric(20, 6) NOT NULL,
	"source_reference" text NOT NULL,
	"contract" jsonb NOT NULL,
	"fee" numeric(20, 6) NOT NULL,
	"total" numeric(20, 6) NOT NULL,
	"tax" numeric(20, 6) NOT NULL,
	"date" date NOT NULL,
	"due_date" date NOT NULL,
	"sales_invoice_id" uuid,
	"purchase_invoice_id" uuid,
	"payment_id" uuid,
	"cancelled_date" date,
	"cancel_reason" text,
	CONSTRAINT "franchise_settlement_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "franchise_settlement_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "franchise_settlement_direction_chk" CHECK (direction IN ('bill', 'pay')),
	CONSTRAINT "franchise_settlement_status_chk" CHECK (status IN ('invoiced', 'paid', 'cancelled'))
);

--> statement-breakpoint
ALTER TABLE "franchise_settlement" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mfa_enabled" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "identity_challenges" ADD CONSTRAINT "identity_challenges_tenant_id_user_id_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "identity_factors" ADD CONSTRAINT "identity_factors_tenant_id_user_id_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "identity_links" ADD CONSTRAINT "identity_links_tenant_id_user_id_users_tenant_id_id_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_payroll_rules" ADD CONSTRAINT "workforce_payroll_rules_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_payroll_condition" ADD CONSTRAINT "workforce_payroll_condition_employee_id_workforce_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."workforce_employee"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_payroll_condition" ADD CONSTRAINT "workforce_payroll_condition_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_payroll_condition" ADD CONSTRAINT "workforce_payroll_condition_employee_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","employee_id") REFERENCES "public"."workforce_employee"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_payroll_tax_evidence" ADD CONSTRAINT "workforce_payroll_tax_evidence_employee_id_workforce_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."workforce_employee"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_payroll_tax_evidence" ADD CONSTRAINT "workforce_payroll_tax_evidence_site_id_workforce_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."workforce_site"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_payroll_tax_evidence" ADD CONSTRAINT "workforce_payroll_tax_evidence_payroll_id_workforce_payroll_id_fk" FOREIGN KEY ("payroll_id") REFERENCES "public"."workforce_payroll"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_payroll_tax_evidence" ADD CONSTRAINT "workforce_payroll_tax_evidence_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_payroll_tax_evidence" ADD CONSTRAINT "workforce_payroll_tax_evidence_employee_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","employee_id") REFERENCES "public"."workforce_employee"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_payroll_tax_evidence" ADD CONSTRAINT "workforce_payroll_tax_evidence_site_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","site_id") REFERENCES "public"."workforce_site"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_payroll_tax_evidence" ADD CONSTRAINT "workforce_payroll_tax_evidence_payroll_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","payroll_id") REFERENCES "public"."workforce_payroll"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_year_end_declaration" ADD CONSTRAINT "workforce_year_end_declaration_employee_id_workforce_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."workforce_employee"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_year_end_declaration" ADD CONSTRAINT "workforce_year_end_declaration_site_id_workforce_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."workforce_site"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_year_end_declaration" ADD CONSTRAINT "workforce_year_end_declaration_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_year_end_declaration" ADD CONSTRAINT "workforce_year_end_declaration_employee_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","employee_id") REFERENCES "public"."workforce_employee"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_year_end_declaration" ADD CONSTRAINT "workforce_year_end_declaration_site_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","site_id") REFERENCES "public"."workforce_site"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_year_end_adjustment" ADD CONSTRAINT "workforce_year_end_adjustment_employee_id_workforce_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."workforce_employee"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_year_end_adjustment" ADD CONSTRAINT "workforce_year_end_adjustment_site_id_workforce_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."workforce_site"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_year_end_adjustment" ADD CONSTRAINT "workforce_year_end_adjustment_declaration_id_workforce_year_end_declaration_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."workforce_year_end_declaration"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_year_end_adjustment" ADD CONSTRAINT "workforce_year_end_adjustment_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_year_end_adjustment" ADD CONSTRAINT "workforce_year_end_adjustment_employee_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","employee_id") REFERENCES "public"."workforce_employee"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_year_end_adjustment" ADD CONSTRAINT "workforce_year_end_adjustment_site_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","site_id") REFERENCES "public"."workforce_site"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_year_end_adjustment" ADD CONSTRAINT "workforce_year_end_adjustment_declaration_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","declaration_id") REFERENCES "public"."workforce_year_end_declaration"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_work_system_period" ADD CONSTRAINT "workforce_work_system_period_employee_id_workforce_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."workforce_employee"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_work_system_period" ADD CONSTRAINT "workforce_work_system_period_site_id_workforce_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."workforce_site"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_work_system_period" ADD CONSTRAINT "workforce_work_system_period_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_work_system_period" ADD CONSTRAINT "workforce_work_system_period_employee_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","employee_id") REFERENCES "public"."workforce_employee"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_work_system_period" ADD CONSTRAINT "workforce_work_system_period_site_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","site_id") REFERENCES "public"."workforce_site"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_integration_location" ADD CONSTRAINT "pos_integration_location_settlement_account_id_account_id_fk" FOREIGN KEY ("settlement_account_id") REFERENCES "public"."account"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_integration_location" ADD CONSTRAINT "pos_integration_location_suspense_account_id_account_id_fk" FOREIGN KEY ("suspense_account_id") REFERENCES "public"."account"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_integration_location" ADD CONSTRAINT "pos_integration_location_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_integration_location" ADD CONSTRAINT "pos_integration_location_settlement_account_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","settlement_account_id") REFERENCES "public"."account"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_integration_location" ADD CONSTRAINT "pos_integration_location_suspense_account_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","suspense_account_id") REFERENCES "public"."account"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_integration_inbox" ADD CONSTRAINT "pos_integration_inbox_location_id_pos_integration_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."pos_integration_location"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_integration_inbox" ADD CONSTRAINT "pos_integration_inbox_transaction_id_pos_integration_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."pos_integration_transaction"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_integration_inbox" ADD CONSTRAINT "pos_integration_inbox_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_integration_inbox" ADD CONSTRAINT "pos_integration_inbox_location_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","location_id") REFERENCES "public"."pos_integration_location"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_integration_inbox" ADD CONSTRAINT "pos_integration_inbox_transaction_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","transaction_id") REFERENCES "public"."pos_integration_transaction"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_integration_transaction" ADD CONSTRAINT "pos_integration_transaction_location_id_pos_integration_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."pos_integration_location"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_integration_transaction" ADD CONSTRAINT "pos_integration_transaction_payment_id_pos_integration_transaction_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."pos_integration_transaction"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_integration_transaction" ADD CONSTRAINT "pos_integration_transaction_settlement_account_id_account_id_fk" FOREIGN KEY ("settlement_account_id") REFERENCES "public"."account"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_integration_transaction" ADD CONSTRAINT "pos_integration_transaction_suspense_account_id_account_id_fk" FOREIGN KEY ("suspense_account_id") REFERENCES "public"."account"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_integration_transaction" ADD CONSTRAINT "pos_integration_transaction_journal_entry_id_journal_entry_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entry"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_integration_transaction" ADD CONSTRAINT "pos_integration_transaction_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_integration_transaction" ADD CONSTRAINT "pos_integration_transaction_location_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","location_id") REFERENCES "public"."pos_integration_location"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_integration_transaction" ADD CONSTRAINT "pos_integration_transaction_payment_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","payment_id") REFERENCES "public"."pos_integration_transaction"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_integration_transaction" ADD CONSTRAINT "pos_integration_transaction_settlement_account_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","settlement_account_id") REFERENCES "public"."account"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_integration_transaction" ADD CONSTRAINT "pos_integration_transaction_suspense_account_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","suspense_account_id") REFERENCES "public"."account"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_integration_transaction" ADD CONSTRAINT "pos_integration_transaction_journal_entry_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","journal_entry_id") REFERENCES "public"."journal_entry"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "group_accounting_run" ADD CONSTRAINT "group_accounting_run_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "franchise_agreement" ADD CONSTRAINT "franchise_agreement_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "franchise_agreement" ADD CONSTRAINT "franchise_agreement_expense_account_id_account_id_fk" FOREIGN KEY ("expense_account_id") REFERENCES "public"."account"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "franchise_agreement" ADD CONSTRAINT "franchise_agreement_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "franchise_agreement" ADD CONSTRAINT "franchise_agreement_partner_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","partner_id") REFERENCES "public"."partner"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "franchise_agreement" ADD CONSTRAINT "franchise_agreement_expense_account_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","expense_account_id") REFERENCES "public"."account"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "franchise_settlement" ADD CONSTRAINT "franchise_settlement_agreement_id_franchise_agreement_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."franchise_agreement"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "franchise_settlement" ADD CONSTRAINT "franchise_settlement_sales_invoice_id_sales_invoice_id_fk" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoice"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "franchise_settlement" ADD CONSTRAINT "franchise_settlement_purchase_invoice_id_purchase_invoice_id_fk" FOREIGN KEY ("purchase_invoice_id") REFERENCES "public"."purchase_invoice"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "franchise_settlement" ADD CONSTRAINT "franchise_settlement_payment_id_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "franchise_settlement" ADD CONSTRAINT "franchise_settlement_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "franchise_settlement" ADD CONSTRAINT "franchise_settlement_agreement_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","agreement_id") REFERENCES "public"."franchise_agreement"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "franchise_settlement" ADD CONSTRAINT "franchise_settlement_sales_invoice_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","sales_invoice_id") REFERENCES "public"."sales_invoice"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "franchise_settlement" ADD CONSTRAINT "franchise_settlement_purchase_invoice_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","purchase_invoice_id") REFERENCES "public"."purchase_invoice"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "franchise_settlement" ADD CONSTRAINT "franchise_settlement_payment_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","payment_id") REFERENCES "public"."payment"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "identity_challenge_hash_uq" ON "identity_challenges" USING btree ("token_hash");
--> statement-breakpoint
CREATE INDEX "identity_challenge_expiry_idx" ON "identity_challenges" USING btree ("expires_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "identity_link_subject_uq" ON "identity_links" USING btree ("tenant_id","issuer","subject");
--> statement-breakpoint
CREATE UNIQUE INDEX "identity_link_user_provider_uq" ON "identity_links" USING btree ("tenant_id","user_id","provider_id");
--> statement-breakpoint
CREATE INDEX "identity_mail_pending_idx" ON "identity_mail_outbox" USING btree ("status","next_attempt_at");
--> statement-breakpoint
CREATE INDEX "workforce_payroll_rules_tenant_idx" ON "workforce_payroll_rules" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "workforce_payroll_rules_code_uq" ON "workforce_payroll_rules" USING btree ("tenant_id","company_id","code");
--> statement-breakpoint
CREATE INDEX "workforce_payroll_condition_tenant_idx" ON "workforce_payroll_condition" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "workforce_payroll_condition_employee_id_idx" ON "workforce_payroll_condition" USING btree ("tenant_id","company_id","employee_id");
--> statement-breakpoint
CREATE INDEX "workforce_payroll_condition_employee_id_valid_from_valid_to_idx" ON "workforce_payroll_condition" USING btree ("tenant_id","company_id","employee_id","valid_from","valid_to");
--> statement-breakpoint
CREATE INDEX "workforce_payroll_tax_evidence_tenant_idx" ON "workforce_payroll_tax_evidence" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "workforce_payroll_tax_evidence_employee_id_idx" ON "workforce_payroll_tax_evidence" USING btree ("tenant_id","company_id","employee_id");
--> statement-breakpoint
CREATE INDEX "workforce_payroll_tax_evidence_site_id_idx" ON "workforce_payroll_tax_evidence" USING btree ("tenant_id","company_id","site_id");
--> statement-breakpoint
CREATE INDEX "workforce_payroll_tax_evidence_payroll_id_idx" ON "workforce_payroll_tax_evidence" USING btree ("tenant_id","company_id","payroll_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "workforce_payroll_tax_evidence_payroll_id_uq" ON "workforce_payroll_tax_evidence" USING btree ("tenant_id","company_id","payroll_id");
--> statement-breakpoint
CREATE INDEX "workforce_payroll_tax_evidence_employee_id_payment_date_idx" ON "workforce_payroll_tax_evidence" USING btree ("tenant_id","company_id","employee_id","payment_date");
--> statement-breakpoint
CREATE INDEX "workforce_year_end_declaration_tenant_idx" ON "workforce_year_end_declaration" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "workforce_year_end_declaration_employee_id_idx" ON "workforce_year_end_declaration" USING btree ("tenant_id","company_id","employee_id");
--> statement-breakpoint
CREATE INDEX "workforce_year_end_declaration_site_id_idx" ON "workforce_year_end_declaration" USING btree ("tenant_id","company_id","site_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "workforce_year_end_declaration_employee_id_tax_year_uq" ON "workforce_year_end_declaration" USING btree ("tenant_id","company_id","employee_id","tax_year");
--> statement-breakpoint
CREATE INDEX "workforce_year_end_adjustment_tenant_idx" ON "workforce_year_end_adjustment" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "workforce_year_end_adjustment_employee_id_idx" ON "workforce_year_end_adjustment" USING btree ("tenant_id","company_id","employee_id");
--> statement-breakpoint
CREATE INDEX "workforce_year_end_adjustment_site_id_idx" ON "workforce_year_end_adjustment" USING btree ("tenant_id","company_id","site_id");
--> statement-breakpoint
CREATE INDEX "workforce_year_end_adjustment_declaration_id_idx" ON "workforce_year_end_adjustment" USING btree ("tenant_id","company_id","declaration_id");
--> statement-breakpoint
CREATE INDEX "workforce_year_end_adjustment_employee_id_tax_year_idx" ON "workforce_year_end_adjustment" USING btree ("tenant_id","company_id","employee_id","tax_year");
--> statement-breakpoint
CREATE UNIQUE INDEX "workforce_year_end_adjustment_number_uq" ON "workforce_year_end_adjustment" USING btree ("tenant_id","company_id","number");
--> statement-breakpoint
CREATE INDEX "workforce_work_system_period_tenant_idx" ON "workforce_work_system_period" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "workforce_work_system_period_employee_id_idx" ON "workforce_work_system_period" USING btree ("tenant_id","company_id","employee_id");
--> statement-breakpoint
CREATE INDEX "workforce_work_system_period_site_id_idx" ON "workforce_work_system_period" USING btree ("tenant_id","company_id","site_id");
--> statement-breakpoint
CREATE INDEX "workforce_work_system_period_employee_id_starts_on_ends_on_status_idx" ON "workforce_work_system_period" USING btree ("tenant_id","company_id","employee_id","starts_on","ends_on","status");
--> statement-breakpoint
CREATE INDEX "pos_integration_location_tenant_idx" ON "pos_integration_location" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "pos_integration_location_code_uq" ON "pos_integration_location" USING btree ("tenant_id","company_id","code");
--> statement-breakpoint
CREATE UNIQUE INDEX "pos_integration_location_mapping_key_uq" ON "pos_integration_location" USING btree ("tenant_id","company_id","mapping_key");
--> statement-breakpoint
CREATE INDEX "pos_integration_location_settlement_account_id_idx" ON "pos_integration_location" USING btree ("tenant_id","company_id","settlement_account_id");
--> statement-breakpoint
CREATE INDEX "pos_integration_location_suspense_account_id_idx" ON "pos_integration_location" USING btree ("tenant_id","company_id","suspense_account_id");
--> statement-breakpoint
CREATE INDEX "pos_integration_inbox_tenant_idx" ON "pos_integration_inbox" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "pos_integration_inbox_location_id_idx" ON "pos_integration_inbox" USING btree ("tenant_id","company_id","location_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "pos_integration_inbox_event_id_uq" ON "pos_integration_inbox" USING btree ("tenant_id","company_id","event_id");
--> statement-breakpoint
CREATE INDEX "pos_integration_inbox_transaction_id_idx" ON "pos_integration_inbox" USING btree ("tenant_id","company_id","transaction_id");
--> statement-breakpoint
CREATE INDEX "pos_integration_inbox_status_payment_id_idx" ON "pos_integration_inbox" USING btree ("tenant_id","company_id","status","payment_id");
--> statement-breakpoint
CREATE INDEX "pos_integration_transaction_tenant_idx" ON "pos_integration_transaction" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "pos_integration_transaction_location_id_idx" ON "pos_integration_transaction" USING btree ("tenant_id","company_id","location_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "pos_integration_transaction_key_uq" ON "pos_integration_transaction" USING btree ("tenant_id","company_id","key");
--> statement-breakpoint
CREATE INDEX "pos_integration_transaction_payment_id_idx" ON "pos_integration_transaction" USING btree ("tenant_id","company_id","payment_id");
--> statement-breakpoint
CREATE INDEX "pos_integration_transaction_settlement_account_id_idx" ON "pos_integration_transaction" USING btree ("tenant_id","company_id","settlement_account_id");
--> statement-breakpoint
CREATE INDEX "pos_integration_transaction_suspense_account_id_idx" ON "pos_integration_transaction" USING btree ("tenant_id","company_id","suspense_account_id");
--> statement-breakpoint
CREATE INDEX "pos_integration_transaction_journal_entry_id_idx" ON "pos_integration_transaction" USING btree ("tenant_id","company_id","journal_entry_id");
--> statement-breakpoint
CREATE INDEX "pos_integration_transaction_location_id_date_idx" ON "pos_integration_transaction" USING btree ("tenant_id","company_id","location_id","date");
--> statement-breakpoint
CREATE INDEX "group_accounting_run_tenant_idx" ON "group_accounting_run" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "franchise_agreement_tenant_idx" ON "franchise_agreement" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "franchise_agreement_code_uq" ON "franchise_agreement" USING btree ("tenant_id","company_id","code");
--> statement-breakpoint
CREATE INDEX "franchise_agreement_partner_id_idx" ON "franchise_agreement" USING btree ("tenant_id","company_id","partner_id");
--> statement-breakpoint
CREATE INDEX "franchise_agreement_expense_account_id_idx" ON "franchise_agreement" USING btree ("tenant_id","company_id","expense_account_id");
--> statement-breakpoint
CREATE INDEX "franchise_settlement_tenant_idx" ON "franchise_settlement" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "franchise_settlement_agreement_id_idx" ON "franchise_settlement" USING btree ("tenant_id","company_id","agreement_id");
--> statement-breakpoint
CREATE INDEX "franchise_settlement_sales_invoice_id_idx" ON "franchise_settlement" USING btree ("tenant_id","company_id","sales_invoice_id");
--> statement-breakpoint
CREATE INDEX "franchise_settlement_purchase_invoice_id_idx" ON "franchise_settlement" USING btree ("tenant_id","company_id","purchase_invoice_id");
--> statement-breakpoint
CREATE INDEX "franchise_settlement_payment_id_idx" ON "franchise_settlement" USING btree ("tenant_id","company_id","payment_id");
--> statement-breakpoint
CREATE INDEX "franchise_settlement_agreement_id_month_idx" ON "franchise_settlement" USING btree ("tenant_id","company_id","agreement_id","month");
--> statement-breakpoint
CREATE POLICY "identity_challenges_tenant_isolation" ON "identity_challenges" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "identity_factors_tenant_isolation" ON "identity_factors" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "identity_links_tenant_isolation" ON "identity_links" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "identity_mail_outbox_tenant_isolation" ON "identity_mail_outbox" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "workforce_payroll_rules_tenant_isolation" ON "workforce_payroll_rules" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "workforce_payroll_condition_tenant_isolation" ON "workforce_payroll_condition" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "workforce_payroll_tax_evidence_tenant_isolation" ON "workforce_payroll_tax_evidence" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "workforce_year_end_declaration_tenant_isolation" ON "workforce_year_end_declaration" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "workforce_year_end_adjustment_tenant_isolation" ON "workforce_year_end_adjustment" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "workforce_work_system_period_tenant_isolation" ON "workforce_work_system_period" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "pos_integration_location_tenant_isolation" ON "pos_integration_location" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "pos_integration_inbox_tenant_isolation" ON "pos_integration_inbox" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "pos_integration_transaction_tenant_isolation" ON "pos_integration_transaction" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "group_accounting_run_tenant_isolation" ON "group_accounting_run" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "franchise_agreement_tenant_isolation" ON "franchise_agreement" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "franchise_settlement_tenant_isolation" ON "franchise_settlement" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
