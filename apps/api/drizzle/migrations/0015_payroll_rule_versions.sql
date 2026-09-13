CREATE TABLE "workforce_payroll_rule_release" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"package_code" text NOT NULL,
	"rule_id" uuid NOT NULL,
	"tax_year" integer NOT NULL,
	"country" text NOT NULL,
	"currency" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"manifest_hash" text NOT NULL,
	"status" text NOT NULL,
	"supersedes_release_id" uuid,
	"approved_by" uuid NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	"approval_basis" text NOT NULL,
	CONSTRAINT "workforce_payroll_rule_release_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "workforce_payroll_rule_release_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "workforce_payroll_rule_release_status_chk" CHECK (status IN ('approved'))
);

--> statement-breakpoint
ALTER TABLE "workforce_payroll_rule_release" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workforce_payroll_rule_release" ADD CONSTRAINT "workforce_payroll_rule_release_rule_id_workforce_payroll_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."workforce_payroll_rules"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_payroll_rule_release" ADD CONSTRAINT "workforce_payroll_rule_release_supersedes_release_id_workforce_payroll_rule_release_id_fk" FOREIGN KEY ("supersedes_release_id") REFERENCES "public"."workforce_payroll_rule_release"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_payroll_rule_release" ADD CONSTRAINT "workforce_payroll_rule_release_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_payroll_rule_release" ADD CONSTRAINT "workforce_payroll_rule_release_rule_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","rule_id") REFERENCES "public"."workforce_payroll_rules"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workforce_payroll_rule_release" ADD CONSTRAINT "workforce_payroll_rule_release_supersedes_release_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","supersedes_release_id") REFERENCES "public"."workforce_payroll_rule_release"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "workforce_payroll_rule_release_tenant_idx" ON "workforce_payroll_rule_release" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "workforce_payroll_rule_release_package_code_uq" ON "workforce_payroll_rule_release" USING btree ("tenant_id","company_id","package_code");
--> statement-breakpoint
CREATE UNIQUE INDEX "workforce_payroll_rule_release_rule_id_uq" ON "workforce_payroll_rule_release" USING btree ("tenant_id","company_id","rule_id");
--> statement-breakpoint
CREATE INDEX "workforce_payroll_rule_release_supersedes_release_id_idx" ON "workforce_payroll_rule_release" USING btree ("tenant_id","company_id","supersedes_release_id");
--> statement-breakpoint
CREATE POLICY "workforce_payroll_rule_release_tenant_isolation" ON "workforce_payroll_rule_release" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
