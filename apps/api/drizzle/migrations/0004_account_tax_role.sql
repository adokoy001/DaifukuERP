ALTER TABLE "account" ADD COLUMN "tax_role" text DEFAULT 'none' NOT NULL;
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_tax_role_chk" CHECK (tax_role IN ('none', 'output_tax', 'input_tax'));
