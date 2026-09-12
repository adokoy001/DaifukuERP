CREATE TABLE "relay_credentials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"gateway_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"secret_hash" text NOT NULL,
	"credential_version" integer NOT NULL,
	"active" integer DEFAULT 1 NOT NULL,
	"rotation_id" uuid,
	"last_seen_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
ALTER TABLE "relay_credentials" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "relay_pairings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"gateway_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"issued_by" uuid NOT NULL,
	"session_version" integer NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
ALTER TABLE "relay_pairings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "edge_gateway" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"reason" text,
	CONSTRAINT "edge_gateway_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "edge_gateway_tenant_id_uq" UNIQUE("tenant_id","id")
);

--> statement-breakpoint
ALTER TABLE "edge_gateway" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "edge_device" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"gateway_id" uuid NOT NULL,
	"local_device_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"driver" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"reason" text,
	CONSTRAINT "edge_device_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "edge_device_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "edge_device_driver_chk" CHECK (driver IN ('ipp_text', 'simulator'))
);

--> statement-breakpoint
ALTER TABLE "edge_device" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "edge_job" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"gateway_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"kind" text NOT NULL,
	"request" jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"lease_hash" text,
	"lease_until" timestamp with time zone,
	"started_at" timestamp with time zone,
	"result" jsonb,
	"reason" text,
	"resolved_at" timestamp with time zone,
	"evidence" text,
	CONSTRAINT "edge_job_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "edge_job_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "edge_job_kind_chk" CHECK (kind IN ('print.text', 'device.status', 'cash.dispense')),
	CONSTRAINT "edge_job_state_chk" CHECK (state IN ('queued', 'claimed', 'executing', 'succeeded', 'failed', 'uncertain', 'cancelled', 'expired'))
);

--> statement-breakpoint
ALTER TABLE "edge_job" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "edge_device_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"gateway_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"key" text NOT NULL,
	"local_device_id" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"code" text NOT NULL,
	"body_hash" text NOT NULL,
	CONSTRAINT "edge_device_event_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "edge_device_event_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "edge_device_event_status_chk" CHECK (status IN ('online', 'offline', 'busy', 'unknown', 'error'))
);

