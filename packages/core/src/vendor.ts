/**
 * Who made the software. PetraDMS (one word) is the product; Petra is the company that makes it. Both are shown
 * quietly at the bottom of the sidebar and in Help > About; the trader's own name and logo are what the app shows at
 * the top. This is the only place these names and the support contact live.
 */
export const VENDOR = {
  /** The maker: the company. */
  companyName: 'Petra',
  /** The product, always one word. */
  productName: 'PetraDMS',
  /** Support contact; empty fields are not shown. Fill them before handing the installer to customers. */
  supportPhone: '',
  supportEmail: '',
  website: ''
} as const;

/** Largest logo accepted, in bytes of image data. */
export const LOGO_MAX_BYTES = 256 * 1024;
export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
