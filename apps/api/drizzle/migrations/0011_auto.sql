CREATE TABLE "workforce_shift_profile" (
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
	"profile" jsonb NOT NULL,
	CONSTRAINT "workforce_shift_profile_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "workforce_shift_profile_tenant_id_uq" UNIQUE("tenant_id","id")
);

--> statement-breakpoint
ALTER TABLE "workforce_shift_profile" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "workforce_shift_availability" (
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
	"week_start" date NOT NULL,
	"days" jsonb NOT NULL,
	CONSTRAINT "workforce_shift_availability_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "workforce_shift_availability_tenant_id_uq" UNIQUE("tenant_id","id")
);

--> statement-breakpoint
ALTER TABLE "workforce_shift_availability" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "workforce_shift_plan" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"slots" jsonb NOT NULL,
	"assignments" jsonb NOT NULL,
	"source_revision" text NOT NULL,
	"seed" integer DEFAULT 1 NOT NULL,
	"acknowledge_shortage" boolean DEFAULT false NOT NULL,
	"reason" text,
	"published_at" timestamp with time zone,
	CONSTRAINT "workforce_shift_plan_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "workforce_shift_plan_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "workforce_shift_plan_status_chk" CHECK (status IN ('draft', 'published', 'superseded', 'cancelled'))
);

--> statement-breakpoint
ALTER TABLE "workforce_shift_plan" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "workforce_shift_assignment" (
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
	"plan_id" uuid NOT NULL,
	"slot_id" text NOT NULL,
	"date" date NOT NULL,
	"label" text NOT NULL,
	"start_minute" integer NOT NULL,
	"end_minute" integer NOT NULL,
	"break_minutes" integer NOT NULL,
	"skill" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "workforce_shift_assignment_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "workforce_shift_assignment_tenant_id_uq" UNIQUE("tenant_id","id")
);

--> statement-breakpoint
ALTER TABLE "workforce_shift_assignment" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workforce_shift_profile" ADD CONSTRAINT "workforce_shift_profile_employee_id_workforce_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."workforce_employee"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_shift_profile" ADD CONSTRAINT "workforce_shift_profile_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_shift_profile" ADD CONSTRAINT "workforce_shift_profile_employee_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","employee_id") REFERENCES "public"."workforce_employee"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_shift_availability" ADD CONSTRAINT "workforce_shift_availability_employee_id_workforce_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."workforce_employee"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_shift_availability" ADD CONSTRAINT "workforce_shift_availability_site_id_workforce_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."workforce_site"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_shift_availability" ADD CONSTRAINT "workforce_shift_availability_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_shift_availability" ADD CONSTRAINT "workforce_shift_availability_employee_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","employee_id") REFERENCES "public"."workforce_employee"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_shift_availability" ADD CONSTRAINT "workforce_shift_availability_site_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","site_id") REFERENCES "public"."workforce_site"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_shift_plan" ADD CONSTRAINT "workforce_shift_plan_site_id_workforce_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."workforce_site"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_shift_plan" ADD CONSTRAINT "workforce_shift_plan_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_shift_plan" ADD CONSTRAINT "workforce_shift_plan_site_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","site_id") REFERENCES "public"."workforce_site"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_shift_assignment" ADD CONSTRAINT "workforce_shift_assignment_employee_id_workforce_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."workforce_employee"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_shift_assignment" ADD CONSTRAINT "workforce_shift_assignment_site_id_workforce_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."workforce_site"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_shift_assignment" ADD CONSTRAINT "workforce_shift_assignment_plan_id_workforce_shift_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."workforce_shift_plan"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_shift_assignment" ADD CONSTRAINT "workforce_shift_assignment_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_shift_assignment" ADD CONSTRAINT "workforce_shift_assignment_employee_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","employee_id") REFERENCES "public"."workforce_employee"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_shift_assignment" ADD CONSTRAINT "workforce_shift_assignment_site_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","site_id") REFERENCES "public"."workforce_site"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_shift_assignment" ADD CONSTRAINT "workforce_shift_assignment_plan_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","plan_id") REFERENCES "public"."workforce_shift_plan"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "workforce_shift_profile_tenant_idx" ON "workforce_shift_profile" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "workforce_shift_profile_employee_id_idx" ON "workforce_shift_profile" USING btree ("tenant_id","company_id","employee_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "workforce_shift_profile_employee_id_uq" ON "workforce_shift_profile" USING btree ("tenant_id","company_id","employee_id");
--> statement-breakpoint
CREATE INDEX "workforce_shift_availability_tenant_idx" ON "workforce_shift_availability" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "workforce_shift_availability_employee_id_idx" ON "workforce_shift_availability" USING btree ("tenant_id","company_id","employee_id");
--> statement-breakpoint
CREATE INDEX "workforce_shift_availability_site_id_idx" ON "workforce_shift_availability" USING btree ("tenant_id","company_id","site_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "workforce_shift_availability_employee_id_week_start_uq" ON "workforce_shift_availability" USING btree ("tenant_id","company_id","employee_id","week_start");
--> statement-breakpoint
CREATE INDEX "workforce_shift_plan_tenant_idx" ON "workforce_shift_plan" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "workforce_shift_plan_site_id_idx" ON "workforce_shift_plan" USING btree ("tenant_id","company_id","site_id");
--> statement-breakpoint
CREATE INDEX "workforce_shift_plan_site_id_week_start_status_idx" ON "workforce_shift_plan" USING btree ("tenant_id","company_id","site_id","week_start","status");
--> statement-breakpoint
CREATE INDEX "workforce_shift_assignment_tenant_idx" ON "workforce_shift_assignment" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "workforce_shift_assignment_employee_id_idx" ON "workforce_shift_assignment" USING btree ("tenant_id","company_id","employee_id");
--> statement-breakpoint
CREATE INDEX "workforce_shift_assignment_site_id_idx" ON "workforce_shift_assignment" USING btree ("tenant_id","company_id","site_id");
--> statement-breakpoint
CREATE INDEX "workforce_shift_assignment_plan_id_idx" ON "workforce_shift_assignment" USING btree ("tenant_id","company_id","plan_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "workforce_shift_assignment_plan_id_slot_id_employee_id_uq" ON "workforce_shift_assignment" USING btree ("tenant_id","company_id","plan_id","slot_id","employee_id");
--> statement-breakpoint
CREATE INDEX "workforce_shift_assignment_site_id_date_active_idx" ON "workforce_shift_assignment" USING btree ("tenant_id","company_id","site_id","date","active");
--> statement-breakpoint
CREATE INDEX "workforce_shift_assignment_employee_id_date_active_idx" ON "workforce_shift_assignment" USING btree ("tenant_id","company_id","employee_id","date","active");
--> statement-breakpoint
CREATE POLICY "workforce_shift_profile_tenant_isolation" ON "workforce_shift_profile" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "workforce_shift_availability_tenant_isolation" ON "workforce_shift_availability" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "workforce_shift_plan_tenant_isolation" ON "workforce_shift_plan" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "workforce_shift_assignment_tenant_isolation" ON "workforce_shift_assignment" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
