CREATE TABLE "appliance_store_service" (
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
	"device_id" uuid NOT NULL,
	"date" date DEFAULT CURRENT_DATE NOT NULL,
	"scheduled_date" date,
	"kind" text DEFAULT 'repair' NOT NULL,
	"request" text NOT NULL,
	"assignee" text,
	"work_report" text,
	"completed_date" date,
	"billing" text DEFAULT 'billable' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"sales_invoice_id" uuid,
	"note" text,
	CONSTRAINT "appliance_store_service_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "appliance_store_service_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "appliance_store_service_kind_chk" CHECK (kind IN ('repair', 'installation')),
	CONSTRAINT "appliance_store_service_billing_chk" CHECK (billing IN ('billable', 'no_charge')),
	CONSTRAINT "appliance_store_service_status_chk" CHECK (status IN ('queued', 'in_progress', 'completed', 'cancelled')),
	CONSTRAINT "appliance_store_service_docstatus_chk" CHECK (docstatus IN (0, 1, 2))
);

--> statement-breakpoint
ALTER TABLE "appliance_store_service" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "appliance_store_service_line" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"ext" jsonb,
	"service_id" uuid NOT NULL,
	"seq" integer DEFAULT 1 NOT NULL,
	"product_id" uuid NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(20, 6) DEFAULT '1' NOT NULL,
	"unit_price" numeric(20, 6) NOT NULL,
	"tax_category" text DEFAULT 'standard' NOT NULL,
	"amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	CONSTRAINT "appliance_store_service_line_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "appliance_store_service_line_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "appliance_store_service_line_tax_category_chk" CHECK (tax_category IN ('standard', 'reduced', 'exempt', 'non_taxable', 'out_of_scope'))
);

--> statement-breakpoint
ALTER TABLE "appliance_store_service_line" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "appliance_store_device" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"ext" jsonb,
	"code" text NOT NULL,
	"partner_id" uuid NOT NULL,
	"product_id" uuid,
	"name" text NOT NULL,
	"manufacturer" text,
	"model" text NOT NULL,
	"serial_number" text,
	"location" text,
	"purchase_date" date,
	"warranty_until" date,
	"contract_id" uuid,
	"note" text,
	CONSTRAINT "appliance_store_device_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "appliance_store_device_tenant_id_uq" UNIQUE("tenant_id","id")
);

--> statement-breakpoint
ALTER TABLE "appliance_store_device" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "farm_field" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"ext" jsonb,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"area_m2" numeric(20, 6) NOT NULL,
	"location" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"note" text,
	CONSTRAINT "farm_field_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "farm_field_tenant_id_uq" UNIQUE("tenant_id","id")
);

--> statement-breakpoint
ALTER TABLE "farm_field" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "farm_crop" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"ext" jsonb,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"product_id" uuid NOT NULL,
	"variety" text,
	"note" text,
	CONSTRAINT "farm_crop_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "farm_crop_tenant_id_uq" UNIQUE("tenant_id","id")
);

--> statement-breakpoint
ALTER TABLE "farm_crop" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "farm_season" (
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
	"sample_key" text,
	"name" text NOT NULL,
	"field_id" uuid NOT NULL,
	"crop_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"closed_date" date,
	"note" text,
	CONSTRAINT "farm_season_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "farm_season_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "farm_season_docstatus_chk" CHECK (docstatus IN (0, 1, 2))
);

--> statement-breakpoint
ALTER TABLE "farm_season" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "farm_harvest" (
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
	"sample_key" text,
	"season_id" uuid NOT NULL,
	"date" date DEFAULT CURRENT_DATE NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"quantity" numeric(20, 6) NOT NULL,
	"valuation_unit_cost" numeric(20, 6) NOT NULL,
	"valuation_amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"product_id" uuid,
	"uom_code" text,
	"stock_entry_id" uuid,
	"cancelled_date" date,
	"note" text,
	CONSTRAINT "farm_harvest_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "farm_harvest_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "farm_harvest_docstatus_chk" CHECK (docstatus IN (0, 1, 2))
);

