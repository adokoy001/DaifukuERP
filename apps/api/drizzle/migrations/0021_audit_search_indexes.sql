CREATE INDEX "audit_log_company_at_idx" ON "audit_log" USING btree ("tenant_id","company_id","at","id");
--> statement-breakpoint
CREATE INDEX "audit_log_actor_at_idx" ON "audit_log" USING btree ("tenant_id","actor_id","at");
--> statement-breakpoint
CREATE INDEX "audit_log_on_behalf_at_idx" ON "audit_log" USING btree ("tenant_id","on_behalf_of","at") WHERE "audit_log"."on_behalf_of" is not null;
