// State/province/canton lists for the checkout's shipping-country dropdown.
//
// Shopify's shipping-carrier address check (help.shopify.com/.../reviewing-
// address-formats) requires a state/province for countries that have them —
// an address missing it gets flagged "Review address issues" even if every
// other field is perfectly formatted. Countries not listed here (Israel,
// United Kingdom, the "Europe" zone) don't use a province field in Shopify.

export interface StateOption {
  code: string
  name: string
}

const US_STATES: StateOption[] = [
  { code: 'AL', name: 'Alabama' }, { code: 'AK', name: 'Alaska' }, { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' }, { code: 'CA', name: 'California' }, { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' }, { code: 'DE', name: 'Delaware' }, { code: 'DC', name: 'District of Columbia' },
  { code: 'FL', name: 'Florida' }, { code: 'GA', name: 'Georgia' }, { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' }, { code: 'IL', name: 'Illinois' }, { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' }, { code: 'KS', name: 'Kansas' }, { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' }, { code: 'ME', name: 'Maine' }, { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' }, { code: 'MI', name: 'Michigan' }, { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' }, { code: 'MO', name: 'Missouri' }, { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' }, { code: 'NV', name: 'Nevada' }, { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' }, { code: 'NM', name: 'New Mexico' }, { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' }, { code: 'ND', name: 'North Dakota' }, { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' }, { code: 'OR', name: 'Oregon' }, { code: 'PA', name: 'Pennsylvania' },
  { code: 'PR', name: 'Puerto Rico' }, { code: 'RI', name: 'Rhode Island' }, { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' }, { code: 'TN', name: 'Tennessee' }, { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' }, { code: 'VT', name: 'Vermont' }, { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' }, { code: 'WV', name: 'West Virginia' }, { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
]

const CA_PROVINCES: StateOption[] = [
  { code: 'AB', name: 'Alberta' }, { code: 'BC', name: 'British Columbia' }, { code: 'MB', name: 'Manitoba' },
  { code: 'NB', name: 'New Brunswick' }, { code: 'NL', name: 'Newfoundland and Labrador' },
  { code: 'NS', name: 'Nova Scotia' }, { code: 'NT', name: 'Northwest Territories' }, { code: 'NU', name: 'Nunavut' },
  { code: 'ON', name: 'Ontario' }, { code: 'PE', name: 'Prince Edward Island' }, { code: 'QC', name: 'Quebec' },
  { code: 'SK', name: 'Saskatchewan' }, { code: 'YT', name: 'Yukon' },
]

const AU_STATES: StateOption[] = [
  { code: 'ACT', name: 'Australian Capital Territory' }, { code: 'NSW', name: 'New South Wales' },
  { code: 'NT', name: 'Northern Territory' }, { code: 'QLD', name: 'Queensland' },
  { code: 'SA', name: 'South Australia' }, { code: 'TAS', name: 'Tasmania' },
  { code: 'VIC', name: 'Victoria' }, { code: 'WA', name: 'Western Australia' },
]

const CH_CANTONS: StateOption[] = [
  { code: 'AG', name: 'Aargau' }, { code: 'AI', name: 'Appenzell Innerrhoden' },
  { code: 'AR', name: 'Appenzell Ausserrhoden' }, { code: 'BE', name: 'Bern' }, { code: 'BL', name: 'Basel-Landschaft' },
  { code: 'BS', name: 'Basel-Stadt' }, { code: 'FR', name: 'Fribourg' }, { code: 'GE', name: 'Geneva' },
  { code: 'GL', name: 'Glarus' }, { code: 'GR', name: 'Graubünden' }, { code: 'JU', name: 'Jura' },
  { code: 'LU', name: 'Luzern' }, { code: 'NE', name: 'Neuchâtel' }, { code: 'NW', name: 'Nidwalden' },
  { code: 'OW', name: 'Obwalden' }, { code: 'SG', name: 'St. Gallen' }, { code: 'SH', name: 'Schaffhausen' },
  { code: 'SO', name: 'Solothurn' }, { code: 'SZ', name: 'Schwyz' }, { code: 'TG', name: 'Thurgau' },
  { code: 'TI', name: 'Ticino' }, { code: 'UR', name: 'Uri' }, { code: 'VD', name: 'Vaud' },
  { code: 'VS', name: 'Valais' }, { code: 'ZG', name: 'Zug' }, { code: 'ZH', name: 'Zürich' },
]

export const COUNTRY_STATES: Record<string, StateOption[]> = {
  'United States': US_STATES,
  Canada: CA_PROVINCES,
  Australia: AU_STATES,
  Switzerland: CH_CANTONS,
}

export function getStateName(country: string, code: string): string {
  return COUNTRY_STATES[country]?.find((s) => s.code === code)?.name || code
}