--> statement-breakpoint
ALTER TABLE "farm_harvest" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "farm_work" (
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
	"sample_key" text,
	"season_id" uuid NOT NULL,
	"date" date DEFAULT CURRENT_DATE NOT NULL,
	"activity" text NOT NULL,
	"labor_hours" numeric(20, 6) DEFAULT '0' NOT NULL,
	"warehouse_id" uuid,
	"stock_entry_id" uuid,
	"cancelled_date" date,
	"note" text,
	CONSTRAINT "farm_work_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "farm_work_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "farm_work_activity_chk" CHECK (activity IN ('sowing', 'planting', 'fertilizing', 'weeding', 'irrigation', 'other')),
	CONSTRAINT "farm_work_docstatus_chk" CHECK (docstatus IN (0, 1, 2))
);

--> statement-breakpoint
ALTER TABLE "farm_work" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "farm_material_line" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"ext" jsonb,
	"work_id" uuid NOT NULL,
	"seq" integer DEFAULT 1 NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" numeric(20, 6) NOT NULL,
	"uom_code" text,
	"note" text,
	CONSTRAINT "farm_material_line_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "farm_material_line_tenant_id_uq" UNIQUE("tenant_id","id")
);

--> statement-breakpoint
ALTER TABLE "farm_material_line" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "restaurant_chain_closing" (
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
	"store_id" uuid NOT NULL,
	"date" date DEFAULT CURRENT_DATE NOT NULL,
	"cash_amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"card_amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"qr_amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"subtotal" numeric(20, 6) DEFAULT '0' NOT NULL,
	"tax_total" numeric(20, 6) DEFAULT '0' NOT NULL,
	"total" numeric(20, 6) DEFAULT '0' NOT NULL,
	"quantity" numeric(20, 6) DEFAULT '0' NOT NULL,
	"tax_summary" jsonb,
	"consumption_cost" numeric(20, 6) DEFAULT '0' NOT NULL,
	"waste_cost" numeric(20, 6) DEFAULT '0' NOT NULL,
	"sales_invoice_id" uuid,
	"payment_id" uuid,
	"consumption_entry_id" uuid,
	"waste_entry_id" uuid,
	"cancelled_date" date,
	"note" text,
	CONSTRAINT "restaurant_chain_closing_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "restaurant_chain_closing_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "restaurant_chain_closing_docstatus_chk" CHECK (docstatus IN (0, 1, 2))
);

--> statement-breakpoint
ALTER TABLE "restaurant_chain_closing" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "restaurant_chain_store" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"ext" jsonb,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"cash_account_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "restaurant_chain_store_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "restaurant_chain_store_tenant_id_uq" UNIQUE("tenant_id","id")
);

--> statement-breakpoint
ALTER TABLE "restaurant_chain_store" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "restaurant_chain_recipe" (
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
	"code" text NOT NULL,
	"name" text NOT NULL,
	"product_id" uuid NOT NULL,
	"unit_price" numeric(20, 6) NOT NULL,
	"alcohol" boolean DEFAULT false NOT NULL,
	"note" text,
	CONSTRAINT "restaurant_chain_recipe_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "restaurant_chain_recipe_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "restaurant_chain_recipe_docstatus_chk" CHECK (docstatus IN (0, 1, 2))
);

--> statement-breakpoint
ALTER TABLE "restaurant_chain_recipe" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "restaurant_chain_recipe_ingredient" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"ext" jsonb,
	"recipe_id" uuid NOT NULL,
	"seq" integer DEFAULT 1 NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" numeric(20, 6) NOT NULL,
	CONSTRAINT "restaurant_chain_recipe_ingredient_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "restaurant_chain_recipe_ingredient_tenant_id_uq" UNIQUE("tenant_id","id")
);

