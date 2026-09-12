// Effective data checked against the official sources recorded in docs/domain/workforce-jp.md.
// Calculation functions receive policy records; these data guard unsupported ordinary-JP configurations.
export const JP_ORDINARY_RULES = [{
  validFrom: '2023-04-01', validTo: '2099-12-31',
  dailyLimitMinutes: 480, weeklyLimitMinutes: 2400, breakAfterMinutes: 360, breakMinutes: 45,
  longBreakAfterMinutes: 480, longBreakMinutes: 60, nightStartsMinute: 1320, nightEndsMinute: 300,
  monthlyOvertimeThresholdMinutes: 3600, overtimePremiumRate: '0.25', highOvertimePremiumRate: '0.50', holidayPremiumRate: '0.35', nightPremiumRate: '0.25',
}] as const;
