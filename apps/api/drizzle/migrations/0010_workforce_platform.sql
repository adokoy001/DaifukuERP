CREATE TABLE "workforce_site" (
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
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "workforce_site_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "workforce_site_tenant_id_uq" UNIQUE("tenant_id","id")
);

--> statement-breakpoint
ALTER TABLE "workforce_site" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "workforce_employee" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"hired_on" date NOT NULL,
	"terminated_on" date,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "workforce_employee_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "workforce_employee_tenant_id_uq" UNIQUE("tenant_id","id")
);

--> statement-breakpoint
ALTER TABLE "workforce_employee" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "workforce_attendance" (
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
	"work_date" date NOT NULL,
	"status" text DEFAULT 'working' NOT NULL,
	"clock_in" timestamp with time zone NOT NULL,
	"clock_out" timestamp with time zone,
	"break_started_at" timestamp with time zone,
	"breaks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"worked_ms" integer DEFAULT 0 NOT NULL,
	"night_ms" integer DEFAULT 0 NOT NULL,
	"day_kind" text DEFAULT 'workday' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_reason" text,
	CONSTRAINT "workforce_attendance_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "workforce_attendance_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "workforce_attendance_status_chk" CHECK (status IN ('working', 'break', 'closed', 'submitted', 'approved', 'returned')),
	CONSTRAINT "workforce_attendance_day_kind_chk" CHECK (day_kind IN ('workday', 'statutory_holiday'))
);

--> statement-breakpoint
ALTER TABLE "workforce_attendance" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "workforce_punch" (
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
	"idempotency_key" uuid NOT NULL,
	"request_snapshot" jsonb NOT NULL,
	"attendance_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "workforce_punch_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "workforce_punch_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "workforce_punch_kind_chk" CHECK (kind IN ('clock_in', 'break_start', 'break_end', 'clock_out'))
);

--> statement-breakpoint
ALTER TABLE "workforce_punch" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "workforce_attendance_correction" (
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
	"idempotency_key" uuid NOT NULL,
	"request_snapshot" jsonb NOT NULL,
	"attendance_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"source_version" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"clock_in" timestamp with time zone NOT NULL,
	"clock_out" timestamp with time zone NOT NULL,
	"breaks" jsonb NOT NULL,
	"reason" text NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_reason" text,
	CONSTRAINT "workforce_attendance_correction_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "workforce_attendance_correction_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "workforce_attendance_correction_status_chk" CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled'))
);

--> statement-breakpoint
ALTER TABLE "workforce_attendance_correction" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "workforce_leave_grant" (
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
	"valid_from" date NOT NULL,
	"expires_on" date NOT NULL,
	"days" numeric(20, 6) NOT NULL,
	"eligibility_confirmed" boolean NOT NULL,
	"basis" text NOT NULL,
	"granted_by" uuid NOT NULL,
	CONSTRAINT "workforce_leave_grant_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "workforce_leave_grant_tenant_id_uq" UNIQUE("tenant_id","id")
);

--> statement-breakpoint
ALTER TABLE "workforce_leave_grant" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "workforce_leave_request" (
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
	"idempotency_key" uuid NOT NULL,
	"request_snapshot" jsonb NOT NULL,
	"leave_date" date NOT NULL,
	"portion" text NOT NULL,
	"days" numeric(20, 6) NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_reason" text,
	CONSTRAINT "workforce_leave_request_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "workforce_leave_request_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "workforce_leave_request_portion_chk" CHECK (portion IN ('full', 'morning', 'afternoon')),
	CONSTRAINT "workforce_leave_request_status_chk" CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled'))
);

--> statement-breakpoint
ALTER TABLE "workforce_leave_request" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "workforce_leave_usage" (
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
	"request_id" uuid NOT NULL,
	"grant_id" uuid NOT NULL,
	"days" numeric(20, 6) NOT NULL,
	"kind" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "workforce_leave_usage_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "workforce_leave_usage_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "workforce_leave_usage_kind_chk" CHECK (kind IN ('consume', 'release'))
);

--> statement-breakpoint
ALTER TABLE "workforce_leave_usage" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "workforce_expense" (
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
	"idempotency_key" uuid NOT NULL,
	"request_snapshot" jsonb NOT NULL,
	"expense_date" date NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(20, 6) NOT NULL,
	"evidence" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_reason" text,
	"paid_on" date,
	"payment_reference" text,
	"settled_by" uuid,
	CONSTRAINT "workforce_expense_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "workforce_expense_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "workforce_expense_status_chk" CHECK (status IN ('draft', 'submitted', 'approved', 'returned', 'settled', 'cancelled'))
);

--> statement-breakpoint
ALTER TABLE "workforce_expense" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "workforce_pay_policy" (
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
	"valid_from" date NOT NULL,
	"valid_to" date NOT NULL,
	"work_system" text DEFAULT 'ordinary' NOT NULL,
	"week_starts_on" integer NOT NULL,
	"daily_limit_minutes" integer NOT NULL,
	"weekly_limit_minutes" integer NOT NULL,
	"break_after_minutes" integer NOT NULL,
	"break_minutes" integer NOT NULL,
	"long_break_after_minutes" integer NOT NULL,
	"long_break_minutes" integer NOT NULL,
	"night_starts_minute" integer NOT NULL,
	"night_ends_minute" integer NOT NULL,
	"monthly_overtime_threshold_minutes" integer NOT NULL,
	"overtime_premium_rate" numeric(20, 6) NOT NULL,
	"high_overtime_premium_rate" numeric(20, 6) NOT NULL,
	"holiday_premium_rate" numeric(20, 6) NOT NULL,
	"night_premium_rate" numeric(20, 6) NOT NULL,
	"basis" text NOT NULL,
	CONSTRAINT "workforce_pay_policy_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "workforce_pay_policy_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "workforce_pay_policy_work_system_chk" CHECK (work_system IN ('ordinary'))
);

--> statement-breakpoint
ALTER TABLE "workforce_pay_policy" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "workforce_pay_terms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date NOT NULL,
	"pay_type" text NOT NULL,
	"hourly_rate" numeric(20, 6) NOT NULL,
	"monthly_salary" numeric(20, 6) NOT NULL,
	"monthly_base_minutes" integer NOT NULL,
	"paid_leave_day_minutes" integer NOT NULL,
	"confirmed" boolean NOT NULL,
	"basis" text NOT NULL,
	CONSTRAINT "workforce_pay_terms_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "workforce_pay_terms_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "workforce_pay_terms_pay_type_chk" CHECK (pay_type IN ('hourly', 'monthly'))
);

--> statement-breakpoint
ALTER TABLE "workforce_pay_terms" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "workforce_payroll" (
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
	"period" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"terms_id" uuid NOT NULL,
	"base_pay" numeric(20, 6) NOT NULL,
	"premium_pay" numeric(20, 6) NOT NULL,
	"gross_pay" numeric(20, 6) NOT NULL,
	"deduction_total" numeric(20, 6) DEFAULT '0' NOT NULL,
	"net_pay" numeric(20, 6) DEFAULT '0' NOT NULL,
	"worked_ms" integer NOT NULL,
	"paid_leave_days" numeric(20, 6) NOT NULL,
	"allowances" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"deductions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"calculation" jsonb NOT NULL,
	"source_fingerprint" text NOT NULL,
	"attendance_complete_confirmed" boolean NOT NULL,
	"calculation_confirmed" boolean DEFAULT false NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_reason" text,
	CONSTRAINT "workforce_payroll_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "workforce_payroll_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "workforce_payroll_docstatus_chk" CHECK (docstatus IN (0, 1, 2))
);

--> statement-breakpoint
ALTER TABLE "workforce_payroll" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "workforce_period_lock" (
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
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "workforce_period_lock_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "workforce_period_lock_tenant_id_uq" UNIQUE("tenant_id","id")
);

--> statement-breakpoint
ALTER TABLE "workforce_period_lock" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "workforce_receipt" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"expense_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	CONSTRAINT "workforce_receipt_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "workforce_receipt_tenant_id_uq" UNIQUE("tenant_id","id")
);

