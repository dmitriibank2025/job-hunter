/** Populate canonical candidate facts for users created before candidate revisions existed. */
import { prisma } from "../infrastructure/prisma";
import { rebuildCanonicalCandidateFacts } from "../services/candidate-facts.service";

async function main() {
  const users = await prisma.appUser.findMany({ select: { id: true, email: true } });
  for (const user of users) {
    const revision = await rebuildCanonicalCandidateFacts(user.id);
    console.log(`[candidate-facts] ${user.email}: revision ${revision}`);
  }
  console.log(`[candidate-facts] Backfilled ${users.length} user(s).`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
