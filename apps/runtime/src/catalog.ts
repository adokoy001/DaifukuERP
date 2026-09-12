import type { ModuleDef } from '@daifuku/kernel';
import { PartnerModule } from '@daifuku/mod-partner';
import { ProductModule } from '@daifuku/mod-product';
import { TaxModule } from '@daifuku/mod-tax';
import { AccountingModule } from '@daifuku/mod-accounting';
import { AttachmentsModule } from '@daifuku/mod-attachments';
import { SalesModule } from '@daifuku/mod-sales';
import { PurchaseModule } from '@daifuku/mod-purchase';
import { PaymentModule } from '@daifuku/mod-payment';
import { InventoryModule } from '@daifuku/mod-inventory';
import { ContractModule } from '@daifuku/mod-contract';
import { IndustryOperationsModule } from '@daifuku/mod-industry-operations';
import { WorkforceModule } from '@daifuku/mod-workforce';
import { WorkforceEvidenceModule } from '@daifuku/mod-workforce-evidence';
import { JapanModule } from '@daifuku/l10n-jp';

export const businessModules: readonly ModuleDef[] = [PartnerModule, ProductModule, TaxModule, AccountingModule, AttachmentsModule, SalesModule, PurchaseModule, PaymentModule, InventoryModule, ContractModule, WorkforceModule, WorkforceEvidenceModule, IndustryOperationsModule, JapanModule];