--> statement-breakpoint
ALTER TABLE "workforce_receipt" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "wholesale_job" (
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
	"reference" text,
	"title" text NOT NULL,
	"partner_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"date" date DEFAULT CURRENT_DATE NOT NULL,
	"planned_date" date,
	"ordered_quantity" numeric(20, 6) DEFAULT '1' NOT NULL,
	"completed_quantity" numeric(20, 6) DEFAULT '0' NOT NULL,
	"unit_price" numeric(20, 6) NOT NULL,
	"tax_category" text NOT NULL,
	"quoted_amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"completed_amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"unit_code" text DEFAULT 'IO-PCS' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_date" date,
	"completion_note" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"sales_invoice_id" uuid,
	"cancelled_date" date,
	"purchase_order" text,
	"delivery_address" text,
	"lot_reference" text,
	"delivery_proof" text,
	CONSTRAINT "wholesale_job_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "wholesale_job_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "wholesale_job_tax_category_chk" CHECK (tax_category IN ('standard', 'reduced', 'exempt', 'non_taxable', 'out_of_scope')),
	CONSTRAINT "wholesale_job_status_chk" CHECK (status IN ('queued', 'in_progress', 'completed', 'cancelled')),
	CONSTRAINT "wholesale_job_docstatus_chk" CHECK (docstatus IN (0, 1, 2))
);

--> statement-breakpoint
ALTER TABLE "wholesale_job" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "manufacturing_job" (
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
	"reference" text,
	"title" text NOT NULL,
	"partner_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"date" date DEFAULT CURRENT_DATE NOT NULL,
	"planned_date" date,
	"ordered_quantity" numeric(20, 6) DEFAULT '1' NOT NULL,
	"completed_quantity" numeric(20, 6) DEFAULT '0' NOT NULL,
	"unit_price" numeric(20, 6) NOT NULL,
	"tax_category" text NOT NULL,
	"quoted_amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"completed_amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"unit_code" text DEFAULT 'IO-PCS' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_date" date,
	"completion_note" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"sales_invoice_id" uuid,
	"cancelled_date" date,
	"batch_reference" text,
	"drawing_revision" text,
	"rejected_quantity" numeric(20, 6) DEFAULT '0' NOT NULL,
	"inspection_reference" text,
	CONSTRAINT "manufacturing_job_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "manufacturing_job_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "manufacturing_job_tax_category_chk" CHECK (tax_category IN ('standard', 'reduced', 'exempt', 'non_taxable', 'out_of_scope')),
	CONSTRAINT "manufacturing_job_status_chk" CHECK (status IN ('queued', 'in_progress', 'completed', 'cancelled')),
	CONSTRAINT "manufacturing_job_docstatus_chk" CHECK (docstatus IN (0, 1, 2))
);

--> statement-breakpoint
ALTER TABLE "manufacturing_job" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "construction_job" (
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
	"reference" text,
	"title" text NOT NULL,
	"partner_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"date" date DEFAULT CURRENT_DATE NOT NULL,
	"planned_date" date,
	"ordered_quantity" numeric(20, 6) DEFAULT '1' NOT NULL,
	"completed_quantity" numeric(20, 6) DEFAULT '0' NOT NULL,
	"unit_price" numeric(20, 6) NOT NULL,
	"tax_category" text NOT NULL,
	"quoted_amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"completed_amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"unit_code" text DEFAULT 'IO-JOB' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_date" date,
	"completion_note" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"sales_invoice_id" uuid,
	"cancelled_date" date,
	"site" text,
	"work_package" text,
	"contract_reference" text,
	"completion_percent" integer DEFAULT 0 NOT NULL,
	"inspection_reference" text,
	CONSTRAINT "construction_job_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "construction_job_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "construction_job_tax_category_chk" CHECK (tax_category IN ('standard', 'reduced', 'exempt', 'non_taxable', 'out_of_scope')),
	CONSTRAINT "construction_job_status_chk" CHECK (status IN ('queued', 'in_progress', 'completed', 'cancelled')),
	CONSTRAINT "construction_job_docstatus_chk" CHECK (docstatus IN (0, 1, 2))
);

--> statement-breakpoint
ALTER TABLE "construction_job" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "logistics_job" (
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
	"reference" text,
	"title" text NOT NULL,
	"partner_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"date" date DEFAULT CURRENT_DATE NOT NULL,
	"planned_date" date,
	"ordered_quantity" numeric(20, 6) DEFAULT '1' NOT NULL,
	"completed_quantity" numeric(20, 6) DEFAULT '0' NOT NULL,
	"unit_price" numeric(20, 6) NOT NULL,
	"tax_category" text NOT NULL,
	"quoted_amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"completed_amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"unit_code" text DEFAULT 'IO-JOB' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_date" date,
	"completion_note" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"sales_invoice_id" uuid,
	"cancelled_date" date,
	"origin" text,
	"destination" text,
	"cargo" text,
	"weight_kg" numeric(20, 6) NOT NULL,
	"package_count" integer DEFAULT 1 NOT NULL,
	"delivered_packages" integer DEFAULT 0 NOT NULL,
	"delivery_proof" text,
	CONSTRAINT "logistics_job_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "logistics_job_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "logistics_job_tax_category_chk" CHECK (tax_category IN ('standard', 'reduced', 'exempt', 'non_taxable', 'out_of_scope')),
	CONSTRAINT "logistics_job_status_chk" CHECK (status IN ('queued', 'in_progress', 'completed', 'cancelled')),
	CONSTRAINT "logistics_job_docstatus_chk" CHECK (docstatus IN (0, 1, 2))
);

--> statement-breakpoint
ALTER TABLE "logistics_job" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "hospitality_job" (
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
	"reference" text,
	"title" text NOT NULL,
	"partner_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"date" date DEFAULT CURRENT_DATE NOT NULL,
	"planned_date" date,
	"ordered_quantity" numeric(20, 6) DEFAULT '1' NOT NULL,
	"completed_quantity" numeric(20, 6) DEFAULT '0' NOT NULL,
	"unit_price" numeric(20, 6) NOT NULL,
	"tax_category" text NOT NULL,
	"quoted_amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"completed_amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"unit_code" text DEFAULT 'IO-NIGHT' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_date" date,
	"completion_note" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"sales_invoice_id" uuid,
	"cancelled_date" date,
	"arrival_date" date NOT NULL,
	"departure_date" date NOT NULL,
	"room_reference" text,
	"guest_count" integer DEFAULT 1 NOT NULL,
	"checkout_confirmation" text,
	CONSTRAINT "hospitality_job_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "hospitality_job_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "hospitality_job_tax_category_chk" CHECK (tax_category IN ('standard', 'reduced', 'exempt', 'non_taxable', 'out_of_scope')),
	CONSTRAINT "hospitality_job_status_chk" CHECK (status IN ('queued', 'in_progress', 'completed', 'cancelled')),
	CONSTRAINT "hospitality_job_docstatus_chk" CHECK (docstatus IN (0, 1, 2))
);

--> statement-breakpoint
ALTER TABLE "hospitality_job" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "clinic_job" (
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
	"reference" text,
	"title" text NOT NULL,
	"partner_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"date" date DEFAULT CURRENT_DATE NOT NULL,
	"planned_date" date,
	"ordered_quantity" numeric(20, 6) DEFAULT '1' NOT NULL,
	"completed_quantity" numeric(20, 6) DEFAULT '0' NOT NULL,
	"unit_price" numeric(20, 6) NOT NULL,
	"tax_category" text NOT NULL,
	"quoted_amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"completed_amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"unit_code" text DEFAULT 'IO-PAX' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_date" date,
	"completion_note" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"sales_invoice_id" uuid,
	"cancelled_date" date,
	"corporate_contract" text,
	"venue" text,
	"administration_confirmation" text,
	CONSTRAINT "clinic_job_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "clinic_job_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "clinic_job_tax_category_chk" CHECK (tax_category IN ('standard', 'reduced', 'exempt', 'non_taxable', 'out_of_scope')),
	CONSTRAINT "clinic_job_status_chk" CHECK (status IN ('queued', 'in_progress', 'completed', 'cancelled')),
	CONSTRAINT "clinic_job_docstatus_chk" CHECK (docstatus IN (0, 1, 2))
);

