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
  { role: 'Backend Engineer, Payments', company: 'N26', city: 'Berlin', cc: 'DE', field: 'Finance tech', mode: 'Hybrid', level: 'Mid', sponsor: true, days: 2, visa: 'EU Blue Card',
    description: 'Build the services that move money for millions of customers. You will design and run Java and Kotlin microservices on AWS, with a focus on correctness, idempotency and observability. English is our working language. We sponsor EU Blue Cards for the right candidate.' },
  { role: 'Software Engineer, Trading Platforms', company: 'Optiver', city: 'Amsterdam', cc: 'NL', field: 'Trading', mode: 'On-site', level: 'Mid', sponsor: true, days: 4, visa: 'Highly Skilled Migrant',
    description: 'Build and tune the systems our traders use. Strong algorithms and mathematics are essential. You will work in C++ or Java on Linux, profiling and removing latency from the critical path of an order flow. Relocation support and Highly Skilled Migrant sponsorship are provided.' },
  { role: 'Backend Engineer, Ledger', company: 'Stripe', city: 'Dublin', cc: 'IE', field: 'Backend', mode: 'Hybrid', level: 'Mid', sponsor: true, days: 7, visa: 'Critical Skills Permit',
    description: 'The Ledger team owns financial correctness at scale: every movement of money is recorded, reconciled and auditable. You will design APIs and distributed systems in Ruby, Java or Go. We support Critical Skills Permit applications.' },
  { role: 'Java Developer, Settlement Platform', company: 'Euroclear', city: 'Brussels', cc: 'BE', field: 'Finance tech', mode: 'Hybrid', level: 'Mid', sponsor: true, days: 3, visa: 'EU Blue Card',
    description: 'Work on post-trade settlement services in the capital markets back office. Java and Spring Boot are our stack, with PostgreSQL and Kafka. French or Dutch is a plus, not a requirement. Visa sponsorship available.' },
  { role: 'Software Engineer, Distributed Systems', company: 'Amazon', city: 'Luxembourg', cc: 'LU', field: 'Backend', mode: 'On-site', level: 'Mid', sponsor: true, days: 5, visa: 'EU Blue Card',
    description: 'Design and operate large-scale distributed services. Java or C++, strong data structures and system design, and experience running production services. Blue Card sponsorship offered.' },
  { role: 'Backend Developer, Search', company: 'Allegro', city: 'Warsaw', cc: 'PL', field: 'Backend', mode: 'Hybrid', level: 'Entry', sponsor: true, days: 6, visa: 'Work permit support',
    description: 'Build the search and recommendation services behind a large e-commerce marketplace in Java and Kotlin. Polish is not required. Work permit support available.' },
  { role: 'Machine Learning Engineer, Language Models', company: 'DeepL', city: 'Cologne', cc: 'DE', field: 'ML & NLP', mode: 'Remote', level: 'Senior', sponsor: true, days: 1, visa: 'EU Blue Card',
    description: 'Fine-tune and evaluate transformer models for translation and writing. Research publications are valued. Large-scale training experience and production PyTorch required. Relocation and Blue Card sponsorship supported.' },
  { role: 'Robotics Software Engineer', company: 'Wandelbots', city: 'Dresden', cc: 'DE', field: 'Robotics', mode: 'Remote', level: 'Mid', sponsor: false, days: 9, visa: 'Sponsorship not stated',
    description: 'Build robot software on ROS 2. You will work with perception and motion planning for industrial robot arms, in C++ in production. Remote within Germany.' },
  { role: 'Software Engineer, Backend', company: 'Razorpay', city: 'Bengaluru', cc: 'IN', field: 'Finance tech', mode: 'On-site', level: 'Mid', sponsor: true, days: 3, visa: 'No visa needed',
    description: 'Build payment APIs and the services behind them in Go and Java: high availability, reconciliation and observability on AWS.' },
];

async function main() {
  const email = process.env.WAYPOINT_EMAIL || 'you@local';
  const name = process.env.WAYPOINT_NAME || 'Your Name';

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
        title: 'Software Engineer',
        company: 'Example Company',
        location: 'Your city',
        startedAt: new Date('2024-07-01'),
        summary: '[Placeholder] Replace with your own role by importing your LinkedIn export',
      },
    });
    await db.education.create({
      data: { userId: user.id, school: 'Your university', degree: 'B.Tech', field: 'Computer Science', years: '[Add years]' },
    });
    await db.projectItem.createMany({
      data: [
        { userId: user.id, title: 'Sample backend project', org: 'Personal project', description: '[Placeholder] A REST service with a database behind it', tags: 'backend,distributed systems' },
        { userId: user.id, title: 'Sample machine learning project', org: 'Personal project', description: '[Placeholder] A model trained and evaluated on a public dataset', tags: 'machine learning,NLP' },
      ],
    });
    await db.skill.createMany({
      data: ['Python', 'Java', 'SQL', 'Distributed systems', 'Machine learning'].map((n) => ({ userId: user.id, name: n })),
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