--> statement-breakpoint
ALTER TABLE "edge_device_event" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "relay_credentials" ADD CONSTRAINT "relay_credential_company_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "relay_pairings" ADD CONSTRAINT "relay_pairing_company_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "relay_pairings" ADD CONSTRAINT "relay_pairing_issuer_fk" FOREIGN KEY ("tenant_id","issued_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "edge_gateway" ADD CONSTRAINT "edge_gateway_site_id_workforce_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."workforce_site"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "edge_gateway" ADD CONSTRAINT "edge_gateway_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "edge_gateway" ADD CONSTRAINT "edge_gateway_site_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","site_id") REFERENCES "public"."workforce_site"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "edge_device" ADD CONSTRAINT "edge_device_gateway_id_edge_gateway_id_fk" FOREIGN KEY ("gateway_id") REFERENCES "public"."edge_gateway"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "edge_device" ADD CONSTRAINT "edge_device_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "edge_device" ADD CONSTRAINT "edge_device_gateway_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","gateway_id") REFERENCES "public"."edge_gateway"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "edge_job" ADD CONSTRAINT "edge_job_gateway_id_edge_gateway_id_fk" FOREIGN KEY ("gateway_id") REFERENCES "public"."edge_gateway"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "edge_job" ADD CONSTRAINT "edge_job_device_id_edge_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."edge_device"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "edge_job" ADD CONSTRAINT "edge_job_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "edge_job" ADD CONSTRAINT "edge_job_gateway_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","gateway_id") REFERENCES "public"."edge_gateway"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "edge_job" ADD CONSTRAINT "edge_job_device_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","device_id") REFERENCES "public"."edge_device"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "edge_device_event" ADD CONSTRAINT "edge_device_event_gateway_id_edge_gateway_id_fk" FOREIGN KEY ("gateway_id") REFERENCES "public"."edge_gateway"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "edge_device_event" ADD CONSTRAINT "edge_device_event_device_id_edge_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."edge_device"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "edge_device_event" ADD CONSTRAINT "edge_device_event_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "edge_device_event" ADD CONSTRAINT "edge_device_event_gateway_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","gateway_id") REFERENCES "public"."edge_gateway"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "edge_device_event" ADD CONSTRAINT "edge_device_event_device_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","device_id") REFERENCES "public"."edge_device"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "relay_credential_hash_uq" ON "relay_credentials" USING btree ("secret_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX "relay_credential_generation_uq" ON "relay_credentials" USING btree ("tenant_id","company_id","gateway_id","credential_version");
--> statement-breakpoint
CREATE UNIQUE INDEX "relay_credential_active_uq" ON "relay_credentials" USING btree ("tenant_id","company_id","gateway_id") WHERE "relay_credentials"."active" = 1;
--> statement-breakpoint
CREATE INDEX "relay_gateway_idx" ON "relay_credentials" USING btree ("tenant_id","company_id","gateway_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "relay_pairing_hash_uq" ON "relay_pairings" USING btree ("token_hash");
--> statement-breakpoint
CREATE INDEX "relay_pairing_gateway_idx" ON "relay_pairings" USING btree ("tenant_id","company_id","gateway_id");
--> statement-breakpoint
CREATE INDEX "edge_gateway_tenant_idx" ON "edge_gateway" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "edge_gateway_site_id_idx" ON "edge_gateway" USING btree ("tenant_id","company_id","site_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "edge_gateway_code_uq" ON "edge_gateway" USING btree ("tenant_id","company_id","code");
--> statement-breakpoint
CREATE INDEX "edge_device_tenant_idx" ON "edge_device" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "edge_device_gateway_id_idx" ON "edge_device" USING btree ("tenant_id","company_id","gateway_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "edge_device_key_uq" ON "edge_device" USING btree ("tenant_id","company_id","key");
--> statement-breakpoint
CREATE INDEX "edge_device_gateway_id_active_idx" ON "edge_device" USING btree ("tenant_id","company_id","gateway_id","active");
--> statement-breakpoint
CREATE INDEX "edge_job_tenant_idx" ON "edge_job" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "edge_job_gateway_id_idx" ON "edge_job" USING btree ("tenant_id","company_id","gateway_id");
--> statement-breakpoint
CREATE INDEX "edge_job_device_id_idx" ON "edge_job" USING btree ("tenant_id","company_id","device_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "edge_job_idempotency_key_uq" ON "edge_job" USING btree ("tenant_id","company_id","idempotency_key");
--> statement-breakpoint
CREATE INDEX "edge_job_gateway_id_state_idx" ON "edge_job" USING btree ("tenant_id","company_id","gateway_id","state");
--> statement-breakpoint
CREATE INDEX "edge_job_device_id_state_idx" ON "edge_job" USING btree ("tenant_id","company_id","device_id","state");
--> statement-breakpoint
CREATE INDEX "edge_device_event_tenant_idx" ON "edge_device_event" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "edge_device_event_gateway_id_idx" ON "edge_device_event" USING btree ("tenant_id","company_id","gateway_id");
--> statement-breakpoint
CREATE INDEX "edge_device_event_device_id_idx" ON "edge_device_event" USING btree ("tenant_id","company_id","device_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "edge_device_event_key_uq" ON "edge_device_event" USING btree ("tenant_id","company_id","key");
--> statement-breakpoint
CREATE INDEX "edge_device_event_gateway_id_received_at_idx" ON "edge_device_event" USING btree ("tenant_id","company_id","gateway_id","received_at");
--> statement-breakpoint
CREATE POLICY "relay_credentials_tenant_isolation" ON "relay_credentials" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "relay_pairings_tenant_isolation" ON "relay_pairings" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "edge_gateway_tenant_isolation" ON "edge_gateway" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "edge_device_tenant_isolation" ON "edge_device" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "edge_job_tenant_isolation" ON "edge_job" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "edge_device_event_tenant_isolation" ON "edge_device_event" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