--> statement-breakpoint
ALTER TABLE "clinic_job" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "care_service_job" (
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
	"reference" text,
	"title" text NOT NULL,
	"partner_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"date" date DEFAULT CURRENT_DATE NOT NULL,
	"planned_date" date,
	"ordered_quantity" numeric(20, 6) DEFAULT '1' NOT NULL,
	"completed_quantity" numeric(20, 6) DEFAULT '0' NOT NULL,
	"unit_price" numeric(20, 6) NOT NULL,
	"tax_category" text NOT NULL,
	"quoted_amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"completed_amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"unit_code" text DEFAULT 'IO-HR' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_date" date,
	"completion_note" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"sales_invoice_id" uuid,
	"cancelled_date" date,
	"support_type" text NOT NULL,
	"consent_reference" text,
	"service_location" text,
	"completion_signer" text,
	CONSTRAINT "care_service_job_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "care_service_job_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "care_service_job_tax_category_chk" CHECK (tax_category IN ('standard', 'reduced', 'exempt', 'non_taxable', 'out_of_scope')),
	CONSTRAINT "care_service_job_status_chk" CHECK (status IN ('queued', 'in_progress', 'completed', 'cancelled')),
	CONSTRAINT "care_service_job_support_type_chk" CHECK (support_type IN ('housework', 'shopping', 'companionship')),
	CONSTRAINT "care_service_job_docstatus_chk" CHECK (docstatus IN (0, 1, 2))
);

--> statement-breakpoint
ALTER TABLE "care_service_job" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "education_job" (
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
	"reference" text,
	"title" text NOT NULL,
	"partner_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"date" date DEFAULT CURRENT_DATE NOT NULL,
	"planned_date" date,
	"ordered_quantity" numeric(20, 6) DEFAULT '1' NOT NULL,
	"completed_quantity" numeric(20, 6) DEFAULT '0' NOT NULL,
	"unit_price" numeric(20, 6) NOT NULL,
	"tax_category" text NOT NULL,
	"quoted_amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"completed_amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"unit_code" text DEFAULT 'IO-PAX' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_date" date,
	"completion_note" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"sales_invoice_id" uuid,
	"cancelled_date" date,
	"course" text,
	"venue" text,
	"capacity" integer DEFAULT 1 NOT NULL,
	"attendance_confirmation" text,
	CONSTRAINT "education_job_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "education_job_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "education_job_tax_category_chk" CHECK (tax_category IN ('standard', 'reduced', 'exempt', 'non_taxable', 'out_of_scope')),
	CONSTRAINT "education_job_status_chk" CHECK (status IN ('queued', 'in_progress', 'completed', 'cancelled')),
	CONSTRAINT "education_job_docstatus_chk" CHECK (docstatus IN (0, 1, 2))
);

--> statement-breakpoint
ALTER TABLE "education_job" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "professional_service_job" (
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
	"reference" text,
	"title" text NOT NULL,
	"partner_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"date" date DEFAULT CURRENT_DATE NOT NULL,
	"planned_date" date,
	"ordered_quantity" numeric(20, 6) DEFAULT '1' NOT NULL,
	"completed_quantity" numeric(20, 6) DEFAULT '0' NOT NULL,
	"unit_price" numeric(20, 6) NOT NULL,
	"tax_category" text NOT NULL,
	"quoted_amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"completed_amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"unit_code" text DEFAULT 'IO-HR' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_date" date,
	"completion_note" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"sales_invoice_id" uuid,
	"cancelled_date" date,
	"project_code" text,
	"deliverable" text,
	"acceptance_reference" text,
	CONSTRAINT "professional_service_job_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "professional_service_job_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "professional_service_job_tax_category_chk" CHECK (tax_category IN ('standard', 'reduced', 'exempt', 'non_taxable', 'out_of_scope')),
	CONSTRAINT "professional_service_job_status_chk" CHECK (status IN ('queued', 'in_progress', 'completed', 'cancelled')),
	CONSTRAINT "professional_service_job_docstatus_chk" CHECK (docstatus IN (0, 1, 2))
);

--> statement-breakpoint
ALTER TABLE "professional_service_job" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "beauty_salon_job" (
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
	"reference" text,
	"title" text NOT NULL,
	"partner_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"date" date DEFAULT CURRENT_DATE NOT NULL,
	"planned_date" date,
	"ordered_quantity" numeric(20, 6) DEFAULT '1' NOT NULL,
	"completed_quantity" numeric(20, 6) DEFAULT '0' NOT NULL,
	"unit_price" numeric(20, 6) NOT NULL,
	"tax_category" text NOT NULL,
	"quoted_amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"completed_amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"unit_code" text DEFAULT 'IO-JOB' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_date" date,
	"completion_note" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"sales_invoice_id" uuid,
	"cancelled_date" date,
	"menu" text,
	"stylist" text,
	"service_confirmation" text,
	CONSTRAINT "beauty_salon_job_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "beauty_salon_job_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "beauty_salon_job_tax_category_chk" CHECK (tax_category IN ('standard', 'reduced', 'exempt', 'non_taxable', 'out_of_scope')),
	CONSTRAINT "beauty_salon_job_status_chk" CHECK (status IN ('queued', 'in_progress', 'completed', 'cancelled')),
	CONSTRAINT "beauty_salon_job_docstatus_chk" CHECK (docstatus IN (0, 1, 2))
);

