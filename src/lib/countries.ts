export type Country = {
  cc: string;
  name: string;
  rank: string;
  settle: string;
  settleShort: string;
  bar: string;
  sites: string[];
};

export const COUNTRIES: Country[] = [
  { cc: 'DE', name: 'Germany', rank: '01', settle: 'Settled status in 21 months (B1 German)', settleShort: 'Settled in 21 mo', bar: 'Blue Card, shortage role: €45,934', sites: ['StepStone', 'LinkedIn', 'XING', 'Indeed DE', 'Arbeitnow', 'Make it in Germany'] },
  { cc: 'NL', name: 'Netherlands', rank: '02', settle: 'Settled status in 5 years', settleShort: 'Settled in 5 yr', bar: 'Highly Skilled Migrant: €5,942/mo at 30+', sites: ['LinkedIn', 'Indeed NL', 'IamExpat Jobs', 'Undutchables'] },
  { cc: 'IE', name: 'Ireland', rank: '03', settle: 'Stamp 4 in 21 months', settleShort: 'Stamp 4 in 21 mo', bar: 'Critical Skills Permit: €40,904', sites: ['IrishJobs.ie', 'Jobs.ie', 'LinkedIn', 'Indeed IE'] },
  { cc: 'BE', name: 'Belgium', rank: '04', settle: 'Settled status in 5 years', settleShort: 'Settled in 5 yr', bar: 'Brussels threshold: €3,703/mo', sites: ['StepStone BE', 'Jobat', 'ICTjob.be', 'LinkedIn'] },
  { cc: 'LU', name: 'Luxembourg', rank: '05', settle: 'Settled status in 5 years', settleShort: 'Settled in 5 yr', bar: 'Blue Card: €65,652', sites: ['Jobs.lu', 'Moovijob', 'LinkedIn'] },
  { cc: 'PL', name: 'Poland', rank: '06', settle: 'Settled status in 5 years', settleShort: 'Settled in 5 yr', bar: 'Threshold: PLN 13,355/mo', sites: ['Just Join IT', 'No Fluff Jobs', 'Pracuj.pl'] },
  { cc: 'PT', name: 'Portugal', rank: '07', settle: 'Settled 5 years, citizenship 10', settleShort: 'Citizenship in 10 yr', bar: 'Pay 40–50% below Germany or NL', sites: ['Landing.jobs', 'ITJobs.pt', 'Net-Empregos'] },
  { cc: 'IN', name: 'India', rank: '08', settle: 'Home country: no work permit needed', settleShort: 'Home, no visa', bar: 'Pune, Hyderabad, Chennai, Bengaluru', sites: ['Naukri', 'LinkedIn', 'Instahyre', 'Wellfound', 'Cutshort', 'foundit'] },
];

export const GLOBAL_SITES = ['LinkedIn Jobs', 'eFinancialCareers', 'Glassdoor', 'Welcome to the Jungle', 'Relocate.me', 'EURES'];

export const VISA_ROUTE: Record<string, string> = {
  DE: 'EU Blue Card', NL: 'Highly Skilled Migrant', IE: 'Critical Skills Permit', BE: 'EU Blue Card',
  LU: 'EU Blue Card', PL: 'EU Blue Card', PT: 'EU Blue Card', IN: 'No visa needed',
};

export const countryByCc = (cc: string) => COUNTRIES.find((c) => c.cc === cc);

export const FIELDS = ['Finance tech', 'Backend', 'Trading', 'ML & NLP', 'Robotics', 'Other'] as const;
export const MODES = ['Remote', 'Hybrid', 'On-site'] as const;
export const LEVELS = ['Entry', 'Mid', 'Senior'] as const;

/** Maximum age in days for each "Posted" option. The list defaults to the
 *  tightest window, because a stale advert is usually already filled. */
export const POSTED_WINDOWS: Record<string, number> = {
  'This week': 7,
  'Last 2 weeks': 14,
  'Last 30 days': 30,
  'Any time': Infinity,
};

export const FILTER_GROUPS = [
  { key: 'field', label: 'Field', options: ['All', ...FIELDS] },
  { key: 'mode', label: 'Work mode', options: ['Any', ...MODES] },
  { key: 'level', label: 'Level', options: ['Any', 'From LinkedIn', ...LEVELS] },
  { key: 'posted', label: 'Posted', options: ['This week', 'Last 2 weeks', 'Last 30 days', 'Any time'] },
] as const;

// Country-specific CV rules the drafting prompt and the fallback both use.
export const CV_COUNTRY_RULES: Record<string, string[]> = {
  DE: ['Degree title exactly as on your certificate, for Blue Card recognition', 'Your German level with a CEFR grade, even if A1'],
  NL: ['No photo, date of birth or marital status: not expected in the Netherlands'],
  IE: ['No photo or date of birth', 'Two pages at most'],
  BE: ['Any French or Dutch you have, with CEFR level'],
  LU: ['French level, if any'],
  PL: ['Polish is not required for most tech roles: leave it off unless you have it'],
  PT: ['Portuguese level, if any'],
  IN: ['Notice period, which Indian employers ask for up front'],
};

/** What a posting in each field typically asks for. Run through `rankEvidence`
 *  against claims.yml to decide which project leads the CV for that field, so
 *  the choice follows the claim graph instead of a hand-written table. */
export const FIELD_QUERIES: { field: (typeof FIELDS)[number]; query: string }[] = [
  { field: 'Finance tech', query: 'financial platform, microservices, Spring Boot, REST APIs, distributed systems, distributed data consistency, system design, event-driven' },
  { field: 'Backend', query: 'backend services, Java, Python, Spring Boot, microservices, REST APIs, gRPC, Redis, PostgreSQL, distributed systems, AWS' },
  { field: 'Trading', query: 'low latency, C++, multithreading, networking, TCP, data structures, algorithms' },
  { field: 'ML & NLP', query: 'machine learning, deep learning, NLP, transformers, PyTorch, model evaluation, dataset annotation' },
  { field: 'Robotics', query: 'robotics, UAV, drones, autonomy, ArduPilot, flight control, SLAM, ROS' },
];
