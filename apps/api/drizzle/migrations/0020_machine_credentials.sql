CREATE TABLE "machine_credentials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"purpose" text NOT NULL,
	"roles" jsonb NOT NULL,
	"secret_hash" text NOT NULL,
	"issued_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"revoke_reason" text,
	"last_used_at" timestamp with time zone,
	"last_denied_at" timestamp with time zone,
	"last_denied_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "machine_credential_purpose_chk" CHECK ("machine_credentials"."purpose" IN ('mcp', 'integration'))
);

--> statement-breakpoint
ALTER TABLE "machine_credentials" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "machine_credentials" ADD CONSTRAINT "machine_credential_company_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "machine_credentials" ADD CONSTRAINT "machine_credential_issuer_fk" FOREIGN KEY ("tenant_id","issued_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "machine_credentials" ADD CONSTRAINT "machine_credential_revoker_fk" FOREIGN KEY ("tenant_id","revoked_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "machine_credential_hash_uq" ON "machine_credentials" USING btree ("secret_hash");
--> statement-breakpoint
CREATE INDEX "machine_credential_company_idx" ON "machine_credentials" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "machine_credential_issuer_idx" ON "machine_credentials" USING btree ("tenant_id","issued_by");
--> statement-breakpoint
CREATE POLICY "machine_credentials_tenant_isolation" ON "machine_credentials" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
