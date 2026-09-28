import { norm } from '../text';

export const US_STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
}; // prettier-ignore

/** "CA" or "California" → ["California", "CA"]. */
export function stateNames(state: string): string[] {
  const upper = state.trim().toUpperCase();
  const full = US_STATES[upper];
  if (full) return [full, upper];
  const code = Object.keys(US_STATES).find((key) => norm(US_STATES[key] ?? '') === norm(state));
  return code ? [US_STATES[code] ?? state, code] : [state];
}

/** Metro areas, so "Santa Clara" and a posting in "San Francisco" count as the same place. */
const METROS: Record<string, string[]> = {
  'bay area': [
    'bay area', 'san francisco', 'south san francisco', 'san jose', 'santa clara', 'sunnyvale', 'mountain view',
    'palo alto', 'menlo park', 'redwood city', 'foster city', 'san mateo', 'burlingame', 'san carlos', 'belmont',
    'cupertino', 'milpitas', 'fremont', 'newark', 'union city', 'hayward', 'oakland', 'berkeley', 'emeryville',
    'alameda', 'san bruno', 'millbrae', 'los gatos', 'campbell', 'saratoga', 'los altos', 'pleasanton', 'livermore',
    'dublin', 'san ramon', 'walnut creek', 'brisbane', 'daly city', 'silicon valley',
  ],
  'new york': ['new york', 'nyc', 'manhattan', 'brooklyn', 'jersey city', 'hoboken'],
  seattle: ['seattle', 'bellevue', 'redmond', 'kirkland'],
  'los angeles': ['los angeles', 'santa monica', 'culver city', 'irvine', 'pasadena', 'playa vista'],
  boston: ['boston', 'cambridge', 'somerville'],
  austin: ['austin'],
}; // prettier-ignore

export function metroOf(place: string): string | null {
  const text = norm(place);
  for (const [metro, cities] of Object.entries(METROS)) {
    if (cities.some((city) => new RegExp(`(^| )${city}( |$)`).test(text))) return metro;
  }
  return null;
}

/** Whether a posting's location is where the applicant already lives. Remote postings count as local. */
export function isLocal(postingLocation: string | null, city: string): boolean | null {
  if (!postingLocation) return null;
  if (/\bremote\b/i.test(postingLocation)) return true;
  const home = metroOf(city);
  const there = metroOf(postingLocation);
  if (home && there) return home === there;
  if (norm(postingLocation).includes(norm(city))) return true;
  return null;
}

/** Large cities abroad that postings name without their country, with the country's ISO codes. */
const CITIES_ABROAD: [country: string, codes: string[], cities: string[]][] = [
  ['United Kingdom', ['GB', 'UK'], ['london', 'manchester', 'edinburgh', 'glasgow', 'belfast', 'leeds']],
  ['Ireland', ['IE'], ['dublin', 'cork', 'galway']],
  ['France', ['FR'], ['paris', 'lyon']],
  ['Germany', ['DE'], ['berlin', 'munich', 'hamburg', 'frankfurt', 'cologne', 'stuttgart']],
  ['Netherlands', ['NL'], ['amsterdam', 'rotterdam', 'the hague', 'eindhoven', 'utrecht']],
  ['Belgium', ['BE'], ['brussels', 'antwerp']],
  ['Switzerland', ['CH'], ['zurich', 'geneva', 'lausanne', 'basel']],
  ['Austria', ['AT'], ['vienna']],
  ['Sweden', ['SE'], ['stockholm', 'gothenburg', 'malmo']],
  ['Denmark', ['DK'], ['copenhagen', 'aarhus']],
  ['Norway', ['NO'], ['oslo']],
  ['Finland', ['FI'], ['helsinki']],
  ['Poland', ['PL'], ['warsaw', 'krakow', 'wroclaw', 'gdansk']],
  ['Czechia', ['CZ'], ['prague', 'brno']],
  ['Hungary', ['HU'], ['budapest']],
  ['Romania', ['RO'], ['bucharest', 'cluj']],
  ['Serbia', ['RS'], ['belgrade', 'novi sad']],
  ['Croatia', ['HR'], ['zagreb']],
  ['Bulgaria', ['BG'], ['sofia']],
  ['Portugal', ['PT'], ['lisbon', 'porto']],
  ['Spain', ['ES'], ['madrid', 'barcelona', 'valencia']],
  ['Italy', ['IT'], ['milan', 'rome', 'turin']],
  ['Estonia', ['EE'], ['tallinn']],
  ['Latvia', ['LV'], ['riga']],
  ['Lithuania', ['LT'], ['vilnius']],
  ['Ukraine', ['UA'], ['kyiv', 'kiev', 'lviv']],
  ['Turkey', ['TR'], ['istanbul', 'ankara']],
  ['Israel', ['IL'], ['tel aviv', 'jerusalem', 'haifa', 'herzliya']],
  ['United Arab Emirates', ['AE'], ['dubai', 'abu dhabi']],
  ['Qatar', ['QA'], ['doha']],
  ['Saudi Arabia', ['SA'], ['riyadh']],
  ['India', ['IN'], ['bangalore', 'bengaluru', 'hyderabad', 'pune', 'mumbai', 'delhi', 'gurgaon', 'gurugram', 'noida', 'chennai', 'kolkata', 'ahmedabad']],
  ['China', ['CN'], ['beijing', 'shanghai', 'shenzhen', 'hangzhou', 'guangzhou']],
  ['Taiwan', ['TW'], ['taipei', 'hsinchu']],
  ['Japan', ['JP'], ['tokyo', 'osaka', 'kyoto']],
  ['Korea', ['KR'], ['seoul', 'pangyo']],
  ['Australia', ['AU'], ['sydney', 'melbourne', 'brisbane', 'perth', 'canberra']],
  ['New Zealand', ['NZ'], ['auckland', 'wellington']],
  ['Canada', ['CA'], ['toronto', 'vancouver', 'montreal', 'ottawa', 'waterloo', 'calgary', 'edmonton']],
  ['Mexico', ['MX'], ['mexico city', 'guadalajara', 'monterrey']],
  ['Brazil', ['BR'], ['sao paulo', 'rio de janeiro', 'belo horizonte', 'florianopolis']],
  ['Argentina', ['AR'], ['buenos aires']],
  ['Colombia', ['CO'], ['bogota', 'medellin']],
  ['Chile', ['CL'], ['santiago']],
  ['Philippines', ['PH'], ['manila']],
  ['Indonesia', ['ID'], ['jakarta']],
  ['Malaysia', ['MY'], ['kuala lumpur']],
  ['Thailand', ['TH'], ['bangkok']],
  ['Vietnam', ['VN'], ['hanoi', 'ho chi minh']],
  ['Nigeria', ['NG'], ['lagos']],
  ['Kenya', ['KE'], ['nairobi']],
  ['South Africa', ['ZA'], ['cape town', 'johannesburg']],
  ['Egypt', ['EG'], ['cairo']],
]; // prettier-ignore