--> statement-breakpoint
ALTER TABLE "beauty_salon_job" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "user_company_memberships" ADD COLUMN "site_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "workforce_site" ADD CONSTRAINT "workforce_site_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_employee" ADD CONSTRAINT "workforce_employee_site_id_workforce_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."workforce_site"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_employee" ADD CONSTRAINT "workforce_employee_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_employee" ADD CONSTRAINT "workforce_employee_site_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","site_id") REFERENCES "public"."workforce_site"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_attendance" ADD CONSTRAINT "workforce_attendance_employee_id_workforce_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."workforce_employee"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_attendance" ADD CONSTRAINT "workforce_attendance_site_id_workforce_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."workforce_site"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_attendance" ADD CONSTRAINT "workforce_attendance_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_attendance" ADD CONSTRAINT "workforce_attendance_employee_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","employee_id") REFERENCES "public"."workforce_employee"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_attendance" ADD CONSTRAINT "workforce_attendance_site_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","site_id") REFERENCES "public"."workforce_site"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_punch" ADD CONSTRAINT "workforce_punch_employee_id_workforce_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."workforce_employee"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_punch" ADD CONSTRAINT "workforce_punch_site_id_workforce_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."workforce_site"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_punch" ADD CONSTRAINT "workforce_punch_attendance_id_workforce_attendance_id_fk" FOREIGN KEY ("attendance_id") REFERENCES "public"."workforce_attendance"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_punch" ADD CONSTRAINT "workforce_punch_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_punch" ADD CONSTRAINT "workforce_punch_employee_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","employee_id") REFERENCES "public"."workforce_employee"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_punch" ADD CONSTRAINT "workforce_punch_site_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","site_id") REFERENCES "public"."workforce_site"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_punch" ADD CONSTRAINT "workforce_punch_attendance_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","attendance_id") REFERENCES "public"."workforce_attendance"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_attendance_correction" ADD CONSTRAINT "workforce_attendance_correction_employee_id_workforce_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."workforce_employee"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_attendance_correction" ADD CONSTRAINT "workforce_attendance_correction_site_id_workforce_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."workforce_site"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_attendance_correction" ADD CONSTRAINT "workforce_attendance_correction_attendance_id_workforce_attendance_id_fk" FOREIGN KEY ("attendance_id") REFERENCES "public"."workforce_attendance"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_attendance_correction" ADD CONSTRAINT "workforce_attendance_correction_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_attendance_correction" ADD CONSTRAINT "workforce_attendance_correction_employee_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","employee_id") REFERENCES "public"."workforce_employee"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_attendance_correction" ADD CONSTRAINT "workforce_attendance_correction_site_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","site_id") REFERENCES "public"."workforce_site"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_attendance_correction" ADD CONSTRAINT "workforce_attendance_correction_attendance_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","attendance_id") REFERENCES "public"."workforce_attendance"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_leave_grant" ADD CONSTRAINT "workforce_leave_grant_employee_id_workforce_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."workforce_employee"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_leave_grant" ADD CONSTRAINT "workforce_leave_grant_site_id_workforce_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."workforce_site"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_leave_grant" ADD CONSTRAINT "workforce_leave_grant_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_leave_grant" ADD CONSTRAINT "workforce_leave_grant_employee_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","employee_id") REFERENCES "public"."workforce_employee"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_leave_grant" ADD CONSTRAINT "workforce_leave_grant_site_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","site_id") REFERENCES "public"."workforce_site"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_leave_request" ADD CONSTRAINT "workforce_leave_request_employee_id_workforce_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."workforce_employee"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_leave_request" ADD CONSTRAINT "workforce_leave_request_site_id_workforce_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."workforce_site"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_leave_request" ADD CONSTRAINT "workforce_leave_request_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_leave_request" ADD CONSTRAINT "workforce_leave_request_employee_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","employee_id") REFERENCES "public"."workforce_employee"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_leave_request" ADD CONSTRAINT "workforce_leave_request_site_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","site_id") REFERENCES "public"."workforce_site"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_leave_usage" ADD CONSTRAINT "workforce_leave_usage_employee_id_workforce_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."workforce_employee"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_leave_usage" ADD CONSTRAINT "workforce_leave_usage_site_id_workforce_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."workforce_site"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_leave_usage" ADD CONSTRAINT "workforce_leave_usage_request_id_workforce_leave_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."workforce_leave_request"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_leave_usage" ADD CONSTRAINT "workforce_leave_usage_grant_id_workforce_leave_grant_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."workforce_leave_grant"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_leave_usage" ADD CONSTRAINT "workforce_leave_usage_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_leave_usage" ADD CONSTRAINT "workforce_leave_usage_employee_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","employee_id") REFERENCES "public"."workforce_employee"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_leave_usage" ADD CONSTRAINT "workforce_leave_usage_site_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","site_id") REFERENCES "public"."workforce_site"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_leave_usage" ADD CONSTRAINT "workforce_leave_usage_request_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","request_id") REFERENCES "public"."workforce_leave_request"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_leave_usage" ADD CONSTRAINT "workforce_leave_usage_grant_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","grant_id") REFERENCES "public"."workforce_leave_grant"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_expense" ADD CONSTRAINT "workforce_expense_employee_id_workforce_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."workforce_employee"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_expense" ADD CONSTRAINT "workforce_expense_site_id_workforce_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."workforce_site"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_expense" ADD CONSTRAINT "workforce_expense_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_expense" ADD CONSTRAINT "workforce_expense_employee_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","employee_id") REFERENCES "public"."workforce_employee"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_expense" ADD CONSTRAINT "workforce_expense_site_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","site_id") REFERENCES "public"."workforce_site"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_pay_policy" ADD CONSTRAINT "workforce_pay_policy_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_pay_terms" ADD CONSTRAINT "workforce_pay_terms_employee_id_workforce_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."workforce_employee"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_pay_terms" ADD CONSTRAINT "workforce_pay_terms_policy_id_workforce_pay_policy_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."workforce_pay_policy"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_pay_terms" ADD CONSTRAINT "workforce_pay_terms_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_pay_terms" ADD CONSTRAINT "workforce_pay_terms_employee_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","employee_id") REFERENCES "public"."workforce_employee"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_pay_terms" ADD CONSTRAINT "workforce_pay_terms_policy_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","policy_id") REFERENCES "public"."workforce_pay_policy"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_payroll" ADD CONSTRAINT "workforce_payroll_employee_id_workforce_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."workforce_employee"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_payroll" ADD CONSTRAINT "workforce_payroll_site_id_workforce_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."workforce_site"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_payroll" ADD CONSTRAINT "workforce_payroll_terms_id_workforce_pay_terms_id_fk" FOREIGN KEY ("terms_id") REFERENCES "public"."workforce_pay_terms"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_payroll" ADD CONSTRAINT "workforce_payroll_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_payroll" ADD CONSTRAINT "workforce_payroll_employee_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","employee_id") REFERENCES "public"."workforce_employee"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_payroll" ADD CONSTRAINT "workforce_payroll_site_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","site_id") REFERENCES "public"."workforce_site"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_payroll" ADD CONSTRAINT "workforce_payroll_terms_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","terms_id") REFERENCES "public"."workforce_pay_terms"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_period_lock" ADD CONSTRAINT "workforce_period_lock_employee_id_workforce_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."workforce_employee"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_period_lock" ADD CONSTRAINT "workforce_period_lock_site_id_workforce_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."workforce_site"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_period_lock" ADD CONSTRAINT "workforce_period_lock_payroll_id_workforce_payroll_id_fk" FOREIGN KEY ("payroll_id") REFERENCES "public"."workforce_payroll"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_period_lock" ADD CONSTRAINT "workforce_period_lock_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_period_lock" ADD CONSTRAINT "workforce_period_lock_employee_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","employee_id") REFERENCES "public"."workforce_employee"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_period_lock" ADD CONSTRAINT "workforce_period_lock_site_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","site_id") REFERENCES "public"."workforce_site"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_period_lock" ADD CONSTRAINT "workforce_period_lock_payroll_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","payroll_id") REFERENCES "public"."workforce_payroll"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_receipt" ADD CONSTRAINT "workforce_receipt_expense_id_workforce_expense_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."workforce_expense"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_receipt" ADD CONSTRAINT "workforce_receipt_employee_id_workforce_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."workforce_employee"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_receipt" ADD CONSTRAINT "workforce_receipt_site_id_workforce_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."workforce_site"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_receipt" ADD CONSTRAINT "workforce_receipt_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_receipt" ADD CONSTRAINT "workforce_receipt_expense_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","expense_id") REFERENCES "public"."workforce_expense"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_receipt" ADD CONSTRAINT "workforce_receipt_employee_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","employee_id") REFERENCES "public"."workforce_employee"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_receipt" ADD CONSTRAINT "workforce_receipt_site_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","site_id") REFERENCES "public"."workforce_site"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wholesale_job" ADD CONSTRAINT "wholesale_job_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wholesale_job" ADD CONSTRAINT "wholesale_job_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wholesale_job" ADD CONSTRAINT "wholesale_job_sales_invoice_id_sales_invoice_id_fk" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoice"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wholesale_job" ADD CONSTRAINT "wholesale_job_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wholesale_job" ADD CONSTRAINT "wholesale_job_partner_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","partner_id") REFERENCES "public"."partner"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wholesale_job" ADD CONSTRAINT "wholesale_job_product_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","product_id") REFERENCES "public"."product"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wholesale_job" ADD CONSTRAINT "wholesale_job_sales_invoice_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","sales_invoice_id") REFERENCES "public"."sales_invoice"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "manufacturing_job" ADD CONSTRAINT "manufacturing_job_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "manufacturing_job" ADD CONSTRAINT "manufacturing_job_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "manufacturing_job" ADD CONSTRAINT "manufacturing_job_sales_invoice_id_sales_invoice_id_fk" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoice"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "manufacturing_job" ADD CONSTRAINT "manufacturing_job_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "manufacturing_job" ADD CONSTRAINT "manufacturing_job_partner_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","partner_id") REFERENCES "public"."partner"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "manufacturing_job" ADD CONSTRAINT "manufacturing_job_product_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","product_id") REFERENCES "public"."product"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "manufacturing_job" ADD CONSTRAINT "manufacturing_job_sales_invoice_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","sales_invoice_id") REFERENCES "public"."sales_invoice"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "construction_job" ADD CONSTRAINT "construction_job_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "construction_job" ADD CONSTRAINT "construction_job_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "construction_job" ADD CONSTRAINT "construction_job_sales_invoice_id_sales_invoice_id_fk" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoice"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "construction_job" ADD CONSTRAINT "construction_job_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "construction_job" ADD CONSTRAINT "construction_job_partner_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","partner_id") REFERENCES "public"."partner"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "construction_job" ADD CONSTRAINT "construction_job_product_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","product_id") REFERENCES "public"."product"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "construction_job" ADD CONSTRAINT "construction_job_sales_invoice_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","sales_invoice_id") REFERENCES "public"."sales_invoice"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "logistics_job" ADD CONSTRAINT "logistics_job_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "logistics_job" ADD CONSTRAINT "logistics_job_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "logistics_job" ADD CONSTRAINT "logistics_job_sales_invoice_id_sales_invoice_id_fk" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoice"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "logistics_job" ADD CONSTRAINT "logistics_job_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "logistics_job" ADD CONSTRAINT "logistics_job_partner_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","partner_id") REFERENCES "public"."partner"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "logistics_job" ADD CONSTRAINT "logistics_job_product_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","product_id") REFERENCES "public"."product"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "logistics_job" ADD CONSTRAINT "logistics_job_sales_invoice_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","sales_invoice_id") REFERENCES "public"."sales_invoice"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "hospitality_job" ADD CONSTRAINT "hospitality_job_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "hospitality_job" ADD CONSTRAINT "hospitality_job_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "hospitality_job" ADD CONSTRAINT "hospitality_job_sales_invoice_id_sales_invoice_id_fk" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoice"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "hospitality_job" ADD CONSTRAINT "hospitality_job_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "hospitality_job" ADD CONSTRAINT "hospitality_job_partner_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","partner_id") REFERENCES "public"."partner"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "hospitality_job" ADD CONSTRAINT "hospitality_job_product_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","product_id") REFERENCES "public"."product"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "hospitality_job" ADD CONSTRAINT "hospitality_job_sales_invoice_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","sales_invoice_id") REFERENCES "public"."sales_invoice"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "clinic_job" ADD CONSTRAINT "clinic_job_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "clinic_job" ADD CONSTRAINT "clinic_job_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "clinic_job" ADD CONSTRAINT "clinic_job_sales_invoice_id_sales_invoice_id_fk" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoice"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "clinic_job" ADD CONSTRAINT "clinic_job_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "clinic_job" ADD CONSTRAINT "clinic_job_partner_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","partner_id") REFERENCES "public"."partner"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "clinic_job" ADD CONSTRAINT "clinic_job_product_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","product_id") REFERENCES "public"."product"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "clinic_job" ADD CONSTRAINT "clinic_job_sales_invoice_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","sales_invoice_id") REFERENCES "public"."sales_invoice"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "care_service_job" ADD CONSTRAINT "care_service_job_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "care_service_job" ADD CONSTRAINT "care_service_job_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "care_service_job" ADD CONSTRAINT "care_service_job_sales_invoice_id_sales_invoice_id_fk" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoice"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "care_service_job" ADD CONSTRAINT "care_service_job_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "care_service_job" ADD CONSTRAINT "care_service_job_partner_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","partner_id") REFERENCES "public"."partner"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "care_service_job" ADD CONSTRAINT "care_service_job_product_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","product_id") REFERENCES "public"."product"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "care_service_job" ADD CONSTRAINT "care_service_job_sales_invoice_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","sales_invoice_id") REFERENCES "public"."sales_invoice"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "education_job" ADD CONSTRAINT "education_job_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "education_job" ADD CONSTRAINT "education_job_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "education_job" ADD CONSTRAINT "education_job_sales_invoice_id_sales_invoice_id_fk" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoice"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "education_job" ADD CONSTRAINT "education_job_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "education_job" ADD CONSTRAINT "education_job_partner_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","partner_id") REFERENCES "public"."partner"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "education_job" ADD CONSTRAINT "education_job_product_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","product_id") REFERENCES "public"."product"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "education_job" ADD CONSTRAINT "education_job_sales_invoice_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","sales_invoice_id") REFERENCES "public"."sales_invoice"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "professional_service_job" ADD CONSTRAINT "professional_service_job_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "professional_service_job" ADD CONSTRAINT "professional_service_job_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "professional_service_job" ADD CONSTRAINT "professional_service_job_sales_invoice_id_sales_invoice_id_fk" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoice"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "professional_service_job" ADD CONSTRAINT "professional_service_job_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "professional_service_job" ADD CONSTRAINT "professional_service_job_partner_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","partner_id") REFERENCES "public"."partner"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "professional_service_job" ADD CONSTRAINT "professional_service_job_product_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","product_id") REFERENCES "public"."product"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "professional_service_job" ADD CONSTRAINT "professional_service_job_sales_invoice_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","sales_invoice_id") REFERENCES "public"."sales_invoice"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "beauty_salon_job" ADD CONSTRAINT "beauty_salon_job_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "beauty_salon_job" ADD CONSTRAINT "beauty_salon_job_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "beauty_salon_job" ADD CONSTRAINT "beauty_salon_job_sales_invoice_id_sales_invoice_id_fk" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoice"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "beauty_salon_job" ADD CONSTRAINT "beauty_salon_job_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "beauty_salon_job" ADD CONSTRAINT "beauty_salon_job_partner_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","partner_id") REFERENCES "public"."partner"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "beauty_salon_job" ADD CONSTRAINT "beauty_salon_job_product_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","product_id") REFERENCES "public"."product"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "beauty_salon_job" ADD CONSTRAINT "beauty_salon_job_sales_invoice_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","sales_invoice_id") REFERENCES "public"."sales_invoice"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "workforce_site_tenant_idx" ON "workforce_site" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "workforce_site_code_uq" ON "workforce_site" USING btree ("tenant_id","company_id","code");
--> statement-breakpoint
CREATE INDEX "workforce_employee_tenant_idx" ON "workforce_employee" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "workforce_employee_user_id_uq" ON "workforce_employee" USING btree ("tenant_id","company_id","user_id");
--> statement-breakpoint
CREATE INDEX "workforce_employee_site_id_idx" ON "workforce_employee" USING btree ("tenant_id","company_id","site_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "workforce_employee_code_uq" ON "workforce_employee" USING btree ("tenant_id","company_id","code");
--> statement-breakpoint
CREATE INDEX "workforce_attendance_tenant_idx" ON "workforce_attendance" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "workforce_attendance_employee_id_idx" ON "workforce_attendance" USING btree ("tenant_id","company_id","employee_id");
--> statement-breakpoint
CREATE INDEX "workforce_attendance_site_id_idx" ON "workforce_attendance" USING btree ("tenant_id","company_id","site_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "workforce_attendance_employee_id_work_date_uq" ON "workforce_attendance" USING btree ("tenant_id","company_id","employee_id","work_date");
--> statement-breakpoint
CREATE INDEX "workforce_attendance_site_id_work_date_status_idx" ON "workforce_attendance" USING btree ("tenant_id","company_id","site_id","work_date","status");
--> statement-breakpoint
CREATE INDEX "workforce_punch_tenant_idx" ON "workforce_punch" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "workforce_punch_employee_id_idx" ON "workforce_punch" USING btree ("tenant_id","company_id","employee_id");
--> statement-breakpoint
CREATE INDEX "workforce_punch_site_id_idx" ON "workforce_punch" USING btree ("tenant_id","company_id","site_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "workforce_punch_idempotency_key_uq" ON "workforce_punch" USING btree ("tenant_id","company_id","idempotency_key");
--> statement-breakpoint
CREATE INDEX "workforce_punch_attendance_id_idx" ON "workforce_punch" USING btree ("tenant_id","company_id","attendance_id");
--> statement-breakpoint
CREATE INDEX "workforce_attendance_correction_tenant_idx" ON "workforce_attendance_correction" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "workforce_attendance_correction_employee_id_idx" ON "workforce_attendance_correction" USING btree ("tenant_id","company_id","employee_id");
--> statement-breakpoint
CREATE INDEX "workforce_attendance_correction_site_id_idx" ON "workforce_attendance_correction" USING btree ("tenant_id","company_id","site_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "workforce_attendance_correction_idempotency_key_uq" ON "workforce_attendance_correction" USING btree ("tenant_id","company_id","idempotency_key");
--> statement-breakpoint
CREATE INDEX "workforce_attendance_correction_attendance_id_idx" ON "workforce_attendance_correction" USING btree ("tenant_id","company_id","attendance_id");
--> statement-breakpoint
CREATE INDEX "workforce_attendance_correction_attendance_id_status_idx" ON "workforce_attendance_correction" USING btree ("tenant_id","company_id","attendance_id","status");
--> statement-breakpoint
CREATE INDEX "workforce_leave_grant_tenant_idx" ON "workforce_leave_grant" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "workforce_leave_grant_employee_id_idx" ON "workforce_leave_grant" USING btree ("tenant_id","company_id","employee_id");
--> statement-breakpoint
CREATE INDEX "workforce_leave_grant_site_id_idx" ON "workforce_leave_grant" USING btree ("tenant_id","company_id","site_id");
--> statement-breakpoint
CREATE INDEX "workforce_leave_grant_employee_id_valid_from_expires_on_idx" ON "workforce_leave_grant" USING btree ("tenant_id","company_id","employee_id","valid_from","expires_on");
--> statement-breakpoint
CREATE INDEX "workforce_leave_request_tenant_idx" ON "workforce_leave_request" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "workforce_leave_request_employee_id_idx" ON "workforce_leave_request" USING btree ("tenant_id","company_id","employee_id");
--> statement-breakpoint
CREATE INDEX "workforce_leave_request_site_id_idx" ON "workforce_leave_request" USING btree ("tenant_id","company_id","site_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "workforce_leave_request_idempotency_key_uq" ON "workforce_leave_request" USING btree ("tenant_id","company_id","idempotency_key");
--> statement-breakpoint
CREATE INDEX "workforce_leave_request_employee_id_leave_date_status_idx" ON "workforce_leave_request" USING btree ("tenant_id","company_id","employee_id","leave_date","status");
--> statement-breakpoint
CREATE INDEX "workforce_leave_usage_tenant_idx" ON "workforce_leave_usage" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "workforce_leave_usage_employee_id_idx" ON "workforce_leave_usage" USING btree ("tenant_id","company_id","employee_id");
--> statement-breakpoint
CREATE INDEX "workforce_leave_usage_site_id_idx" ON "workforce_leave_usage" USING btree ("tenant_id","company_id","site_id");
--> statement-breakpoint
CREATE INDEX "workforce_leave_usage_request_id_idx" ON "workforce_leave_usage" USING btree ("tenant_id","company_id","request_id");
--> statement-breakpoint
CREATE INDEX "workforce_leave_usage_grant_id_idx" ON "workforce_leave_usage" USING btree ("tenant_id","company_id","grant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "workforce_leave_usage_request_id_grant_id_kind_uq" ON "workforce_leave_usage" USING btree ("tenant_id","company_id","request_id","grant_id","kind");
--> statement-breakpoint
CREATE INDEX "workforce_expense_tenant_idx" ON "workforce_expense" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "workforce_expense_employee_id_idx" ON "workforce_expense" USING btree ("tenant_id","company_id","employee_id");
--> statement-breakpoint
CREATE INDEX "workforce_expense_site_id_idx" ON "workforce_expense" USING btree ("tenant_id","company_id","site_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "workforce_expense_idempotency_key_uq" ON "workforce_expense" USING btree ("tenant_id","company_id","idempotency_key");
--> statement-breakpoint
CREATE INDEX "workforce_expense_site_id_status_expense_date_idx" ON "workforce_expense" USING btree ("tenant_id","company_id","site_id","status","expense_date");
--> statement-breakpoint
CREATE INDEX "workforce_pay_policy_tenant_idx" ON "workforce_pay_policy" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "workforce_pay_policy_code_uq" ON "workforce_pay_policy" USING btree ("tenant_id","company_id","code");
--> statement-breakpoint
CREATE INDEX "workforce_pay_terms_tenant_idx" ON "workforce_pay_terms" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "workforce_pay_terms_employee_id_idx" ON "workforce_pay_terms" USING btree ("tenant_id","company_id","employee_id");
--> statement-breakpoint
CREATE INDEX "workforce_pay_terms_policy_id_idx" ON "workforce_pay_terms" USING btree ("tenant_id","company_id","policy_id");
--> statement-breakpoint
CREATE INDEX "workforce_pay_terms_employee_id_valid_from_valid_to_idx" ON "workforce_pay_terms" USING btree ("tenant_id","company_id","employee_id","valid_from","valid_to");
--> statement-breakpoint
CREATE INDEX "workforce_payroll_tenant_idx" ON "workforce_payroll" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "workforce_payroll_employee_id_idx" ON "workforce_payroll" USING btree ("tenant_id","company_id","employee_id");
--> statement-breakpoint
CREATE INDEX "workforce_payroll_site_id_idx" ON "workforce_payroll" USING btree ("tenant_id","company_id","site_id");
--> statement-breakpoint
CREATE INDEX "workforce_payroll_terms_id_idx" ON "workforce_payroll" USING btree ("tenant_id","company_id","terms_id");
--> statement-breakpoint
CREATE INDEX "workforce_payroll_employee_id_period_idx" ON "workforce_payroll" USING btree ("tenant_id","company_id","employee_id","period");
--> statement-breakpoint
CREATE UNIQUE INDEX "workforce_payroll_number_uq" ON "workforce_payroll" USING btree ("tenant_id","company_id","number");
--> statement-breakpoint
CREATE INDEX "workforce_period_lock_tenant_idx" ON "workforce_period_lock" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "workforce_period_lock_employee_id_idx" ON "workforce_period_lock" USING btree ("tenant_id","company_id","employee_id");
--> statement-breakpoint
CREATE INDEX "workforce_period_lock_site_id_idx" ON "workforce_period_lock" USING btree ("tenant_id","company_id","site_id");
--> statement-breakpoint
CREATE INDEX "workforce_period_lock_payroll_id_idx" ON "workforce_period_lock" USING btree ("tenant_id","company_id","payroll_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "workforce_period_lock_payroll_id_uq" ON "workforce_period_lock" USING btree ("tenant_id","company_id","payroll_id");
--> statement-breakpoint
CREATE INDEX "workforce_period_lock_employee_id_active_period_start_idx" ON "workforce_period_lock" USING btree ("tenant_id","company_id","employee_id","active","period_start");
--> statement-breakpoint
CREATE INDEX "workforce_receipt_tenant_idx" ON "workforce_receipt" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "workforce_receipt_expense_id_idx" ON "workforce_receipt" USING btree ("tenant_id","company_id","expense_id");
--> statement-breakpoint
CREATE INDEX "workforce_receipt_employee_id_idx" ON "workforce_receipt" USING btree ("tenant_id","company_id","employee_id");
--> statement-breakpoint
CREATE INDEX "workforce_receipt_site_id_idx" ON "workforce_receipt" USING btree ("tenant_id","company_id","site_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "workforce_receipt_expense_id_sha256_uq" ON "workforce_receipt" USING btree ("tenant_id","company_id","expense_id","sha256");
--> statement-breakpoint
CREATE INDEX "wholesale_job_tenant_idx" ON "wholesale_job" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "wholesale_job_reference_uq" ON "wholesale_job" USING btree ("tenant_id","company_id","reference");
--> statement-breakpoint
CREATE INDEX "wholesale_job_partner_id_idx" ON "wholesale_job" USING btree ("tenant_id","company_id","partner_id");
--> statement-breakpoint
CREATE INDEX "wholesale_job_product_id_idx" ON "wholesale_job" USING btree ("tenant_id","company_id","product_id");
--> statement-breakpoint
CREATE INDEX "wholesale_job_date_idx" ON "wholesale_job" USING btree ("tenant_id","company_id","date");
--> statement-breakpoint
CREATE INDEX "wholesale_job_planned_date_idx" ON "wholesale_job" USING btree ("tenant_id","company_id","planned_date");
--> statement-breakpoint
CREATE INDEX "wholesale_job_completed_date_idx" ON "wholesale_job" USING btree ("tenant_id","company_id","completed_date");
--> statement-breakpoint
CREATE INDEX "wholesale_job_status_idx" ON "wholesale_job" USING btree ("tenant_id","company_id","status");
--> statement-breakpoint
CREATE INDEX "wholesale_job_sales_invoice_id_idx" ON "wholesale_job" USING btree ("tenant_id","company_id","sales_invoice_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "wholesale_job_number_uq" ON "wholesale_job" USING btree ("tenant_id","company_id","number");
--> statement-breakpoint
CREATE INDEX "manufacturing_job_tenant_idx" ON "manufacturing_job" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "manufacturing_job_reference_uq" ON "manufacturing_job" USING btree ("tenant_id","company_id","reference");
--> statement-breakpoint
CREATE INDEX "manufacturing_job_partner_id_idx" ON "manufacturing_job" USING btree ("tenant_id","company_id","partner_id");
--> statement-breakpoint
CREATE INDEX "manufacturing_job_product_id_idx" ON "manufacturing_job" USING btree ("tenant_id","company_id","product_id");
--> statement-breakpoint
CREATE INDEX "manufacturing_job_date_idx" ON "manufacturing_job" USING btree ("tenant_id","company_id","date");
--> statement-breakpoint
CREATE INDEX "manufacturing_job_planned_date_idx" ON "manufacturing_job" USING btree ("tenant_id","company_id","planned_date");
--> statement-breakpoint
CREATE INDEX "manufacturing_job_completed_date_idx" ON "manufacturing_job" USING btree ("tenant_id","company_id","completed_date");
--> statement-breakpoint
CREATE INDEX "manufacturing_job_status_idx" ON "manufacturing_job" USING btree ("tenant_id","company_id","status");
--> statement-breakpoint
CREATE INDEX "manufacturing_job_sales_invoice_id_idx" ON "manufacturing_job" USING btree ("tenant_id","company_id","sales_invoice_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "manufacturing_job_number_uq" ON "manufacturing_job" USING btree ("tenant_id","company_id","number");
--> statement-breakpoint
CREATE INDEX "construction_job_tenant_idx" ON "construction_job" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "construction_job_reference_uq" ON "construction_job" USING btree ("tenant_id","company_id","reference");
--> statement-breakpoint
CREATE INDEX "construction_job_partner_id_idx" ON "construction_job" USING btree ("tenant_id","company_id","partner_id");
--> statement-breakpoint
CREATE INDEX "construction_job_product_id_idx" ON "construction_job" USING btree ("tenant_id","company_id","product_id");
--> statement-breakpoint
CREATE INDEX "construction_job_date_idx" ON "construction_job" USING btree ("tenant_id","company_id","date");
--> statement-breakpoint
CREATE INDEX "construction_job_planned_date_idx" ON "construction_job" USING btree ("tenant_id","company_id","planned_date");
--> statement-breakpoint
CREATE INDEX "construction_job_completed_date_idx" ON "construction_job" USING btree ("tenant_id","company_id","completed_date");
--> statement-breakpoint
CREATE INDEX "construction_job_status_idx" ON "construction_job" USING btree ("tenant_id","company_id","status");
--> statement-breakpoint
CREATE INDEX "construction_job_sales_invoice_id_idx" ON "construction_job" USING btree ("tenant_id","company_id","sales_invoice_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "construction_job_number_uq" ON "construction_job" USING btree ("tenant_id","company_id","number");
--> statement-breakpoint
CREATE INDEX "logistics_job_tenant_idx" ON "logistics_job" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "logistics_job_reference_uq" ON "logistics_job" USING btree ("tenant_id","company_id","reference");
--> statement-breakpoint
CREATE INDEX "logistics_job_partner_id_idx" ON "logistics_job" USING btree ("tenant_id","company_id","partner_id");
--> statement-breakpoint
CREATE INDEX "logistics_job_product_id_idx" ON "logistics_job" USING btree ("tenant_id","company_id","product_id");
--> statement-breakpoint
CREATE INDEX "logistics_job_date_idx" ON "logistics_job" USING btree ("tenant_id","company_id","date");
--> statement-breakpoint
CREATE INDEX "logistics_job_planned_date_idx" ON "logistics_job" USING btree ("tenant_id","company_id","planned_date");
--> statement-breakpoint
CREATE INDEX "logistics_job_completed_date_idx" ON "logistics_job" USING btree ("tenant_id","company_id","completed_date");
--> statement-breakpoint
CREATE INDEX "logistics_job_status_idx" ON "logistics_job" USING btree ("tenant_id","company_id","status");
--> statement-breakpoint
CREATE INDEX "logistics_job_sales_invoice_id_idx" ON "logistics_job" USING btree ("tenant_id","company_id","sales_invoice_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "logistics_job_number_uq" ON "logistics_job" USING btree ("tenant_id","company_id","number");
--> statement-breakpoint
CREATE INDEX "hospitality_job_tenant_idx" ON "hospitality_job" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "hospitality_job_reference_uq" ON "hospitality_job" USING btree ("tenant_id","company_id","reference");
--> statement-breakpoint
CREATE INDEX "hospitality_job_partner_id_idx" ON "hospitality_job" USING btree ("tenant_id","company_id","partner_id");
--> statement-breakpoint
CREATE INDEX "hospitality_job_product_id_idx" ON "hospitality_job" USING btree ("tenant_id","company_id","product_id");
--> statement-breakpoint
CREATE INDEX "hospitality_job_date_idx" ON "hospitality_job" USING btree ("tenant_id","company_id","date");
--> statement-breakpoint
CREATE INDEX "hospitality_job_planned_date_idx" ON "hospitality_job" USING btree ("tenant_id","company_id","planned_date");
--> statement-breakpoint
CREATE INDEX "hospitality_job_completed_date_idx" ON "hospitality_job" USING btree ("tenant_id","company_id","completed_date");
--> statement-breakpoint
CREATE INDEX "hospitality_job_status_idx" ON "hospitality_job" USING btree ("tenant_id","company_id","status");
--> statement-breakpoint
CREATE INDEX "hospitality_job_sales_invoice_id_idx" ON "hospitality_job" USING btree ("tenant_id","company_id","sales_invoice_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "hospitality_job_number_uq" ON "hospitality_job" USING btree ("tenant_id","company_id","number");
--> statement-breakpoint
CREATE INDEX "clinic_job_tenant_idx" ON "clinic_job" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "clinic_job_reference_uq" ON "clinic_job" USING btree ("tenant_id","company_id","reference");
--> statement-breakpoint
CREATE INDEX "clinic_job_partner_id_idx" ON "clinic_job" USING btree ("tenant_id","company_id","partner_id");
--> statement-breakpoint
CREATE INDEX "clinic_job_product_id_idx" ON "clinic_job" USING btree ("tenant_id","company_id","product_id");
--> statement-breakpoint
CREATE INDEX "clinic_job_date_idx" ON "clinic_job" USING btree ("tenant_id","company_id","date");
--> statement-breakpoint
CREATE INDEX "clinic_job_planned_date_idx" ON "clinic_job" USING btree ("tenant_id","company_id","planned_date");
--> statement-breakpoint
CREATE INDEX "clinic_job_completed_date_idx" ON "clinic_job" USING btree ("tenant_id","company_id","completed_date");
--> statement-breakpoint
CREATE INDEX "clinic_job_status_idx" ON "clinic_job" USING btree ("tenant_id","company_id","status");
--> statement-breakpoint
CREATE INDEX "clinic_job_sales_invoice_id_idx" ON "clinic_job" USING btree ("tenant_id","company_id","sales_invoice_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "clinic_job_number_uq" ON "clinic_job" USING btree ("tenant_id","company_id","number");
--> statement-breakpoint
CREATE INDEX "care_service_job_tenant_idx" ON "care_service_job" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "care_service_job_reference_uq" ON "care_service_job" USING btree ("tenant_id","company_id","reference");
--> statement-breakpoint
CREATE INDEX "care_service_job_partner_id_idx" ON "care_service_job" USING btree ("tenant_id","company_id","partner_id");
--> statement-breakpoint
CREATE INDEX "care_service_job_product_id_idx" ON "care_service_job" USING btree ("tenant_id","company_id","product_id");
--> statement-breakpoint
CREATE INDEX "care_service_job_date_idx" ON "care_service_job" USING btree ("tenant_id","company_id","date");
--> statement-breakpoint
CREATE INDEX "care_service_job_planned_date_idx" ON "care_service_job" USING btree ("tenant_id","company_id","planned_date");
--> statement-breakpoint
CREATE INDEX "care_service_job_completed_date_idx" ON "care_service_job" USING btree ("tenant_id","company_id","completed_date");
--> statement-breakpoint
CREATE INDEX "care_service_job_status_idx" ON "care_service_job" USING btree ("tenant_id","company_id","status");
--> statement-breakpoint
CREATE INDEX "care_service_job_sales_invoice_id_idx" ON "care_service_job" USING btree ("tenant_id","company_id","sales_invoice_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "care_service_job_number_uq" ON "care_service_job" USING btree ("tenant_id","company_id","number");
--> statement-breakpoint
CREATE INDEX "education_job_tenant_idx" ON "education_job" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "education_job_reference_uq" ON "education_job" USING btree ("tenant_id","company_id","reference");
--> statement-breakpoint
CREATE INDEX "education_job_partner_id_idx" ON "education_job" USING btree ("tenant_id","company_id","partner_id");
--> statement-breakpoint
CREATE INDEX "education_job_product_id_idx" ON "education_job" USING btree ("tenant_id","company_id","product_id");
--> statement-breakpoint
CREATE INDEX "education_job_date_idx" ON "education_job" USING btree ("tenant_id","company_id","date");
--> statement-breakpoint
CREATE INDEX "education_job_planned_date_idx" ON "education_job" USING btree ("tenant_id","company_id","planned_date");
--> statement-breakpoint
CREATE INDEX "education_job_completed_date_idx" ON "education_job" USING btree ("tenant_id","company_id","completed_date");
--> statement-breakpoint
CREATE INDEX "education_job_status_idx" ON "education_job" USING btree ("tenant_id","company_id","status");
--> statement-breakpoint
CREATE INDEX "education_job_sales_invoice_id_idx" ON "education_job" USING btree ("tenant_id","company_id","sales_invoice_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "education_job_number_uq" ON "education_job" USING btree ("tenant_id","company_id","number");
--> statement-breakpoint
CREATE INDEX "professional_service_job_tenant_idx" ON "professional_service_job" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "professional_service_job_reference_uq" ON "professional_service_job" USING btree ("tenant_id","company_id","reference");
--> statement-breakpoint
CREATE INDEX "professional_service_job_partner_id_idx" ON "professional_service_job" USING btree ("tenant_id","company_id","partner_id");
--> statement-breakpoint
CREATE INDEX "professional_service_job_product_id_idx" ON "professional_service_job" USING btree ("tenant_id","company_id","product_id");
--> statement-breakpoint
CREATE INDEX "professional_service_job_date_idx" ON "professional_service_job" USING btree ("tenant_id","company_id","date");
--> statement-breakpoint
CREATE INDEX "professional_service_job_planned_date_idx" ON "professional_service_job" USING btree ("tenant_id","company_id","planned_date");
--> statement-breakpoint
CREATE INDEX "professional_service_job_completed_date_idx" ON "professional_service_job" USING btree ("tenant_id","company_id","completed_date");
--> statement-breakpoint
CREATE INDEX "professional_service_job_status_idx" ON "professional_service_job" USING btree ("tenant_id","company_id","status");
--> statement-breakpoint
CREATE INDEX "professional_service_job_sales_invoice_id_idx" ON "professional_service_job" USING btree ("tenant_id","company_id","sales_invoice_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "professional_service_job_number_uq" ON "professional_service_job" USING btree ("tenant_id","company_id","number");
--> statement-breakpoint
CREATE INDEX "beauty_salon_job_tenant_idx" ON "beauty_salon_job" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "beauty_salon_job_reference_uq" ON "beauty_salon_job" USING btree ("tenant_id","company_id","reference");
--> statement-breakpoint
CREATE INDEX "beauty_salon_job_partner_id_idx" ON "beauty_salon_job" USING btree ("tenant_id","company_id","partner_id");
--> statement-breakpoint
CREATE INDEX "beauty_salon_job_product_id_idx" ON "beauty_salon_job" USING btree ("tenant_id","company_id","product_id");
--> statement-breakpoint
CREATE INDEX "beauty_salon_job_date_idx" ON "beauty_salon_job" USING btree ("tenant_id","company_id","date");
--> statement-breakpoint
CREATE INDEX "beauty_salon_job_planned_date_idx" ON "beauty_salon_job" USING btree ("tenant_id","company_id","planned_date");
--> statement-breakpoint
CREATE INDEX "beauty_salon_job_completed_date_idx" ON "beauty_salon_job" USING btree ("tenant_id","company_id","completed_date");
--> statement-breakpoint
CREATE INDEX "beauty_salon_job_status_idx" ON "beauty_salon_job" USING btree ("tenant_id","company_id","status");
--> statement-breakpoint
CREATE INDEX "beauty_salon_job_sales_invoice_id_idx" ON "beauty_salon_job" USING btree ("tenant_id","company_id","sales_invoice_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "beauty_salon_job_number_uq" ON "beauty_salon_job" USING btree ("tenant_id","company_id","number");
--> statement-breakpoint
CREATE POLICY "workforce_site_tenant_isolation" ON "workforce_site" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "workforce_employee_tenant_isolation" ON "workforce_employee" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "workforce_attendance_tenant_isolation" ON "workforce_attendance" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "workforce_punch_tenant_isolation" ON "workforce_punch" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "workforce_attendance_correction_tenant_isolation" ON "workforce_attendance_correction" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "workforce_leave_grant_tenant_isolation" ON "workforce_leave_grant" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "workforce_leave_request_tenant_isolation" ON "workforce_leave_request" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "workforce_leave_usage_tenant_isolation" ON "workforce_leave_usage" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "workforce_expense_tenant_isolation" ON "workforce_expense" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "workforce_pay_policy_tenant_isolation" ON "workforce_pay_policy" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "workforce_pay_terms_tenant_isolation" ON "workforce_pay_terms" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "workforce_payroll_tenant_isolation" ON "workforce_payroll" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "workforce_period_lock_tenant_isolation" ON "workforce_period_lock" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "workforce_receipt_tenant_isolation" ON "workforce_receipt" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "wholesale_job_tenant_isolation" ON "wholesale_job" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "manufacturing_job_tenant_isolation" ON "manufacturing_job" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "construction_job_tenant_isolation" ON "construction_job" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "logistics_job_tenant_isolation" ON "logistics_job" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "hospitality_job_tenant_isolation" ON "hospitality_job" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "clinic_job_tenant_isolation" ON "clinic_job" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "care_service_job_tenant_isolation" ON "care_service_job" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "education_job_tenant_isolation" ON "education_job" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "professional_service_job_tenant_isolation" ON "professional_service_job" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "beauty_salon_job_tenant_isolation" ON "beauty_salon_job" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
