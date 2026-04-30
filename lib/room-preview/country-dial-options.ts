// Client-safe — no server-only imports.
// Add new countries here; everything else picks them up automatically.

export interface CountryDialOption {
  countryCode: string; // ISO 3166-1 alpha-2
  dialCode: string;    // E.164 prefix, e.g. "+966"
  flag: string;        // emoji flag
  nameAr: string;
  nameEn: string;
}

export const COUNTRY_DIAL_OPTIONS: CountryDialOption[] = [
  { countryCode: "SA", dialCode: "+966", flag: "🇸🇦", nameAr: "السعودية", nameEn: "Saudi Arabia" },
  { countryCode: "AE", dialCode: "+971", flag: "🇦🇪", nameAr: "الإمارات", nameEn: "UAE" },
  { countryCode: "KW", dialCode: "+965", flag: "🇰🇼", nameAr: "الكويت",   nameEn: "Kuwait" },
  { countryCode: "QA", dialCode: "+974", flag: "🇶🇦", nameAr: "قطر",      nameEn: "Qatar" },
  { countryCode: "BH", dialCode: "+973", flag: "🇧🇭", nameAr: "البحرين",  nameEn: "Bahrain" },
  { countryCode: "OM", dialCode: "+968", flag: "🇴🇲", nameAr: "عمان",     nameEn: "Oman" },
  { countryCode: "JO", dialCode: "+962", flag: "🇯🇴", nameAr: "الأردن",   nameEn: "Jordan" },
  { countryCode: "EG", dialCode: "+20",  flag: "🇪🇬", nameAr: "مصر",      nameEn: "Egypt" },
  { countryCode: "SY", dialCode: "+963", flag: "🇸🇾", nameAr: "سوريا",    nameEn: "Syria" },
  { countryCode: "LB", dialCode: "+961", flag: "🇱🇧", nameAr: "لبنان",    nameEn: "Lebanon" },
];

export const DEFAULT_COUNTRY = COUNTRY_DIAL_OPTIONS[0]!; // Saudi Arabia

export function getCountryByCode(code: string): CountryDialOption {
  return COUNTRY_DIAL_OPTIONS.find((c) => c.countryCode === code) ?? DEFAULT_COUNTRY;
}
