/**
 * Backfill the candidate experience corpus for RAG.
 *
 * Parses the honest base resumes (src/data/base-resumes/*.md), extracts each
 * experience/project bullet as a chunk tagged with its role/company, embeds them
 * (text-embedding-3-small), and stores them in ExperienceChunk (pgvector).
 *
 * Usage: tsx src/scripts/backfill-experience-embeddings.ts --email=user@example.com
 */
import fs from "fs";
import path from "path";
import { replaceUserChunks, retrieveRelevantChunks } from "../services/embedding.service";
import { prisma } from "../infrastructure/prisma";

function getArg(flag: string): string | undefined {
    const hit = process.argv.find((a) => a.startsWith(`--${flag}=`));
    return hit?.split("=").slice(1).join("=").trim() || undefined;
}

/** Extract {source, text} chunks from a base resume markdown file. */
function chunksFromBase(file: string): { source: string; text: string }[] {
    const lines = fs.readFileSync(file, "utf-8").split("\n");
    const out: { source: string; text: string }[] = [];
    let source = path.basename(file, ".md");
    for (const raw of lines) {
        const line = raw.trim();
        // Role/company header: "2024 – Present | Title | Company (Location)"
        const header = line.match(/^\d{4}.*\|\s*([^|]+?)\s*(?:\||$)/);
        if (header && line.includes("|")) {
            const parts = line.split("|").map((p) => p.trim());
            source = parts.slice(1, 3).join(" — ") || source;
            continue;
        }
        if (line.startsWith("• ")) {
            out.push({ source, text: line.slice(2).trim() });
        }
    }
    return out;
}

async function main() {
    const email = getArg("email");
    const user = email
        ? await prisma.appUser.findUniqueOrThrow({ where: { email }, select: { id: true, email: true } })
        : (await prisma.appUser.findMany({ select: { id: true, email: true } }))[0];
    if (!user) throw new Error("No user found; pass --email=");

    const dir = path.join(__dirname, "..", "data", "base-resumes");
    const files = ["fullstack.md", "backend.md", "frontend.md"].map((f) => path.join(dir, f));
    const seen = new Set<string>();
    const chunks: { source: string; text: string }[] = [];
    for (const f of files) {
        for (const c of chunksFromBase(f)) {
            if (seen.has(c.text)) continue; // dedupe identical bullets across bases
            seen.add(c.text);
            chunks.push(c);
        }
    }

    console.log(`Embedding ${chunks.length} experience chunks for ${user.email}...`);
    const n = await replaceUserChunks(user.id, chunks);
    console.log(`Stored ${n} chunks.`);

    // Smoke-test retrieval
    const probe = "event-driven backend with AWS Lambda, SQS, and idempotent processing";
    const top = await retrieveRelevantChunks(user.id, probe, 3);
    console.log(`\nRetrieval smoke-test for: "${probe}"`);
    for (const r of top) console.log(`  [${r.distance.toFixed(3)}] (${r.source}) ${r.text.slice(0, 80)}`);
}

main()
    .catch((err) => {
        console.error(err instanceof Error ? err.message : err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
