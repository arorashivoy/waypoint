import { PrismaClient } from '@prisma/client';
import { COUNTRIES } from '../src/lib/countries';

const db = new PrismaClient();

const SEED_SAMPLES = process.env.WAYPOINT_SEED_SAMPLES === '1';

/**
 * Seeds the single local account plus the sample listings ported from the design
 * file, so the UI is populated before any network call. Two deliberate choices:
 *
 *  - Sample jobs are marked source 'Sample' and link to a LinkedIn search, not a
 *    fabricated posting URL. Pressing "Refresh feeds" brings in real openings.
 *  - No contacts are seeded. Inventing connections would produce referral routes
 *    to people who do not exist; an empty route list correctly says "import your
 *    export first".
 */

const SAMPLE_JOBS = [
  { role: 'Software Engineer, Securities Finance', company: 'Goldman Sachs Bank Europe SE', city: 'Frankfurt', cc: 'DE', field: 'Finance tech', mode: 'Hybrid', level: 'Mid', sponsor: true, days: 2, visa: 'EU Blue Card',
    description: 'Join the Securities Finance engineering team building the platform behind securities lending and financing. You will design and run production systems in a regulated bank, working closely with the trading desk on lender and borrower matching, collateral optimisation and books-and-records correctness. Java and Spring are our primary stack. German at B1 is a plus. We sponsor EU Blue Cards for the right candidate.' },
  { role: 'Software Engineer, Trading Platforms', company: 'Optiver', city: 'Amsterdam', cc: 'NL', field: 'Trading', mode: 'On-site', level: 'Mid', sponsor: true, days: 4, visa: 'Highly Skilled Migrant',
    description: 'Build and tune the systems our traders use. Strong algorithms and mathematics are essential. You will work in C++ or Java on Linux, profiling and removing latency from the critical path of an order flow. Relocation support and Highly Skilled Migrant sponsorship are provided.' },
  { role: 'Backend Engineer, Ledger', company: 'Stripe', city: 'Dublin', cc: 'IE', field: 'Backend', mode: 'Hybrid', level: 'Mid', sponsor: true, days: 7, visa: 'Critical Skills Permit',
    description: 'The Ledger team owns financial correctness at scale: every movement of money is recorded, reconciled and auditable. You will design APIs and distributed systems in Ruby, Java or Go. We support Critical Skills Permit applications.' },
  { role: 'Java Developer, Collateral Management', company: 'Euroclear', city: 'Brussels', cc: 'BE', field: 'Finance tech', mode: 'Hybrid', level: 'Mid', sponsor: true, days: 3, visa: 'EU Blue Card',
    description: 'Work on collateral and securities lending flows in the capital markets back office. Java is our stack. French or Dutch is a plus, not a requirement. Visa sponsorship available.' },
  { role: 'Software Engineer, Securities Lending', company: 'Clearstream', city: 'Luxembourg', cc: 'LU', field: 'Finance tech', mode: 'On-site', level: 'Senior', sponsor: true, days: 5, visa: 'EU Blue Card',
    description: 'Engineer the securities lending programme: lender and borrower matching, fee calculation and settlement instructions. Java, strong systems design, several years of relevant experience. French is a plus. Blue Card sponsorship offered.' },
  { role: 'Engineering Analyst, Securities', company: 'Goldman Sachs', city: 'Warsaw', cc: 'PL', field: 'Finance tech', mode: 'Hybrid', level: 'Entry', sponsor: true, days: 6, visa: 'Internal mobility',
    description: 'Securities division engineering on the Warsaw campus. Design, build, test and maintain systems in the securities domain. Polish is not required. Internal mobility candidates welcome.' },
  { role: 'Robotics Software Engineer, ROS 2', company: 'Wandelbots', city: 'Dresden', cc: 'DE', field: 'Robotics', mode: 'Remote', level: 'Mid', sponsor: false, days: 9, visa: 'Sponsorship not stated',
    description: 'Build robot software on ROS 2. You will work with SLAM, point clouds and motion planning for industrial robot arms, in C++ in production. Remote within Germany.' },
  { role: 'Machine Learning Engineer, Language Models', company: 'DeepL', city: 'Cologne', cc: 'DE', field: 'ML & NLP', mode: 'Remote', level: 'Senior', sponsor: true, days: 1, visa: 'EU Blue Card',
    description: 'Fine-tune and evaluate transformer models for translation and writing. Research publications are valued. Large-scale training experience and production PyTorch required. Relocation and Blue Card sponsorship supported.' },
  { role: 'Robotics Software Engineer, Autonomy', company: 'Ati Motors', city: 'Bengaluru', cc: 'IN', field: 'Robotics', mode: 'On-site', level: 'Mid', sponsor: true, days: 3, visa: 'No visa needed',
    description: 'Autonomy stack for industrial mobile robots: ROS 2, SLAM and localisation, C++ in production, and field testing on real hardware in customer plants.' },
];

