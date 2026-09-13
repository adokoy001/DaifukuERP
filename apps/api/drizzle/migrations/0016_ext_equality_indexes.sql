ALTER TABLE "product" ADD COLUMN "_ext_eq_jan_bbdda0a5d6f7" text GENERATED ALWAYS AS (left(("ext" ->> 'jan'), 128)) STORED;
--> statement-breakpoint
CREATE INDEX "product_ext_jan_eq_ec17256bb299_idx" ON "product" USING btree ("tenant_id","company_id","_ext_eq_jan_bbdda0a5d6f7");
