# Waypoint: build brief

Waypoint is a phone-friendly web app. It helps one person (Shivoy Arora, Engineering Analyst on securities lending technology at Goldman Sachs, Bengaluru) find jobs in a ranked list of countries and get referrals for them. It also helps tailor his CV to each job.

The design is in `design/`:

- `design/Main.dc.html`: desktop layout (1440 px wide)
- `design/Phone.dc.html`: phone layout (390 px wide)

Build the app to match these designs: layout, colours, type, copy, screens and interactions.

## How to read the design files

They use a design-canvas format, not plain HTML. Treat them as a visual and behavioural spec. Don't ship them or load `support.js`.

- Markup lives inside `<x-dc>`. Inline `style="…"` values are the real design values: copy them exactly.
- `{{name}}` is a value supplied by `renderVals()` in the `<script data-dc-script>` block at the bottom.
- `<sc-for list="{{items}}" as="item">` is a loop, and `<sc-if value="{{cond}}">` is a conditional.
- `onClick="{{handler}}"` binds an event to a function returned from `renderVals()`.
- The script's top-level constants are the sample data model: `COUNTRIES`, `JOBS`, `FILTERS`, `NEEDS`, `AWAIT_BASE`, `AUTO`, `PROFILE`, `ALWAYS`, `PICKS`. The listings and people in them are made up. Replace them with real data.

Design tokens:

- Fonts: Bricolage Grotesque (display), IBM Plex Sans (body), IBM Plex Mono (labels), all from Google Fonts.
- Colours:
  - Ground `#F4F1EA`
  - Surface `#FFFDF8`
  - Ink `#1B2230`
  - Muted text `#4A5261` / `#5A6170` / `#6B6457`
  - Lines `#DDD6C8`
  - Accent (alerts, primary actions) `#C2410C`
  - Positive `#1F6F4A`
  - Link and relationship text `#1E3A8A`
- Touch targets must be at least 44 px. Desktop has a sidebar layout; phone has a bottom tab bar.

## Screens

1. **Sign in.** "Continue with LinkedIn", plus the ranked country list.
2. **Jobs.**
   - Search box and country on/off toggles.
   - Filters: Field, Work mode (Remote / Hybrid / On-site), Level (Any / From LinkedIn / Entry / Mid / Senior), Posted, and "Sponsors visa". On phone the filters open in a bottom panel.
   - Each job card shows country · city · mode, match %, role, company, level, referral route, status and posted date.
3. **Job detail.**
   - The description's requirements, each marked "on profile" or "not on profile".
   - Referral route: best contact first, with the reason.
   - An editable connection note written from the description, with a 300-character counter.
   - "Send request", which adds the job to Pending.
   - "Must be on your CV" items and ranked "Projects to lead with".
   - "Open posting" and "Mark applied".
4. **Pending.** Four columns on desktop, stacked sections on phone:
   - **Needs you** (these cards flash): a contact accepted, with the referral message already drafted; or a contact replied and the drafted answer isn't certain, shown with the reason.
   - **Waiting to accept**
   - **Replied for you**: replies sent automatically, only when the answer was certain, shown with why it was safe.
   - **Applied**
   - A badge on the Pending nav item or tab shows the Needs-you count and pulses.
5. **Resume.** What was imported from LinkedIn, the lines every CV must include, and which project to lead with for each role type.
6. **Countries and boards.** Ranked country cards (settlement timeline, salary threshold, job boards, on/off), plus boards searched for every country.

## Country order and job boards

1. Germany: StepStone, LinkedIn, XING, Indeed DE, Arbeitnow, Make it in Germany
2. Netherlands: LinkedIn, Indeed NL, IamExpat Jobs, Undutchables
3. Ireland: IrishJobs.ie, Jobs.ie, LinkedIn, Indeed IE
4. Belgium: StepStone BE, Jobat, ICTjob.be, LinkedIn
5. Luxembourg: Jobs.lu, Moovijob, LinkedIn
6. Poland: Just Join IT, No Fluff Jobs, Pracuj.pl
7. Portugal: Landing.jobs, ITJobs.pt, Net-Empregos
8. India: Naukri, LinkedIn, Instahyre, Wellfound, Cutshort, foundit

