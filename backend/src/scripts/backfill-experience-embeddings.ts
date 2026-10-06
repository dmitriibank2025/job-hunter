/** Rebuild versioned RAG chunks from canonical CandidateFact rows. */
import "dotenv/config";
import { prisma } from "../infrastructure/prisma";
import { processCandidateIndexJob } from "../services/candidate-index.service";
import { countUserChunks } from "../services/embedding.service";

function getArg(flag: string): string | undefined {
    const hit = process.argv.find((value) => value.startsWith(`--${flag}=`));
    return hit?.split("=").slice(1).join("=").trim() || undefined;
}

async function main() {
    const email = getArg("email")?.toLowerCase();
    const users = await prisma.appUser.findMany({
        where: email ? { email } : undefined,
        select: { id: true, email: true, candidateRevision: true },
        orderBy: { createdAt: "asc" },
    });
    if (!users.length) throw new Error(email ? `No user found for ${email}` : "No users found");

    for (const user of users) {
        const job = await prisma.candidateIndexJob.upsert({
            where: { userId_revision: { userId: user.id, revision: user.candidateRevision } },
            create: { userId: user.id, revision: user.candidateRevision, status: "PENDING" },
            update: { status: "PENDING", attempts: 0, lastError: null },
            select: { id: true },
        });
        const status = await processCandidateIndexJob(job.id);
        const chunks = await countUserChunks(user.id);
        console.log(`${user.email}: revision=${user.candidateRevision}, status=${status}, activeChunks=${chunks}`);
    }
}

main()
    .catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    })
    .finally(async () => prisma.$disconnect());