async function main() {
  const email = process.env.WAYPOINT_EMAIL || 'you@local';
  const name = process.env.WAYPOINT_NAME || 'Shivoy Arora';

  const user = await db.user.upsert({ where: { email }, update: { name }, create: { email, name } });

  for (const [i, c] of COUNTRIES.entries()) {
    await db.countryPref.upsert({
      where: { userId_cc: { userId: user.id, cc: c.cc } },
      update: { rank: i },
      create: { userId: user.id, cc: c.cc, rank: i, on: true },
    });
  }

  if (!SEED_SAMPLES) {
    console.log(`Ready for ${name} <${email}> with ${COUNTRIES.length} countries.`);
    console.log('No profile or listings seeded. Import your LinkedIn export on the Resume screen,');
    console.log('then press "Refresh feeds" on the Jobs screen.');
    console.log('(Set WAYPOINT_SEED_SAMPLES=1 to seed placeholder data instead.)');
    return;
  }

  // Everything below is placeholder data, behind the flag.
  if ((await db.position.count({ where: { userId: user.id } })) === 0) {
    await db.position.create({
      data: {
        userId: user.id,
        title: 'Engineering Analyst',
        company: 'Goldman Sachs Services',
        location: 'Bengaluru',
        startedAt: new Date('2024-07-01'),
        summary: 'Global Banking & Markets: design, build, test and maintain securities lending systems',
      },
    });
    await db.education.create({
      data: { userId: user.id, school: 'IIIT Delhi', degree: 'B.Tech', field: 'Computer Science and Applied Mathematics', years: '[Add years]' },
    });
    await db.projectItem.createMany({
      data: [
        { userId: user.id, title: 'ROS 2 SLAM maze solver', org: 'Personal project', description: 'ICP point-cloud registration, KD-trees, pose-graph SLAM with Gauss-Newton optimisation', tags: 'ROS 2,SLAM,robotics,optimisation' },
        { userId: user.id, title: 'RecipeBERT rating prediction', org: 'Research paper · targeting EMNLP 2026', description: 'Fine-tuned RecipeBERT to predict ratings from recipe reviews', tags: 'NLP,BERT,machine learning' },
        { userId: user.id, title: 'Securities lending platform', org: 'Goldman Sachs', description: 'Production securities lending systems in Global Banking & Markets', tags: 'securities lending,finance' },
      ],
    });
    await db.skill.createMany({
      data: ['Python', 'Java', 'C++', 'Securities lending', 'Distributed systems', 'ROS 2', 'PyTorch', 'SQL'].map((n) => ({ userId: user.id, name: n })),
    });
  }

  for (const j of SAMPLE_JOBS) {
    const externalId = `sample:${j.company}:${j.role}`.toLowerCase().replace(/[^a-z0-9:]+/g, '-');
    await db.job.upsert({
      where: { externalId },
      update: {},
      create: {
        externalId,
        source: 'Sample',
        role: j.role,
        company: j.company,
        city: j.city,
        cc: j.cc,
        url: `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(`${j.role} ${j.company}`)}`,
        mode: j.mode,
        field: j.field,
        level: j.level,
        sponsor: j.sponsor,
        visa: j.visa,
        description: j.description,
        postedAt: new Date(Date.now() - j.days * 86_400_000),
      },
    });
  }

  console.log(`Seeded ${name} <${email}> with ${SAMPLE_JOBS.length} PLACEHOLDER listings and a placeholder profile.`);
  console.log('These are not real. Import your LinkedIn export and press "Refresh feeds" to replace them.');
}

main().finally(() => db.$disconnect());
