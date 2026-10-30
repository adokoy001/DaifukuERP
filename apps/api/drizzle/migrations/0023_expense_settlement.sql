CREATE TABLE "expense_settlement" (
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
	"employee_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"date" date NOT NULL,
	"partner_id" uuid,
	"advance_id" uuid,
	"method" text DEFAULT 'bank_transfer' NOT NULL,
	"payment_account_id" uuid,
	"subtotal" numeric(20, 6) DEFAULT '0' NOT NULL,
	"tax_total" numeric(20, 6) DEFAULT '0' NOT NULL,
	"deductible_tax" numeric(20, 6) DEFAULT '0' NOT NULL,
	"non_deductible_tax" numeric(20, 6) DEFAULT '0' NOT NULL,
	"total" numeric(20, 6) DEFAULT '0' NOT NULL,
	"advance_amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"pay_amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"refund_amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"tax_summary" jsonb,
	"journal_entry_id" uuid,
	"payment_id" uuid,
	"note" text,
	CONSTRAINT "expense_settlement_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "expense_settlement_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "expense_settlement_kind_chk" CHECK (kind IN ('reimbursement', 'corporate_card', 'advance')),
	CONSTRAINT "expense_settlement_method_chk" CHECK (method IN ('cash', 'bank_transfer', 'other')),
	CONSTRAINT "expense_settlement_docstatus_chk" CHECK (docstatus IN (0, 1, 2))
);

--> statement-breakpoint
ALTER TABLE "expense_settlement" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "expense_settlement_line" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"ext" jsonb,
	"settlement_id" uuid NOT NULL,
	"seq" integer DEFAULT 1 NOT NULL,
	"expense_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"expense_date" date,
	"description" text,
	"payee_name" text,
	"account_id" uuid NOT NULL,
	"tax_category" text DEFAULT 'standard' NOT NULL,
	"amount" numeric(20, 6) NOT NULL,
	"invoice_kind" text,
	"books_only_reason" text,
	"invoice_registration_no" text,
	"tax_rate" numeric(20, 6),
	"taxable_amount" numeric(20, 6),
	"tax_amount" numeric(20, 6),
	"deductible_tax" numeric(20, 6),
	"non_deductible_tax" numeric(20, 6),
	"credit_ratio" numeric(20, 6),
	CONSTRAINT "expense_settlement_line_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "expense_settlement_line_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "expense_settlement_line_tax_category_chk" CHECK (tax_category IN ('standard', 'reduced', 'exempt', 'non_taxable', 'out_of_scope')),
	CONSTRAINT "expense_settlement_line_invoice_kind_chk" CHECK (invoice_kind IN ('qualified', 'not_qualified', 'books_only', 'small_amount', 'none')),
	CONSTRAINT "expense_settlement_line_books_only_reason_chk" CHECK (books_only_reason IN ('public_transport', 'business_travel', 'vending_machine', 'collected_ticket'))
);

--> statement-breakpoint
ALTER TABLE "expense_settlement_line" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "expense_advance" (
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
	"employee_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"date" date NOT NULL,
	"amount" numeric(20, 6) NOT NULL,
	"purpose" text NOT NULL,
	"method" text DEFAULT 'bank_transfer' NOT NULL,
	"payment_account_id" uuid,
	"status" text,
	"payment_id" uuid,
	"note" text,
	CONSTRAINT "expense_advance_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "expense_advance_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "expense_advance_method_chk" CHECK (method IN ('cash', 'bank_transfer', 'other')),
	CONSTRAINT "expense_advance_status_chk" CHECK (status IN ('open', 'settled', 'cancelled')),
	CONSTRAINT "expense_advance_docstatus_chk" CHECK (docstatus IN (0, 1, 2))
);