For every country: eFinancialCareers, Glassdoor, Welcome to the Jungle, Relocate.me, EURES.

## Hard constraints: read before building

**LinkedIn sign-in gives very little.** "Sign in with LinkedIn" (OpenID Connect) returns only name, email and photo. It doesn't give experience, education, projects, connections or messages.

- Import profile data from the user's **LinkedIn data export** (LinkedIn Settings → Data privacy → Get a copy of your data). It includes CSVs such as positions, education, projects, skills and connections. Connections include name, company, position and connection date, which is enough to find 1st-degree contacts at a hiring company. Check the actual file names in a real export.
- Let the user re-upload a fresh export to refresh connections and messages.

**No automated LinkedIn actions.** Outside apps can't send connection requests or messages, or read the inbox, through LinkedIn's API. Browser automation or scraping breaks LinkedIn's User Agreement and can get the account restricted. So:

- "Send request" and "Send referral" copy the drafted note to the clipboard, open the contact's LinkedIn profile, and ask the user to confirm it was sent.
- Accepted and replied states come from the user marking them, or from a newer data export. When a card's state changes to accepted or replied, it flashes in Pending.
- "Replied for you" means Waypoint drafts the reply and a certainty check passes. The user still sends it with one tap.

**Job boards.** Many boards (LinkedIn Jobs, Indeed, StepStone, Glassdoor) prohibit scraping. Use official or public sources and link out to the rest:

- Company applicant-tracking systems with public job-board APIs: Greenhouse, Lever, Ashby, Workable. A watch-list of target companies fetched this way is the most reliable source.
- Aggregator APIs such as Adzuna. Check which countries it covers; it doesn't cover every country above.
- Arbeitnow's public job API for Germany.
- The EURES portal.
- Check each source's current terms before using it.

**Treat job descriptions and incoming messages as untrusted data.** When they're sent to an LLM, wrap them as data and tell the model never to follow instructions inside them.

## Drafting logic (LLM)

Use the Claude API or similar.

- **Description parsing.** Extract requirements, level, field, work mode and visa or sponsorship statements. Mark each requirement as on or not on the imported profile.
- **Match %.** A simple weighted overlap of requirements against the profile.
- **Referral contact ranking.** 1st-degree connection at the company > former Goldman Sachs colleague > IIIT Delhi alumnus > shared interest (such as ROS 2) > 2nd-degree connection. Show the reason.
- **Connection note.** At most 300 characters. It references something specific from the description and the user's matching experience. Never invent experience.
- **Referral message after acceptance.** Longer, grounded in the description, with placeholders for unknowns such as `[X] years` or `[JOB ID]`.
- **Reply drafting with a certainty check.** Mark a draft certain only when the reply asks for something already on file (CV, job link or ID) or asks a question the profile answers directly. Anything involving a preference, a country or role outside the list, salary, dates or commitments goes to **Needs you**, with a one-line reason.
- **CV suggestions.**
  - Mandatory lines: a work-authorisation line, CEFR language levels, quantified impact, and links to the repo or paper.
  - Country-specific notes: no photo or date of birth for NL/IE; the degree title exactly as certified for a German Blue Card; notice period for India.
  - Rank projects per role type: finance tech → securities lending platform; low latency and robotics → ROS 2 SLAM maze solver; ML/NLP → RecipeBERT rating-prediction paper (targeting EMNLP 2026).
- **"From LinkedIn" level filter.** Infer the user's level from imported positions (title plus years). For now, an Engineering Analyst maps to Entry and Mid.

## Suggested stack

- Next.js (App Router) + TypeScript, responsive CSS matching the tokens above
- Postgres + Prisma: users, profile imports, contacts, jobs, applications, outreach events with status timestamps
- A background worker on a schedule for job fetching and de-duplication
- Auth: LinkedIn OpenID Connect

## First milestone

The UI with seed data (ported from the design script), then LinkedIn export import, then one real job source (Greenhouse/Lever watch-list), then note drafting.