--> statement-breakpoint
ALTER TABLE "restaurant_chain_recipe_ingredient" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "restaurant_chain_closing_line" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"ext" jsonb,
	"closing_id" uuid NOT NULL,
	"seq" integer DEFAULT 1 NOT NULL,
	"recipe_id" uuid NOT NULL,
	"service_mode" text DEFAULT 'dine_in' NOT NULL,
	"quantity" numeric(20, 6) DEFAULT '1' NOT NULL,
	"unit_price" numeric(20, 6),
	"description" text,
	"tax_category" text,
	"amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	CONSTRAINT "restaurant_chain_closing_line_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "restaurant_chain_closing_line_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "restaurant_chain_closing_line_service_mode_chk" CHECK (service_mode IN ('dine_in', 'takeaway')),
	CONSTRAINT "restaurant_chain_closing_line_tax_category_chk" CHECK (tax_category IN ('standard', 'reduced'))
);

--> statement-breakpoint
ALTER TABLE "restaurant_chain_closing_line" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "restaurant_chain_waste_line" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"company_id" uuid NOT NULL,
	"ext" jsonb,
	"closing_id" uuid NOT NULL,
	"seq" integer DEFAULT 1 NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" numeric(20, 6) NOT NULL,
	"reason" text DEFAULT 'spoilage' NOT NULL,
	"note" text,
	CONSTRAINT "restaurant_chain_waste_line_scope_id_uq" UNIQUE("tenant_id","company_id","id"),
	CONSTRAINT "restaurant_chain_waste_line_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "restaurant_chain_waste_line_reason_chk" CHECK (reason IN ('spoilage', 'preparation', 'other'))
);

