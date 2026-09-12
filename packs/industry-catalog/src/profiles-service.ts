import { f, label } from '@daifuku/kernel';
import { addDays, amount, dayDifference, invalid, quarterHours } from '@daifuku/mod-industry-operations';
import { intField, needs, oneJob, textField, wholeUnits, type IndustryProfile } from './profile.ts';
export const hospitality: IndustryProfile = {
  job: { name: 'hospitality', label: label('宿泊の滞在精算', 'Completed hotel stay'), quantityLabel: label('滞在した泊数', 'Stayed nights'), unitCode: 'IO-NIGHT', productKind: 'service', dueDays: 0,
    fields: { arrivalDate: f.date({ label: label('到着日', 'Arrival'), required: true }), departureDate: f.date({ label: label('出発日', 'Departure'), required: true }), roomReference: textField('客室参照', 'Room reference'), guestCount: intField('利用人数', 'Guest count', 1, 1), checkoutConfirmation: textField('退館確認記録', 'Checkout confirmation') },
    form: [['arrivalDate', 'departureDate'], ['roomReference', 'guestCount', 'checkoutConfirmation']],
    validate(row, stage) { wholeUnits(row); const nights = dayDifference(String(row.arrivalDate), String(row.departureDate)); if (nights <= 0 || !amount(row.orderedQuantity, 'orderedQuantity').eq(String(nights))) invalid('orderedQuantity', '受注泊数は出発日と到着日の差に一致させてください。'); needs(row, stage, ['roomReference'], ['checkoutConfirmation']); if (stage === 'complete' && (!amount(row.completedQuantity, 'completedQuantity').eq(String(nights)) || String(row.completedDate) < String(row.departureDate))) invalid('completedDate', '全泊数の滞在と出発日以降の精算を確認してください。'); },
  }, productName: '客室宿泊料（架空）', unitName: '泊（業界案件）', unitPrice: '12000', orderedQuantity: '2', sample: (date) => ({ arrivalDate: date, departureDate: addDays(date, 2), roomReference: 'DEMO-201', guestCount: 1 }),
};
export const clinic: IndustryProfile = {
  job: { name: 'clinic', label: label('クリニックの法人健診事務', 'Clinic corporate checkup administration'), quantityLabel: label('実施を確認した人数', 'Confirmed participants'), unitCode: 'IO-PAX', productKind: 'service', dueDays: 30,
    fields: { corporateContract: textField('法人契約参照', 'Corporate agreement'), venue: textField('実施会場', 'Venue'), administrationConfirmation: textField('人数・実施確認記録', 'Administrative confirmation') },
    form: [['corporateContract', 'venue'], ['administrationConfirmation']],
    validate(row, stage) { wholeUnits(row); needs(row, stage, ['corporateContract', 'venue'], ['administrationConfirmation']); },
  }, productName: '法人健診の契約料金（架空・税区分要確認）', unitName: '人（業界案件）', unitPrice: '10000', orderedQuantity: '10', sample: () => ({ corporateContract: 'DEMO-CORP-001', venue: '法人健診会場（架空）' }),
};
export const careService: IndustryProfile = {
  job: { name: 'care_service', label: label('介護の保険外生活支援', 'Private-pay care support'), quantityLabel: label('提供した時間', 'Delivered hours'), unitCode: 'IO-HR', productKind: 'service', dueDays: 0,
    fields: { supportType: f.enum(['housework', 'shopping', 'companionship'], { label: label('保険外支援の種類', 'Private support type'), required: true, labels: { housework: label('家事支援', 'Housework'), shopping: label('買物支援', 'Shopping'), companionship: label('付き添い', 'Companionship') } }), consentReference: textField('保険外契約・同意参照', 'Private-pay consent'), serviceLocation: textField('支援場所参照', 'Support location reference'), completionSigner: textField('提供確認者（役割・記録参照）', 'Completion witness reference') },
    form: [['supportType', 'consentReference'], ['serviceLocation', 'completionSigner']],
    validate(row, stage) { quarterHours(row, 'orderedQuantity'); quarterHours(row, 'completedQuantity'); needs(row, stage, ['consentReference', 'serviceLocation'], ['completionSigner']); },
  }, productName: '保険外の家事支援料（架空・税区分要確認）', unitName: '時間（業界案件）', unitPrice: '3000', orderedQuantity: '2', sample: () => ({ supportType: 'housework', consentReference: 'DEMO-PRIVATE-001', serviceLocation: 'サンプル訪問先A' }),
};
export const education: IndustryProfile = {
  job: { name: 'education', label: label('教育の講座実施', 'Course delivery'), quantityLabel: label('出席した人数', 'Attendees'), unitCode: 'IO-PAX', productKind: 'service', dueDays: 0,
    fields: { course: textField('講座・カリキュラム', 'Course'), venue: textField('会場・教室', 'Classroom'), capacity: intField('募集定員', 'Capacity', 1, 1), attendanceConfirmation: textField('出席確認記録参照', 'Attendance reference') },
    form: [['course', 'venue'], ['capacity', 'attendanceConfirmation']],
    validate(row, stage) { wholeUnits(row); if (amount(row.orderedQuantity, 'orderedQuantity').gt(String(row.capacity))) invalid('orderedQuantity', '受講予約人数は定員以内にしてください。'); needs(row, stage, ['course', 'venue'], ['attendanceConfirmation']); },
  }, productName: '法人向け表計算講座料（架空）', unitName: '人（業界案件）', unitPrice: '5000', orderedQuantity: '12', sample: () => ({ course: '表計算基礎（サンプル）', venue: '大福スクールA教室（架空）', capacity: 15 }),
};
export const professionalService: IndustryProfile = {
  job: { name: 'professional_service', label: label('専門サービス・IT受託の検収', 'Professional / IT service acceptance'), quantityLabel: label('検収された時間', 'Accepted hours'), unitCode: 'IO-HR', productKind: 'service', dueDays: 30,
    fields: { projectCode: textField('プロジェクトコード', 'Project code'), deliverable: textField('成果物・受入基準', 'Deliverable / acceptance criteria'), acceptanceReference: textField('顧客検収記録参照', 'Customer acceptance reference') },
    form: [['projectCode', 'deliverable'], ['acceptanceReference']],
    validate(row, stage) { quarterHours(row, 'orderedQuantity'); quarterHours(row, 'completedQuantity'); needs(row, stage, ['projectCode', 'deliverable'], ['acceptanceReference']); },
  }, productName: '業務画面開発の受託作業料（架空）', unitName: '時間（業界案件）', unitPrice: '8000', orderedQuantity: '8', sample: () => ({ projectCode: 'DEMO-IT-001', deliverable: '在庫一覧画面と合意済み動作確認' }),
};
export const beautySalon: IndustryProfile = {
  job: { name: 'beauty_salon', label: label('美容サロンの施術完了', 'Salon service completion'), quantityLabel: label('完了した施術（一式）', 'Completed treatment'), unitCode: 'IO-JOB', productKind: 'service', dueDays: 0,
    fields: { menu: textField('施術メニュー', 'Treatment menu'), stylist: textField('施術担当参照', 'Stylist reference'), serviceConfirmation: textField('施術・会計確認記録', 'Service confirmation') },
    form: [['menu', 'stylist'], ['serviceConfirmation']],
    validate(row, stage) { oneJob(row, stage); needs(row, stage, ['menu', 'stylist'], ['serviceConfirmation']); },
  }, productName: 'カット・仕上げ施術料（架空）', unitName: '一式（業界案件）', unitPrice: '5000', orderedQuantity: '1', sample: () => ({ menu: 'カット・仕上げ（サンプル）', stylist: '担当者A（架空）' }),
};
