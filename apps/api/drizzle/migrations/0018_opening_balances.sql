ALTER TABLE "sales_invoice" ADD COLUMN "opening_balance" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "purchase_invoice" ADD COLUMN "opening_balance" boolean DEFAULT false NOT NULL;
