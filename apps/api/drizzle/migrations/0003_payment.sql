CREATE TABLE "payment" (
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
	"date" date DEFAULT CURRENT_DATE NOT NULL,
	"amount" numeric(20, 6) NOT NULL,
	"method" text DEFAULT 'bank_transfer' NOT NULL,
	"account_id" uuid NOT NULL,
	"allocated_amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"unallocated_amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"note" text,
	"journal_entry_id" uuid,
	CONSTRAINT "payment_direction_chk" CHECK (direction IN ('receive', 'pay')),
	CONSTRAINT "payment_method_chk" CHECK (method IN ('cash', 'bank_transfer', 'other')),
	CONSTRAINT "payment_docstatus_chk" CHECK (docstatus IN (0, 1, 2))
);

--> statement-breakpoint
ALTER TABLE "payment" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "payment_allocation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"ext" jsonb,
	"payment_id" uuid NOT NULL,
	"seq" integer DEFAULT 1 NOT NULL,
	"invoice_entity" text NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount" numeric(20, 6) NOT NULL,
	CONSTRAINT "payment_allocation_invoice_entity_chk" CHECK (invoice_entity IN ('sales_invoice', 'purchase_invoice'))
);

--> statement-breakpoint
ALTER TABLE "payment_allocation" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_journal_entry_id_journal_entry_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entry"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_payment_id_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "payment_tenant_idx" ON "payment" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "payment_direction_idx" ON "payment" USING btree ("tenant_id","company_id","direction");
--> statement-breakpoint
CREATE INDEX "payment_partner_id_idx" ON "payment" USING btree ("tenant_id","company_id","partner_id");
--> statement-breakpoint
CREATE INDEX "payment_date_idx" ON "payment" USING btree ("tenant_id","company_id","date");
--> statement-breakpoint
CREATE INDEX "payment_account_id_idx" ON "payment" USING btree ("tenant_id","company_id","account_id");
--> statement-breakpoint
CREATE INDEX "payment_journal_entry_id_idx" ON "payment" USING btree ("tenant_id","company_id","journal_entry_id");
--> statement-breakpoint
CREATE INDEX "payment_partner_id_date_idx" ON "payment" USING btree ("tenant_id","company_id","partner_id","date");
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_number_uq" ON "payment" USING btree ("tenant_id","company_id","number");
--> statement-breakpoint
CREATE INDEX "payment_allocation_tenant_idx" ON "payment_allocation" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "payment_allocation_payment_id_idx" ON "payment_allocation" USING btree ("tenant_id","company_id","payment_id");
--> statement-breakpoint
CREATE INDEX "payment_allocation_invoice_id_idx" ON "payment_allocation" USING btree ("tenant_id","company_id","invoice_id");
--> statement-breakpoint
CREATE INDEX "payment_allocation_payment_id_seq_idx" ON "payment_allocation" USING btree ("tenant_id","company_id","payment_id","seq");
--> statement-breakpoint
CREATE POLICY "payment_tenant_isolation" ON "payment" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "payment_allocation_tenant_isolation" ON "payment_allocation" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