/** Large US cities, so a posting that lists one among others ("San Francisco; London") counts as American. */
const US_CITIES = [
  'san francisco', 'san jose', 'palo alto', 'mountain view', 'sunnyvale', 'menlo park', 'redwood city', 'foster city',
  'san mateo', 'santa clara', 'cupertino', 'oakland', 'berkeley', 'new york', 'nyc', 'brooklyn', 'manhattan',
  'jersey city', 'hoboken', 'seattle', 'bellevue', 'redmond', 'kirkland', 'los angeles', 'santa monica', 'irvine',
  'culver city', 'pasadena', 'san diego', 'boston', 'somerville', 'austin', 'dallas', 'houston', 'chicago', 'denver',
  'boulder', 'atlanta', 'miami', 'washington dc', 'philadelphia', 'pittsburgh', 'salt lake city', 'phoenix',
  'raleigh', 'minneapolis', 'detroit', 'ann arbor', 'nashville',
]; // prettier-ignore

const names = (text: string, place: string) => new RegExp(`(^| )${place}( |$)`).test(text);

/** A large city abroad the place names ("Belgrade" → Serbia). "Dublin, CA" is California's, so it isn't. */
export function cityAbroad(place: string): string | null {
  const text = norm(place);
  for (const [country, codes, cities] of CITIES_ABROAD) {
    const city = cities.find((name) => names(text, name));
    if (!city) continue;
    // A US state's code right after the city makes it American ("Dublin, CA"), unless it is the country's own
    // code ("Munich, DE" is Germany, not Delaware).
    const code = new RegExp(`${city.replace(/ /g, '\\W+')}\\W*,\\s*([A-Za-z]{2})\\b`, 'i')
      .exec(place)?.[1]
      ?.toUpperCase();
    if (code && US_STATES[code] && !codes.includes(code)) return null;
    return country;
  }
  return null;
}

/** The place names the US: the country, a state ("Austin, TX", "New York"), or a large US city. */
export function namesUnitedStates(place: string): boolean {
  const text = norm(place);
  if (/(^| )(united states( of america)?|usa|u s a|u s|us)( |$)/.test(text)) return true;
  if (Object.values(US_STATES).some((state) => names(text, norm(state)))) return true;
  if (US_CITIES.some((city) => names(text, city))) return true;
  // A bare code counts only when no city abroad claims it: "Munich, DE" isn't Delaware.
  if (cityAbroad(place)) return false;
  return [...place.matchAll(/(?:^|[,(/|;–-])\s*([A-Z]{2})(?=\s*(?:$|[,)/|;–-]))/g)].some(
    (match) => US_STATES[match[1] ?? ''],
  );
}
