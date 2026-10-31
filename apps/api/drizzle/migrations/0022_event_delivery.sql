CREATE TABLE "event_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"channel" text NOT NULL,
	"target" text NOT NULL,
	"target_url_hash" text,
	"payload" jsonb NOT NULL,
	"event_created_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"lease_id" uuid,
	"lease_until" timestamp with time zone,
	"last_error" text,
	"last_status" integer,
	"created_at" timestamp with time zone NOT NULL,
	"delivered_at" timestamp with time zone,
	"dead_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone
);

--> statement-breakpoint
ALTER TABLE "event_deliveries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "webhook_secrets" (
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"endpoint_id" text NOT NULL,
	"secret_cipher" text NOT NULL,
	"url_hash" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"activated_at" timestamp with time zone NOT NULL,
	"issued_by" uuid NOT NULL,
	CONSTRAINT "webhook_secrets_tenant_id_company_id_endpoint_id_pk" PRIMARY KEY("tenant_id","company_id","endpoint_id")
);

--> statement-breakpoint
ALTER TABLE "webhook_secrets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "inbox_watches" (
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"last_total" integer,
	"observed_at" timestamp with time zone,
	"next_check_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "inbox_watches_tenant_id_company_id_user_id_pk" PRIMARY KEY("tenant_id","company_id","user_id")
);

--> statement-breakpoint
ALTER TABLE "inbox_watches" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "next_attempt_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "dead_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "event_deliveries" ADD CONSTRAINT "event_deliveries_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "webhook_secrets" ADD CONSTRAINT "webhook_secrets_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "webhook_secrets" ADD CONSTRAINT "webhook_secrets_issuer_scope_fk" FOREIGN KEY ("tenant_id","issued_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_watches" ADD CONSTRAINT "inbox_watches_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_watches" ADD CONSTRAINT "inbox_watches_user_scope_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "event_deliveries_target_uq" ON "event_deliveries" USING btree ("tenant_id","event_id","channel","target");
--> statement-breakpoint
CREATE INDEX "event_deliveries_due_idx" ON "event_deliveries" USING btree ("tenant_id","next_attempt_at") WHERE "event_deliveries"."status" in ('pending', 'sending');
--> statement-breakpoint
CREATE INDEX "event_deliveries_list_idx" ON "event_deliveries" USING btree ("tenant_id","company_id","status","created_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "event_deliveries_purge_idx" ON "event_deliveries" USING btree (coalesce("delivered_at", "cancelled_at"),"tenant_id") WHERE "event_deliveries"."status" in ('delivered', 'cancelled');
--> statement-breakpoint
CREATE INDEX "inbox_watches_due_idx" ON "inbox_watches" USING btree ("next_check_at","tenant_id");
--> statement-breakpoint
CREATE INDEX "outbox_due_idx" ON "outbox" USING btree ("tenant_id","next_attempt_at") WHERE "outbox"."published_at" is null and "outbox"."dead_at" is null;
--> statement-breakpoint
CREATE POLICY "event_deliveries_tenant_isolation" ON "event_deliveries" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "webhook_secrets_tenant_isolation" ON "webhook_secrets" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "inbox_watches_tenant_isolation" ON "inbox_watches" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
