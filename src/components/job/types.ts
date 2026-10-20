export type Requirement = {
  text: string;
  importance: 'must' | 'nice';
  status: 'met' | 'partial' | 'missing';
  /** Claim labels, not slugs. */
  evidence: string[];
};

export type Blocker = { type: string; quote: string };

export type ChatTurn = { role: 'you' | 'claude'; text: string; at?: string };

export type Cv = {
  pdfUrl: string;
  driveUrl: string | null;
  /** When the PDF was written. */
  builtAt?: string | null;
  driveReason?: string | null;
  tailored?: boolean;
  lead?: string | null;
  projects?: string[];
  bullets?: string[];
  skills?: string[];
  reason?: string | null;
  chat: ChatTurn[];
};

export type Wording = {
  suggestions: { dropped: number; items: { bulletId: string; text: string; old: string; labels: string[]; status: 'pending' | 'accepted' | 'rejected' }[] };
  keywords: { inResume: string[]; missingWithEvidence: string[] };
};

export type Route = { name: string; init: string; role: string; why: string; best: boolean };

export type Referral = { copy: string; open: string | null; name: string; alumni?: boolean };

/** What GET /api/jobs/<id> sends. */
export type JobView = {
  id: string;
  role: string;
  company: string;
  city: string;
  cc: string;
  place: string;
  url: string;
  sourceList: string;
  postedAt: string;
  mode: string;
  visa: string;
  summary: string;
  by: string;
  blockers: Blocker[];
  legitimacy: string[];
  requirements: Requirement[];
  parts: { label: string; points: number }[];
  must: string[];
  projects: { rank: string; n: string; why: string }[];
  routes: Route[];
  match: number;
  analysing: string | null;
  warning: string | null;
  referral: Referral | null;
  alumni: { school: string; url: string } | null;
  wording: Wording | null;
  isSent: boolean;
  isApplied: boolean;
  cv: Cv | null;
};

export type CvBusy = 'generate' | 'refine' | 'reset' | 'suggest' | null;

/** The state of the open job and what the sections can do to it. */
export interface JobDetailState {
  job: JobView;
  cv: Cv | null;
  wording: Wording | null;
  busy: 'send' | 'alumni' | null;
  cvBusy: CvBusy;
  /** The error of a CV action, shown next to the button. */
  cvError: string | null;
  /** True when the browser blocked the new tab. */
  blocked: boolean;
  /** The error of the way in actions, shown next to them. */
  wayError: string | null;
  /** Counts up each time a CV action ends, so the preview loads the file again. */
  cvRev: number;
  /** Why "Suggest wording" cannot run, in words for the user. Null when Claude is on. */
  claudeNote: string | null;
  findContact: () => Promise<void>;
  findAlumni: () => Promise<void>;
  markApplied: () => Promise<void>;
  generate: () => Promise<boolean>;
  refine: (message: string) => Promise<boolean>;
  reset: () => Promise<boolean>;
  suggest: () => Promise<boolean>;
  decide: (bulletId: string, action: 'accept' | 'reject') => Promise<boolean>;
  setToast: (s: string) => void;
}

export type Part = 'wayin' | 'cv';
