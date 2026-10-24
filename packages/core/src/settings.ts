import { z } from 'zod';

/** Business settings stored in `app_settings` (snake_case keys in the DB, camelCase here). */
export const settingsSchema = z.object({
  allowNegativeStock: z.boolean(),
  creditLimitMode: z.enum(['off', 'warn', 'approval', 'block']),
  minPriceMode: z.enum(['off', 'approval']),
  taxBp: z.number().int().min(0).max(5000),
  roundOff: z.boolean(),
  /** Show the VAT / other charge field on company purchases (off by default). */
  purchaseCharges: z.boolean(),
  /** The utility dock on the right edge: the calculator (v1.1.1). Owner only, like every setting. */
  dockCalculator: z.boolean(),
  /** The games button in the dock. Off leaves only the calculator. */
  dockGames: z.boolean(),
  rolloverHour: z.number().int().min(0).max(8),
  language: z.enum(['en', 'bn']),
  bnDigits: z.boolean(),
  grouping: z.enum(['lakh', 'intl']),
  fontSize: z.enum(['normal', 'large', 'xlarge']),
  highContrast: z.boolean(),
  animations: z.enum(['full', 'reduced', 'off']),
  uiMode: z.enum(['simple', 'full']),
  idleLockMinutes: z.number().int().min(0).max(240),
  receiptFormat: z.enum(['a4', 'thermal80', 'thermal58']),
  printSilently: z.boolean(),
  printerName: z.string().max(200),
  bilingualHeadings: z.boolean(),
  backupAuto: z.boolean(),
  backupOnClose: z.boolean(),
  backupIntervalMinutes: z.number().int().min(5).max(1440),
  secondBackupDir: z.string().max(500),
  dataDirRecommended: z.string().max(500)
});
export type Settings = z.infer<typeof settingsSchema>;

export const SETTING_DEFAULTS: Settings = {
  allowNegativeStock: false,
  creditLimitMode: 'warn',
  minPriceMode: 'approval',
  taxBp: 0,
  roundOff: false,
  purchaseCharges: false,
  dockCalculator: true,
  dockGames: true,
  rolloverHour: 4,
  language: 'bn',
  bnDigits: true,
  grouping: 'lakh',
  fontSize: 'normal',
  highContrast: false,
  animations: 'full',
  uiMode: 'full',
  idleLockMinutes: 0,
  receiptFormat: 'a4',
  printSilently: false,
  printerName: '',
  bilingualHeadings: false,
  backupAuto: true,
  backupOnClose: true,
  backupIntervalMinutes: 30,
  secondBackupDir: '',
  dataDirRecommended: ''
};

export const businessProfileSchema = z.object({
  name: z.string().trim().min(1).max(120),
  nameBn: z.string().trim().max(120),
  address: z.string().trim().max(300),
  phone: z.string().trim().max(40),
  email: z.string().trim().max(120),
  taxNo: z.string().trim().max(60),
  footerNote: z.string().trim().max(300)
});
export type BusinessProfile = z.infer<typeof businessProfileSchema>;

/** Bangladesh mobile number: 01XXXXXXXXX (11 digits). Empty is allowed where a phone is optional. */
export function isBdMobile(s: string): boolean {
  return /^01[3-9]\d{8}$/.test(s);
}

export const ROLES = ['owner', 'manager', 'staff'] as const;
export type Role = (typeof ROLES)[number];

export interface Capabilities {
  seeCost: boolean;
  manageStock: boolean;
  voidEdit: boolean;
  fullReports: boolean;
  admin: boolean;
}

/** Plan 13.1 role matrix. Enforced again in the main process; the UI only mirrors it. */
export function capabilitiesFor(role: Role): Capabilities {
  return {
    seeCost: role !== 'staff',
    manageStock: role !== 'staff',
    voidEdit: role !== 'staff',
    fullReports: role !== 'staff',
    admin: role === 'owner'
  };
}