--> statement-breakpoint
ALTER TABLE "expense_advance" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "counter_account_id" uuid;
--> statement-breakpoint
ALTER TABLE "workforce_expense" ADD COLUMN "payment_method" text DEFAULT 'personal' NOT NULL;
--> statement-breakpoint
ALTER TABLE "expense_settlement" ADD CONSTRAINT "expense_settlement_employee_id_workforce_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."workforce_employee"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expense_settlement" ADD CONSTRAINT "expense_settlement_site_id_workforce_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."workforce_site"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expense_settlement" ADD CONSTRAINT "expense_settlement_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expense_settlement" ADD CONSTRAINT "expense_settlement_advance_id_expense_advance_id_fk" FOREIGN KEY ("advance_id") REFERENCES "public"."expense_advance"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expense_settlement" ADD CONSTRAINT "expense_settlement_payment_account_id_account_id_fk" FOREIGN KEY ("payment_account_id") REFERENCES "public"."account"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expense_settlement" ADD CONSTRAINT "expense_settlement_journal_entry_id_journal_entry_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entry"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expense_settlement" ADD CONSTRAINT "expense_settlement_payment_id_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expense_settlement" ADD CONSTRAINT "expense_settlement_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expense_settlement" ADD CONSTRAINT "expense_settlement_employee_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","employee_id") REFERENCES "public"."workforce_employee"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expense_settlement" ADD CONSTRAINT "expense_settlement_site_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","site_id") REFERENCES "public"."workforce_site"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expense_settlement" ADD CONSTRAINT "expense_settlement_partner_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","partner_id") REFERENCES "public"."partner"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expense_settlement" ADD CONSTRAINT "expense_settlement_advance_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","advance_id") REFERENCES "public"."expense_advance"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expense_settlement" ADD CONSTRAINT "expense_settlement_payment_account_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","payment_account_id") REFERENCES "public"."account"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expense_settlement" ADD CONSTRAINT "expense_settlement_journal_entry_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","journal_entry_id") REFERENCES "public"."journal_entry"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expense_settlement" ADD CONSTRAINT "expense_settlement_payment_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","payment_id") REFERENCES "public"."payment"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expense_settlement_line" ADD CONSTRAINT "expense_settlement_line_settlement_id_expense_settlement_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."expense_settlement"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expense_settlement_line" ADD CONSTRAINT "expense_settlement_line_expense_id_workforce_expense_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."workforce_expense"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expense_settlement_line" ADD CONSTRAINT "expense_settlement_line_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expense_settlement_line" ADD CONSTRAINT "expense_settlement_line_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expense_settlement_line" ADD CONSTRAINT "expense_settlement_line_settlement_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","settlement_id") REFERENCES "public"."expense_settlement"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expense_settlement_line" ADD CONSTRAINT "expense_settlement_line_expense_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","expense_id") REFERENCES "public"."workforce_expense"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expense_settlement_line" ADD CONSTRAINT "expense_settlement_line_account_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","account_id") REFERENCES "public"."account"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expense_advance" ADD CONSTRAINT "expense_advance_employee_id_workforce_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."workforce_employee"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expense_advance" ADD CONSTRAINT "expense_advance_site_id_workforce_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."workforce_site"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expense_advance" ADD CONSTRAINT "expense_advance_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expense_advance" ADD CONSTRAINT "expense_advance_payment_account_id_account_id_fk" FOREIGN KEY ("payment_account_id") REFERENCES "public"."account"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expense_advance" ADD CONSTRAINT "expense_advance_payment_id_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expense_advance" ADD CONSTRAINT "expense_advance_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expense_advance" ADD CONSTRAINT "expense_advance_employee_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","employee_id") REFERENCES "public"."workforce_employee"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expense_advance" ADD CONSTRAINT "expense_advance_site_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","site_id") REFERENCES "public"."workforce_site"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expense_advance" ADD CONSTRAINT "expense_advance_partner_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","partner_id") REFERENCES "public"."partner"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expense_advance" ADD CONSTRAINT "expense_advance_payment_account_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","payment_account_id") REFERENCES "public"."account"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expense_advance" ADD CONSTRAINT "expense_advance_payment_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","payment_id") REFERENCES "public"."payment"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "expense_settlement_tenant_idx" ON "expense_settlement" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "expense_settlement_employee_id_idx" ON "expense_settlement" USING btree ("tenant_id","company_id","employee_id");
--> statement-breakpoint
CREATE INDEX "expense_settlement_site_id_idx" ON "expense_settlement" USING btree ("tenant_id","company_id","site_id");
--> statement-breakpoint
CREATE INDEX "expense_settlement_date_idx" ON "expense_settlement" USING btree ("tenant_id","company_id","date");
--> statement-breakpoint
CREATE INDEX "expense_settlement_partner_id_idx" ON "expense_settlement" USING btree ("tenant_id","company_id","partner_id");
--> statement-breakpoint
CREATE INDEX "expense_settlement_advance_id_idx" ON "expense_settlement" USING btree ("tenant_id","company_id","advance_id");
--> statement-breakpoint
CREATE INDEX "expense_settlement_payment_account_id_idx" ON "expense_settlement" USING btree ("tenant_id","company_id","payment_account_id");
--> statement-breakpoint
CREATE INDEX "expense_settlement_journal_entry_id_idx" ON "expense_settlement" USING btree ("tenant_id","company_id","journal_entry_id");
--> statement-breakpoint
CREATE INDEX "expense_settlement_payment_id_idx" ON "expense_settlement" USING btree ("tenant_id","company_id","payment_id");
--> statement-breakpoint
CREATE INDEX "expense_settlement_employee_id_date_idx" ON "expense_settlement" USING btree ("tenant_id","company_id","employee_id","date");
--> statement-breakpoint
CREATE UNIQUE INDEX "expense_settlement_number_uq" ON "expense_settlement" USING btree ("tenant_id","company_id","number");
--> statement-breakpoint
CREATE INDEX "expense_settlement_line_tenant_idx" ON "expense_settlement_line" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "expense_settlement_line_settlement_id_idx" ON "expense_settlement_line" USING btree ("tenant_id","company_id","settlement_id");
--> statement-breakpoint
CREATE INDEX "expense_settlement_line_expense_id_idx" ON "expense_settlement_line" USING btree ("tenant_id","company_id","expense_id");
--> statement-breakpoint
CREATE INDEX "expense_settlement_line_account_id_idx" ON "expense_settlement_line" USING btree ("tenant_id","company_id","account_id");
--> statement-breakpoint
CREATE INDEX "expense_settlement_line_settlement_id_seq_idx" ON "expense_settlement_line" USING btree ("tenant_id","company_id","settlement_id","seq");
--> statement-breakpoint
CREATE INDEX "expense_advance_tenant_idx" ON "expense_advance" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "expense_advance_employee_id_idx" ON "expense_advance" USING btree ("tenant_id","company_id","employee_id");
--> statement-breakpoint
CREATE INDEX "expense_advance_site_id_idx" ON "expense_advance" USING btree ("tenant_id","company_id","site_id");
--> statement-breakpoint
CREATE INDEX "expense_advance_partner_id_idx" ON "expense_advance" USING btree ("tenant_id","company_id","partner_id");
--> statement-breakpoint
CREATE INDEX "expense_advance_date_idx" ON "expense_advance" USING btree ("tenant_id","company_id","date");
--> statement-breakpoint
CREATE INDEX "expense_advance_payment_account_id_idx" ON "expense_advance" USING btree ("tenant_id","company_id","payment_account_id");
--> statement-breakpoint
CREATE INDEX "expense_advance_payment_id_idx" ON "expense_advance" USING btree ("tenant_id","company_id","payment_id");
--> statement-breakpoint
CREATE INDEX "expense_advance_employee_id_date_idx" ON "expense_advance" USING btree ("tenant_id","company_id","employee_id","date");
--> statement-breakpoint
CREATE UNIQUE INDEX "expense_advance_number_uq" ON "expense_advance" USING btree ("tenant_id","company_id","number");
--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_counter_account_id_account_id_fk" FOREIGN KEY ("counter_account_id") REFERENCES "public"."account"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_counter_account_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","counter_account_id") REFERENCES "public"."account"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "payment_counter_account_id_idx" ON "payment" USING btree ("tenant_id","company_id","counter_account_id");
--> statement-breakpoint
ALTER TABLE "workforce_expense" ADD CONSTRAINT "workforce_expense_payment_method_chk" CHECK (payment_method IN ('personal', 'corporate_card', 'advance'));
--> statement-breakpoint
CREATE POLICY "expense_settlement_tenant_isolation" ON "expense_settlement" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "expense_settlement_line_tenant_isolation" ON "expense_settlement_line" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "expense_advance_tenant_isolation" ON "expense_advance" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