--> statement-breakpoint
ALTER TABLE "restaurant_chain_waste_line" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "appliance_store_service" ADD CONSTRAINT "appliance_store_service_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appliance_store_service" ADD CONSTRAINT "appliance_store_service_device_id_appliance_store_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."appliance_store_device"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appliance_store_service" ADD CONSTRAINT "appliance_store_service_sales_invoice_id_sales_invoice_id_fk" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoice"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appliance_store_service" ADD CONSTRAINT "appliance_store_service_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appliance_store_service" ADD CONSTRAINT "appliance_store_service_partner_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","partner_id") REFERENCES "public"."partner"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appliance_store_service" ADD CONSTRAINT "appliance_store_service_device_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","device_id") REFERENCES "public"."appliance_store_device"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appliance_store_service" ADD CONSTRAINT "appliance_store_service_sales_invoice_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","sales_invoice_id") REFERENCES "public"."sales_invoice"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appliance_store_service_line" ADD CONSTRAINT "appliance_store_service_line_service_id_appliance_store_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."appliance_store_service"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appliance_store_service_line" ADD CONSTRAINT "appliance_store_service_line_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appliance_store_service_line" ADD CONSTRAINT "appliance_store_service_line_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appliance_store_service_line" ADD CONSTRAINT "appliance_store_service_line_service_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","service_id") REFERENCES "public"."appliance_store_service"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appliance_store_service_line" ADD CONSTRAINT "appliance_store_service_line_product_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","product_id") REFERENCES "public"."product"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appliance_store_device" ADD CONSTRAINT "appliance_store_device_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appliance_store_device" ADD CONSTRAINT "appliance_store_device_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appliance_store_device" ADD CONSTRAINT "appliance_store_device_contract_id_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appliance_store_device" ADD CONSTRAINT "appliance_store_device_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appliance_store_device" ADD CONSTRAINT "appliance_store_device_partner_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","partner_id") REFERENCES "public"."partner"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appliance_store_device" ADD CONSTRAINT "appliance_store_device_product_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","product_id") REFERENCES "public"."product"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appliance_store_device" ADD CONSTRAINT "appliance_store_device_contract_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","contract_id") REFERENCES "public"."contract"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "farm_field" ADD CONSTRAINT "farm_field_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "farm_crop" ADD CONSTRAINT "farm_crop_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "farm_crop" ADD CONSTRAINT "farm_crop_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "farm_crop" ADD CONSTRAINT "farm_crop_product_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","product_id") REFERENCES "public"."product"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "farm_season" ADD CONSTRAINT "farm_season_field_id_farm_field_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."farm_field"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "farm_season" ADD CONSTRAINT "farm_season_crop_id_farm_crop_id_fk" FOREIGN KEY ("crop_id") REFERENCES "public"."farm_crop"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "farm_season" ADD CONSTRAINT "farm_season_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "farm_season" ADD CONSTRAINT "farm_season_field_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","field_id") REFERENCES "public"."farm_field"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "farm_season" ADD CONSTRAINT "farm_season_crop_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","crop_id") REFERENCES "public"."farm_crop"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "farm_harvest" ADD CONSTRAINT "farm_harvest_season_id_farm_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."farm_season"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "farm_harvest" ADD CONSTRAINT "farm_harvest_warehouse_id_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "farm_harvest" ADD CONSTRAINT "farm_harvest_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "farm_harvest" ADD CONSTRAINT "farm_harvest_stock_entry_id_stock_entry_id_fk" FOREIGN KEY ("stock_entry_id") REFERENCES "public"."stock_entry"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "farm_harvest" ADD CONSTRAINT "farm_harvest_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "farm_harvest" ADD CONSTRAINT "farm_harvest_season_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","season_id") REFERENCES "public"."farm_season"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "farm_harvest" ADD CONSTRAINT "farm_harvest_warehouse_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","warehouse_id") REFERENCES "public"."warehouse"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "farm_harvest" ADD CONSTRAINT "farm_harvest_product_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","product_id") REFERENCES "public"."product"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "farm_harvest" ADD CONSTRAINT "farm_harvest_stock_entry_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","stock_entry_id") REFERENCES "public"."stock_entry"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "farm_work" ADD CONSTRAINT "farm_work_season_id_farm_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."farm_season"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "farm_work" ADD CONSTRAINT "farm_work_warehouse_id_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "farm_work" ADD CONSTRAINT "farm_work_stock_entry_id_stock_entry_id_fk" FOREIGN KEY ("stock_entry_id") REFERENCES "public"."stock_entry"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "farm_work" ADD CONSTRAINT "farm_work_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "farm_work" ADD CONSTRAINT "farm_work_season_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","season_id") REFERENCES "public"."farm_season"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "farm_work" ADD CONSTRAINT "farm_work_warehouse_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","warehouse_id") REFERENCES "public"."warehouse"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "farm_work" ADD CONSTRAINT "farm_work_stock_entry_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","stock_entry_id") REFERENCES "public"."stock_entry"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "farm_material_line" ADD CONSTRAINT "farm_material_line_work_id_farm_work_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."farm_work"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "farm_material_line" ADD CONSTRAINT "farm_material_line_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "farm_material_line" ADD CONSTRAINT "farm_material_line_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "farm_material_line" ADD CONSTRAINT "farm_material_line_work_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","work_id") REFERENCES "public"."farm_work"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "farm_material_line" ADD CONSTRAINT "farm_material_line_product_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","product_id") REFERENCES "public"."product"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "restaurant_chain_closing" ADD CONSTRAINT "restaurant_chain_closing_store_id_restaurant_chain_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."restaurant_chain_store"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "restaurant_chain_closing" ADD CONSTRAINT "restaurant_chain_closing_sales_invoice_id_sales_invoice_id_fk" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoice"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "restaurant_chain_closing" ADD CONSTRAINT "restaurant_chain_closing_payment_id_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "restaurant_chain_closing" ADD CONSTRAINT "restaurant_chain_closing_consumption_entry_id_stock_entry_id_fk" FOREIGN KEY ("consumption_entry_id") REFERENCES "public"."stock_entry"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "restaurant_chain_closing" ADD CONSTRAINT "restaurant_chain_closing_waste_entry_id_stock_entry_id_fk" FOREIGN KEY ("waste_entry_id") REFERENCES "public"."stock_entry"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "restaurant_chain_closing" ADD CONSTRAINT "restaurant_chain_closing_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "restaurant_chain_closing" ADD CONSTRAINT "restaurant_chain_closing_store_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","store_id") REFERENCES "public"."restaurant_chain_store"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "restaurant_chain_closing" ADD CONSTRAINT "restaurant_chain_closing_sales_invoice_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","sales_invoice_id") REFERENCES "public"."sales_invoice"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "restaurant_chain_closing" ADD CONSTRAINT "restaurant_chain_closing_payment_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","payment_id") REFERENCES "public"."payment"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "restaurant_chain_closing" ADD CONSTRAINT "restaurant_chain_closing_consumption_entry_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","consumption_entry_id") REFERENCES "public"."stock_entry"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "restaurant_chain_closing" ADD CONSTRAINT "restaurant_chain_closing_waste_entry_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","waste_entry_id") REFERENCES "public"."stock_entry"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "restaurant_chain_store" ADD CONSTRAINT "restaurant_chain_store_warehouse_id_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "restaurant_chain_store" ADD CONSTRAINT "restaurant_chain_store_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "restaurant_chain_store" ADD CONSTRAINT "restaurant_chain_store_cash_account_id_account_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."account"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "restaurant_chain_store" ADD CONSTRAINT "restaurant_chain_store_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "restaurant_chain_store" ADD CONSTRAINT "restaurant_chain_store_warehouse_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","warehouse_id") REFERENCES "public"."warehouse"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "restaurant_chain_store" ADD CONSTRAINT "restaurant_chain_store_partner_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","partner_id") REFERENCES "public"."partner"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "restaurant_chain_store" ADD CONSTRAINT "restaurant_chain_store_cash_account_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","cash_account_id") REFERENCES "public"."account"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "restaurant_chain_recipe" ADD CONSTRAINT "restaurant_chain_recipe_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "restaurant_chain_recipe" ADD CONSTRAINT "restaurant_chain_recipe_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "restaurant_chain_recipe" ADD CONSTRAINT "restaurant_chain_recipe_product_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","product_id") REFERENCES "public"."product"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "restaurant_chain_recipe_ingredient" ADD CONSTRAINT "restaurant_chain_recipe_ingredient_recipe_id_restaurant_chain_recipe_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."restaurant_chain_recipe"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "restaurant_chain_recipe_ingredient" ADD CONSTRAINT "restaurant_chain_recipe_ingredient_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "restaurant_chain_recipe_ingredient" ADD CONSTRAINT "restaurant_chain_recipe_ingredient_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "restaurant_chain_recipe_ingredient" ADD CONSTRAINT "restaurant_chain_recipe_ingredient_recipe_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","recipe_id") REFERENCES "public"."restaurant_chain_recipe"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "restaurant_chain_recipe_ingredient" ADD CONSTRAINT "restaurant_chain_recipe_ingredient_product_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","product_id") REFERENCES "public"."product"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "restaurant_chain_closing_line" ADD CONSTRAINT "restaurant_chain_closing_line_closing_id_restaurant_chain_closing_id_fk" FOREIGN KEY ("closing_id") REFERENCES "public"."restaurant_chain_closing"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "restaurant_chain_closing_line" ADD CONSTRAINT "restaurant_chain_closing_line_recipe_id_restaurant_chain_recipe_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."restaurant_chain_recipe"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "restaurant_chain_closing_line" ADD CONSTRAINT "restaurant_chain_closing_line_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "restaurant_chain_closing_line" ADD CONSTRAINT "restaurant_chain_closing_line_closing_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","closing_id") REFERENCES "public"."restaurant_chain_closing"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "restaurant_chain_closing_line" ADD CONSTRAINT "restaurant_chain_closing_line_recipe_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","recipe_id") REFERENCES "public"."restaurant_chain_recipe"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "restaurant_chain_waste_line" ADD CONSTRAINT "restaurant_chain_waste_line_closing_id_restaurant_chain_closing_id_fk" FOREIGN KEY ("closing_id") REFERENCES "public"."restaurant_chain_closing"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "restaurant_chain_waste_line" ADD CONSTRAINT "restaurant_chain_waste_line_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "restaurant_chain_waste_line" ADD CONSTRAINT "restaurant_chain_waste_line_company_scope_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "restaurant_chain_waste_line" ADD CONSTRAINT "restaurant_chain_waste_line_closing_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","closing_id") REFERENCES "public"."restaurant_chain_closing"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "restaurant_chain_waste_line" ADD CONSTRAINT "restaurant_chain_waste_line_product_id_scope_fk" FOREIGN KEY ("tenant_id","company_id","product_id") REFERENCES "public"."product"("tenant_id","company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "appliance_store_service_tenant_idx" ON "appliance_store_service" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "appliance_store_service_partner_id_idx" ON "appliance_store_service" USING btree ("tenant_id","company_id","partner_id");
--> statement-breakpoint
CREATE INDEX "appliance_store_service_device_id_idx" ON "appliance_store_service" USING btree ("tenant_id","company_id","device_id");
--> statement-breakpoint
CREATE INDEX "appliance_store_service_scheduled_date_idx" ON "appliance_store_service" USING btree ("tenant_id","company_id","scheduled_date");
--> statement-breakpoint
CREATE INDEX "appliance_store_service_status_idx" ON "appliance_store_service" USING btree ("tenant_id","company_id","status");
--> statement-breakpoint
CREATE INDEX "appliance_store_service_sales_invoice_id_idx" ON "appliance_store_service" USING btree ("tenant_id","company_id","sales_invoice_id");
--> statement-breakpoint
CREATE INDEX "appliance_store_service_status_scheduled_date_idx" ON "appliance_store_service" USING btree ("tenant_id","company_id","status","scheduled_date");
--> statement-breakpoint
CREATE UNIQUE INDEX "appliance_store_service_number_uq" ON "appliance_store_service" USING btree ("tenant_id","company_id","number");
--> statement-breakpoint
CREATE INDEX "appliance_store_service_line_tenant_idx" ON "appliance_store_service_line" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "appliance_store_service_line_service_id_idx" ON "appliance_store_service_line" USING btree ("tenant_id","company_id","service_id");
--> statement-breakpoint
CREATE INDEX "appliance_store_service_line_product_id_idx" ON "appliance_store_service_line" USING btree ("tenant_id","company_id","product_id");
--> statement-breakpoint
CREATE INDEX "appliance_store_service_line_service_id_seq_idx" ON "appliance_store_service_line" USING btree ("tenant_id","company_id","service_id","seq");
--> statement-breakpoint
CREATE INDEX "appliance_store_device_tenant_idx" ON "appliance_store_device" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "appliance_store_device_code_uq" ON "appliance_store_device" USING btree ("tenant_id","company_id","code");
--> statement-breakpoint
CREATE INDEX "appliance_store_device_partner_id_idx" ON "appliance_store_device" USING btree ("tenant_id","company_id","partner_id");
--> statement-breakpoint
CREATE INDEX "appliance_store_device_product_id_idx" ON "appliance_store_device" USING btree ("tenant_id","company_id","product_id");
--> statement-breakpoint
CREATE INDEX "appliance_store_device_contract_id_idx" ON "appliance_store_device" USING btree ("tenant_id","company_id","contract_id");
--> statement-breakpoint
CREATE INDEX "farm_field_tenant_idx" ON "farm_field" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "farm_field_code_uq" ON "farm_field" USING btree ("tenant_id","company_id","code");
--> statement-breakpoint
CREATE INDEX "farm_crop_tenant_idx" ON "farm_crop" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "farm_crop_code_uq" ON "farm_crop" USING btree ("tenant_id","company_id","code");
--> statement-breakpoint
CREATE INDEX "farm_crop_product_id_idx" ON "farm_crop" USING btree ("tenant_id","company_id","product_id");
--> statement-breakpoint
CREATE INDEX "farm_season_tenant_idx" ON "farm_season" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "farm_season_sample_key_uq" ON "farm_season" USING btree ("tenant_id","company_id","sample_key");
--> statement-breakpoint
CREATE INDEX "farm_season_field_id_idx" ON "farm_season" USING btree ("tenant_id","company_id","field_id");
--> statement-breakpoint
CREATE INDEX "farm_season_crop_id_idx" ON "farm_season" USING btree ("tenant_id","company_id","crop_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "farm_season_number_uq" ON "farm_season" USING btree ("tenant_id","company_id","number");
--> statement-breakpoint
CREATE INDEX "farm_harvest_tenant_idx" ON "farm_harvest" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "farm_harvest_sample_key_uq" ON "farm_harvest" USING btree ("tenant_id","company_id","sample_key");
--> statement-breakpoint
CREATE INDEX "farm_harvest_season_id_idx" ON "farm_harvest" USING btree ("tenant_id","company_id","season_id");
--> statement-breakpoint
CREATE INDEX "farm_harvest_date_idx" ON "farm_harvest" USING btree ("tenant_id","company_id","date");
--> statement-breakpoint
CREATE INDEX "farm_harvest_warehouse_id_idx" ON "farm_harvest" USING btree ("tenant_id","company_id","warehouse_id");
--> statement-breakpoint
CREATE INDEX "farm_harvest_product_id_idx" ON "farm_harvest" USING btree ("tenant_id","company_id","product_id");
--> statement-breakpoint
CREATE INDEX "farm_harvest_stock_entry_id_idx" ON "farm_harvest" USING btree ("tenant_id","company_id","stock_entry_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "farm_harvest_number_uq" ON "farm_harvest" USING btree ("tenant_id","company_id","number");
--> statement-breakpoint
CREATE INDEX "farm_work_tenant_idx" ON "farm_work" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "farm_work_sample_key_uq" ON "farm_work" USING btree ("tenant_id","company_id","sample_key");
--> statement-breakpoint
CREATE INDEX "farm_work_season_id_idx" ON "farm_work" USING btree ("tenant_id","company_id","season_id");
--> statement-breakpoint
CREATE INDEX "farm_work_date_idx" ON "farm_work" USING btree ("tenant_id","company_id","date");
--> statement-breakpoint
CREATE INDEX "farm_work_warehouse_id_idx" ON "farm_work" USING btree ("tenant_id","company_id","warehouse_id");
--> statement-breakpoint
CREATE INDEX "farm_work_stock_entry_id_idx" ON "farm_work" USING btree ("tenant_id","company_id","stock_entry_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "farm_work_number_uq" ON "farm_work" USING btree ("tenant_id","company_id","number");
--> statement-breakpoint
CREATE INDEX "farm_material_line_tenant_idx" ON "farm_material_line" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "farm_material_line_work_id_idx" ON "farm_material_line" USING btree ("tenant_id","company_id","work_id");
--> statement-breakpoint
CREATE INDEX "farm_material_line_product_id_idx" ON "farm_material_line" USING btree ("tenant_id","company_id","product_id");
--> statement-breakpoint
CREATE INDEX "farm_material_line_work_id_seq_idx" ON "farm_material_line" USING btree ("tenant_id","company_id","work_id","seq");
--> statement-breakpoint
CREATE INDEX "restaurant_chain_closing_tenant_idx" ON "restaurant_chain_closing" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "restaurant_chain_closing_store_id_idx" ON "restaurant_chain_closing" USING btree ("tenant_id","company_id","store_id");
--> statement-breakpoint
CREATE INDEX "restaurant_chain_closing_date_idx" ON "restaurant_chain_closing" USING btree ("tenant_id","company_id","date");
--> statement-breakpoint
CREATE INDEX "restaurant_chain_closing_sales_invoice_id_idx" ON "restaurant_chain_closing" USING btree ("tenant_id","company_id","sales_invoice_id");
--> statement-breakpoint
CREATE INDEX "restaurant_chain_closing_payment_id_idx" ON "restaurant_chain_closing" USING btree ("tenant_id","company_id","payment_id");
--> statement-breakpoint
CREATE INDEX "restaurant_chain_closing_consumption_entry_id_idx" ON "restaurant_chain_closing" USING btree ("tenant_id","company_id","consumption_entry_id");
--> statement-breakpoint
CREATE INDEX "restaurant_chain_closing_waste_entry_id_idx" ON "restaurant_chain_closing" USING btree ("tenant_id","company_id","waste_entry_id");
--> statement-breakpoint
CREATE INDEX "restaurant_chain_closing_store_id_date_idx" ON "restaurant_chain_closing" USING btree ("tenant_id","company_id","store_id","date");
--> statement-breakpoint
CREATE UNIQUE INDEX "restaurant_chain_closing_number_uq" ON "restaurant_chain_closing" USING btree ("tenant_id","company_id","number");
--> statement-breakpoint
CREATE INDEX "restaurant_chain_store_tenant_idx" ON "restaurant_chain_store" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "restaurant_chain_store_code_uq" ON "restaurant_chain_store" USING btree ("tenant_id","company_id","code");
--> statement-breakpoint
CREATE UNIQUE INDEX "restaurant_chain_store_warehouse_id_uq" ON "restaurant_chain_store" USING btree ("tenant_id","company_id","warehouse_id");
--> statement-breakpoint
CREATE INDEX "restaurant_chain_store_partner_id_idx" ON "restaurant_chain_store" USING btree ("tenant_id","company_id","partner_id");
--> statement-breakpoint
CREATE INDEX "restaurant_chain_store_cash_account_id_idx" ON "restaurant_chain_store" USING btree ("tenant_id","company_id","cash_account_id");
--> statement-breakpoint
CREATE INDEX "restaurant_chain_recipe_tenant_idx" ON "restaurant_chain_recipe" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "restaurant_chain_recipe_code_idx" ON "restaurant_chain_recipe" USING btree ("tenant_id","company_id","code");
--> statement-breakpoint
CREATE INDEX "restaurant_chain_recipe_product_id_idx" ON "restaurant_chain_recipe" USING btree ("tenant_id","company_id","product_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "restaurant_chain_recipe_number_uq" ON "restaurant_chain_recipe" USING btree ("tenant_id","company_id","number");
--> statement-breakpoint
CREATE INDEX "restaurant_chain_recipe_ingredient_tenant_idx" ON "restaurant_chain_recipe_ingredient" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "restaurant_chain_recipe_ingredient_recipe_id_idx" ON "restaurant_chain_recipe_ingredient" USING btree ("tenant_id","company_id","recipe_id");
--> statement-breakpoint
CREATE INDEX "restaurant_chain_recipe_ingredient_product_id_idx" ON "restaurant_chain_recipe_ingredient" USING btree ("tenant_id","company_id","product_id");
--> statement-breakpoint
CREATE INDEX "restaurant_chain_closing_line_tenant_idx" ON "restaurant_chain_closing_line" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "restaurant_chain_closing_line_closing_id_idx" ON "restaurant_chain_closing_line" USING btree ("tenant_id","company_id","closing_id");
--> statement-breakpoint
CREATE INDEX "restaurant_chain_closing_line_recipe_id_idx" ON "restaurant_chain_closing_line" USING btree ("tenant_id","company_id","recipe_id");
--> statement-breakpoint
CREATE INDEX "restaurant_chain_waste_line_tenant_idx" ON "restaurant_chain_waste_line" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX "restaurant_chain_waste_line_closing_id_idx" ON "restaurant_chain_waste_line" USING btree ("tenant_id","company_id","closing_id");
--> statement-breakpoint
CREATE INDEX "restaurant_chain_waste_line_product_id_idx" ON "restaurant_chain_waste_line" USING btree ("tenant_id","company_id","product_id");
--> statement-breakpoint
CREATE POLICY "appliance_store_service_tenant_isolation" ON "appliance_store_service" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "appliance_store_service_line_tenant_isolation" ON "appliance_store_service_line" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "appliance_store_device_tenant_isolation" ON "appliance_store_device" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "farm_field_tenant_isolation" ON "farm_field" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "farm_crop_tenant_isolation" ON "farm_crop" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "farm_season_tenant_isolation" ON "farm_season" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "farm_harvest_tenant_isolation" ON "farm_harvest" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "farm_work_tenant_isolation" ON "farm_work" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "farm_material_line_tenant_isolation" ON "farm_material_line" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "restaurant_chain_closing_tenant_isolation" ON "restaurant_chain_closing" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "restaurant_chain_store_tenant_isolation" ON "restaurant_chain_store" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "restaurant_chain_recipe_tenant_isolation" ON "restaurant_chain_recipe" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "restaurant_chain_recipe_ingredient_tenant_isolation" ON "restaurant_chain_recipe_ingredient" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "restaurant_chain_closing_line_tenant_isolation" ON "restaurant_chain_closing_line" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "restaurant_chain_waste_line_tenant_isolation" ON "restaurant_chain_waste_line" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
