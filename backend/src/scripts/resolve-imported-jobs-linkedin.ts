import { prisma } from "../infrastructure/prisma";

type Candidate = {
    jobId: string;
    title: string;
    company: string;
    location: string;
    url: string;
};

type Options = {
    limit: number;
    minScore: number;
    dryRun: boolean;
    continueOnError: boolean;
};

function parseArgs(): Options {
    const limit = Number.parseInt(process.argv.find((arg) => arg.startsWith("--limit="))?.split("=")[1] ?? "50", 10);
    const minScore = Number.parseFloat(process.argv.find((arg) => arg.startsWith("--min-score="))?.split("=")[1] ?? "0.72");
    return {
        limit: Number.isFinite(limit) && limit > 0 ? limit : 50,
        minScore: Number.isFinite(minScore) ? minScore : 0.72,
        dryRun: process.argv.includes("--dry-run"),
        continueOnError: process.argv.includes("--continue-on-error"),
    };
}

function normalize(value: string) {
    return value
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9+#.]+/g, " ")
        .replace(/\b(inc|ltd|llc|limited|technologies|technology|software|systems|group|com)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function tokens(value: string) {
    return normalize(value).split(" ").filter((token) => token.length > 1);
}

function jaccard(left: string, right: string) {
    const a = new Set(tokens(left));
    const b = new Set(tokens(right));
    if (!a.size || !b.size) return 0;
    const intersection = [...a].filter((token) => b.has(token)).length;
    const union = new Set([...a, ...b]).size;
    return intersection / union;
}

function scoreCandidate(job: { title: string; company: string | null }, candidate: Candidate) {
    const titleScore = jaccard(job.title, candidate.title);
    const companyScore = jaccard(job.company ?? "", candidate.company);
    return titleScore * 0.65 + companyScore * 0.35;
}

function decodeHtml(value: string) {
    return value
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, "\"");
}

function htmlToText(value: string) {
    return decodeHtml(value)
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function textBetween(html: string, pattern: RegExp) {
    const match = pattern.exec(html);
    return match ? htmlToText(match[1] ?? "") : "";
}

function extractJobId(cardHtml: string) {
    return /data-entity-urn="urn:li:jobPosting:(\d+)"/i.exec(cardHtml)?.[1]
        ?? /data-occludable-job-id="(\d+)"/i.exec(cardHtml)?.[1]
        ?? /\/jobs\/view\/(\d+)/i.exec(cardHtml)?.[1]
        ?? "";
}

function extractJobIdFromUrl(url: string | null) {
    return url ? /\/jobs\/view\/(\d+)/i.exec(url)?.[1] ?? null : null;
}

function parseCandidates(html: string): Candidate[] {
    const cards = html
        .split(/<li\b/i)
        .slice(1)
        .map((chunk) => `<li${chunk}`);

    const candidates: Candidate[] = [];
    const seen = new Set<string>();

    for (const card of cards) {
        const jobId = extractJobId(card);
        if (!jobId || seen.has(jobId)) continue;
        seen.add(jobId);

        const title = textBetween(card, /<h3[^>]*class="[^"]*base-search-card__title[^"]*"[^>]*>([\s\S]*?)<\/h3>/i);
        const company = textBetween(card, /<h4[^>]*class="[^"]*base-search-card__subtitle[^"]*"[^>]*>([\s\S]*?)<\/h4>/i);
        const location = textBetween(card, /<span[^>]*class="[^"]*job-search-card__location[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
        if (!title) continue;

        candidates.push({
            jobId,
            title,
            company,
            location,
            url: `https://www.linkedin.com/jobs/view/${jobId}/`,
        });
    }

    return candidates;
}

async function linkedInSearch(company: string | null, title: string) {
    const query = [company, title].filter(Boolean).join(" ");
    const url = new URL("https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search");
    url.searchParams.set("keywords", query);
    url.searchParams.set("location", "Israel");
    url.searchParams.set("start", "0");

    const response = await fetch(url, {
        headers: {
            "user-agent":
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
                "(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
        },
    });

    if (!response.ok) throw new Error(`LinkedIn search failed: ${response.status}`);
    return parseCandidates(await response.text());
}

async function canUseExternalJobId(currentJobId: string, linkedInJobId: string) {
    const conflict = await prisma.job.findFirst({
        where: {
            id: { not: currentJobId },
            source: "STORAGE_IMPORT",
            externalJobId: linkedInJobId,
        },
        select: { id: true },
    });

    return !conflict;
}

async function main() {
    const options = parseArgs();
    const jobs = await prisma.job.findMany({
        where: {
            source: "STORAGE_IMPORT",
            url: null,
        },
        orderBy: { createdAt: "desc" },
        take: options.limit,
        select: {
            id: true,
            title: true,
            company: true,
        },
    });

    let resolved = 0;
    let skipped = 0;
    const failures: Array<{ id: string; title: string; company: string | null; error: string }> = [];

    console.log(`Resolving ${jobs.length} imported jobs via LinkedIn search. dryRun=${options.dryRun}`);

    if (!options.dryRun) {
        const jobsWithUrl = await prisma.job.findMany({
            where: {
                source: "STORAGE_IMPORT",
                url: { not: null },
            },
            select: {
                id: true,
                url: true,
            },
        });

        let backfilled = 0;
        let backfillConflicts = 0;
        for (const job of jobsWithUrl) {
            const jobId = extractJobIdFromUrl(job.url);
            if (!jobId) continue;
            if (!(await canUseExternalJobId(job.id, jobId))) {
                backfillConflicts += 1;
                continue;
            }
            await prisma.job.update({
                where: { id: job.id },
                data: { externalJobId: jobId },
            });
            backfilled += 1;
        }

        if (backfilled > 0) {
            console.log(`Backfilled ${backfilled} imported LinkedIn externalJobId values from existing URLs.`);
        }
        if (backfillConflicts > 0) {
            console.log(`Skipped ${backfillConflicts} externalJobId backfills because another imported row already uses that LinkedIn ID.`);
        }
    }

    for (const [index, job] of jobs.entries()) {
        process.stdout.write(`[${index + 1}/${jobs.length}] ${job.company ?? "Unknown"} | ${job.title}... `);

        try {
            const candidates = await linkedInSearch(job.company, job.title);
            const best = candidates
                .map((candidate) => ({ candidate, score: scoreCandidate(job, candidate) }))
                .sort((a, b) => b.score - a.score)[0];

            if (!best || best.score < options.minScore) {
                skipped += 1;
                console.log(`no confident match${best ? ` best=${best.score.toFixed(2)} ${best.candidate.company} | ${best.candidate.title}` : ""}`);
                continue;
            }

            if (!options.dryRun) {
                const normalizedUrlConflict = await prisma.job.findFirst({
                    where: {
                        id: { not: job.id },
                        normalizedUrl: best.candidate.url,
                    },
                    select: { id: true },
                });

                const canUseId = await canUseExternalJobId(job.id, best.candidate.jobId);
                await prisma.job.update({
                    where: { id: job.id },
                    data: {
                        ...(canUseId ? { externalJobId: best.candidate.jobId } : {}),
                        url: best.candidate.url,
                        normalizedUrl: normalizedUrlConflict ? undefined : best.candidate.url,
                    },
                });
            }

            resolved += 1;
            console.log(`ok ${best.score.toFixed(2)} -> ${best.candidate.url} (${best.candidate.company} | ${best.candidate.title})`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            failures.push({
                id: job.id,
                title: job.title,
                company: job.company,
                error: message,
            });
            console.log(`failed: ${message}`);
        }

        await new Promise((resolve) => setTimeout(resolve, 600));
    }

    console.log(JSON.stringify({
        checked: jobs.length,
        resolved,
        skipped,
        failures,
    }, null, 2));

    if (failures.length > 0 && !options.continueOnError) process.exitCode = 1;
}

main()
    .catch((error) => {
        console.error(error instanceof Error ? error.stack ?? error.message : error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
