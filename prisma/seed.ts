/* Seed: demo users (admin + member + guest), events from the prototype, sample CPE. Tier data lives in src/config/site.ts. */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { tiers } from "../src/config/site";
const db = new PrismaClient();
const at = (iso: string) => new Date(iso);

async function main() {
  await db.registration.deleteMany(); await db.cpeEntry.deleteMany(); await db.membership.deleteMany(); await db.event.deleteMany(); await db.user.deleteMany(); await db.auditLog.deleteMany(); await db.loginThrottle.deleteMany();
  const pw = await bcrypt.hash("Password123!", 10);
  const admin = await db.user.create({ data: { email: "admin@adaig.test", name: "ADAIG Staff Admin", passwordHash: pw, role: "admin", organisation: "ADAIG", country: "United States", province: "NY" } });
  await db.user.create({ data: { email: "admin2@adaig.test", name: "ADAIG Second Admin", passwordHash: pw, role: "admin", organisation: "ADAIG", country: "United States", province: "DC", locale: "fr" } }); // backup admin (BUG-031)
  const member = await db.user.create({ data: { email: "member@adaig.test", name: "Jordan Member", passwordHash: pw, role: "member", organisation: "Sample Records Office", jobTitle: "Records Manager", country: "United States", province: "NY" } });
  await db.user.create({ data: { email: "guest@adaig.test", name: "Casey Guest", passwordHash: pw, role: "guest", organisation: "Independent" } });
  const year = (d: Date) => { const r = new Date(d); r.setFullYear(d.getFullYear() + 1); return r; };
  const start = new Date(Date.now() - 337 * 864e5);
  const pro = tiers.find((t) => t.id === "professional")!;
  await db.membership.create({ data: { userId: member.id, tierId: pro.id, status: "active", currency: "USD", amountCents: pro.price.USD, taxCents: 0, startsAt: start, renewsAt: year(start), paymentRef: "seed" } });
  await db.membership.create({ data: { userId: admin.id, tierId: pro.id, status: "active", currency: "USD", amountCents: pro.price.USD, startsAt: new Date(), renewsAt: year(new Date()), paymentRef: "seed" } });
  const evs = [
    { slug: "ai-risk-register", title: "Operationalizing an AI risk register", titleFr: "Opérationnaliser un registre des risques liés à l’IA", summary: "A practical session on building and maintaining an AI system inventory and risk register, and keeping it current as AI use in your organization grows.", summaryFr: "Une séance pratique sur la création et la tenue à jour d’un inventaire des systèmes d’IA et d’un registre des risques, à mesure que l’utilisation de l’IA progresse dans votre organisation.", type: "Webinar", format: "Online", startsAt: at("2026-11-12T17:00:00Z"), durationMin: 60, cpe: 1, memberPriceCents: 0, publicPriceCents: null },
    { slug: "records-retention-genai", title: "Records retention in the age of generative AI", titleFr: "Conservation des documents à l’ère de l’IA générative", summary: "How retention schedules and legal holds apply to generative AI prompts, outputs and logs.", summaryFr: "Comment les calendriers de conservation et les mises en suspens pour litige s’appliquent aux requêtes, aux résultats et aux journaux de l’IA générative.", type: "Webinar", format: "Online", startsAt: at("2026-11-26T17:00:00Z"), durationMin: 90, cpe: 1.5, memberPriceCents: 0, publicPriceCents: 4900 },
    { slug: "new-york-meetup", title: "New York chapter meetup (proposed)", titleFr: "Rencontre de la section de New York (proposée)", summary: "A proposed in-person meetup for members in the New York area, with networking and short lightning talks.", summaryFr: "Une rencontre en personne proposée pour les membres de la région de New York, avec réseautage et courtes présentations éclair.", type: "Chapter", format: "In person", location: "New York, NY", startsAt: at("2026-12-04T23:00:00Z"), durationMin: 120, cpe: 2, memberPriceCents: 0, publicPriceCents: 2500 },
    { slug: "summit-2027", title: "ADAIG Summit 2027 (proposed)", titleFr: "Sommet ADAIG 2027 (proposé)", summary: "A proposed annual ADAIG summit bringing members together on data and AI governance. Date, venue, program and pricing are still to be confirmed.", summaryFr: "Un sommet annuel de l’ADAIG proposé, réunissant les membres autour de la gouvernance des données et de l’IA. La date, le lieu, le programme et les tarifs restent à confirmer.", type: "Conference", format: "Hybrid", location: "Venue to be confirmed", startsAt: at("2027-05-21T13:00:00Z"), durationMin: 480, cpe: 12, memberPriceCents: 39500, publicPriceCents: 59500 },
  ];
  for (const e of evs) await db.event.create({ data: e });
  const first = await db.event.findUniqueOrThrow({ where: { slug: "ai-risk-register" } });
  await db.registration.create({ data: { userId: member.id, eventId: first.id, ticket: "member" } });
  for (const [title, hours] of [["Privacy law update webinar", 4], ["Records conference session", 6], ["Self-study: AI governance reading", 4]] as const)
    await db.cpeEntry.create({ data: { userId: member.id, title, hours } });
  await db.auditLog.create({ data: { actor: "seed", action: "seed.completed" } });
  console.log("Seeded. Logins (password Password123!): admin@adaig.test, admin2@adaig.test, member@adaig.test, guest@adaig.test");
}
main().finally(() => db.$disconnect());
