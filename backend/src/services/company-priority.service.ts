import { prisma } from "../infrastructure/prisma";
import { ParsedJob } from "../providers/types";

export type CompanyPrioritySeed = {
    name: string;
    locationHint?: string;
    careerUrl?: string;
};

export type PrioritizedCompanyTarget = CompanyPrioritySeed & {
    priority: number;
    active: boolean;
    nextCheckAt?: Date | null;
    lastFoundAt?: Date | null;
    consecutiveNoJobs: number;
};

function normalizeCompanyName(value?: string | null): string {
    return (value ?? "")
        .replace(/\b(israel|ltd|limited|inc|corp|corporation|technologies|technology)\b/gi, "")
        .replace(/[^a-z0-9]+/gi, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

function clampPriority(value: number): number {
    return Math.max(0, Math.min(100, Math.round(value)));
}

function cooldownFor(priority: number, consecutiveNoJobs: number, foundJobs: boolean): Date {
    const now = Date.now();

    if (foundJobs || priority >= 75) return new Date(now + 24 * 60 * 60 * 1000);
    if (priority >= 50) return new Date(now + Math.max(2, consecutiveNoJobs + 1) * 24 * 60 * 60 * 1000);
    if (priority >= 25) return new Date(now + Math.max(4, consecutiveNoJobs + 2) * 24 * 60 * 60 * 1000);

    return new Date(now + Math.max(7, consecutiveNoJobs + 3) * 24 * 60 * 60 * 1000);
}

async function upsertSeedCompany(company: CompanyPrioritySeed) {
    const normalizedName = normalizeCompanyName(company.name);
    if (!normalizedName) return;

    await prisma.companyPriorityTarget.upsert({
        where: { normalizedName },
        create: {
            name: company.name,
            normalizedName,
            locationHint: company.locationHint,
            careerUrl: company.careerUrl,
            priority: 50,
            active: false,
        },
        update: {
            name: company.name,
            locationHint: company.locationHint,
            careerUrl: company.careerUrl,
        },
    });
}

export async function seedCompanyPriorityTargets(companies: CompanyPrioritySeed[]) {
    for (const company of companies) {
        await upsertSeedCompany(company);
    }
}

export async function getPrioritizedCompanyTargets(
    companies: CompanyPrioritySeed[],
    options: { limit?: number; includeCooldown?: boolean } = {},
): Promise<PrioritizedCompanyTarget[]> {
    await seedCompanyPriorityTargets(companies);

    const limit = Math.max(1, options.limit ?? Number(process.env.CENTER_ISRAEL_ACTIVE_COMPANY_LIMIT ?? 100));
    const now = new Date();
    const rows = await prisma.companyPriorityTarget.findMany({
        where: options.includeCooldown
            ? { active: true }
            : {
                active: true,
                OR: [
                    { nextCheckAt: null },
                    { nextCheckAt: { lte: now } },
                ],
            },
        orderBy: [
            { priority: "desc" },
            { lastFoundAt: "desc" },
            { lastCheckedAt: "asc" },
        ],
        take: limit,
    });

    const byName = new Map(companies.map((company) => [normalizeCompanyName(company.name), company]));

    if (rows.length > 0) {
        return rows
            .map((row) => {
                const seed = byName.get(row.normalizedName);

                return {
                    name: row.name,
                    locationHint: row.locationHint ?? seed?.locationHint,
                    careerUrl: row.careerUrl ?? seed?.careerUrl,
                    priority: row.priority,
                    active: row.active,
                    nextCheckAt: row.nextCheckAt,
                    lastFoundAt: row.lastFoundAt,
                    consecutiveNoJobs: row.consecutiveNoJobs,
                };
            })
            .filter((company) => Boolean(company.careerUrl));
    }

    return companies.slice(0, limit).map((company) => ({
        ...company,
        priority: 50,
        active: false,
        consecutiveNoJobs: 0,
    }));
}

export async function recordCompanyScanResult(input: {
    name: string;
    locationHint?: string;
    careerUrl?: string;
    jobsFound: number;
    source?: string;
    error?: string;
}) {
    const normalizedName = normalizeCompanyName(input.name);
    if (!normalizedName) return;

    const existing = await prisma.companyPriorityTarget.findUnique({ where: { normalizedName } });
    const now = new Date();
    const jobsFound = Math.max(0, input.jobsFound);
    const previousPriority = existing?.priority ?? 50;
    const previousNoJobs = existing?.consecutiveNoJobs ?? 0;
    const nextNoJobs = jobsFound > 0 ? 0 : previousNoJobs + 1;
    const nextPriority = jobsFound > 0
        ? clampPriority(previousPriority + Math.min(25, 10 + jobsFound * 3))
        : clampPriority(previousPriority - (input.error ? 8 : 5));

    await prisma.companyPriorityTarget.upsert({
        where: { normalizedName },
        create: {
            name: input.name,
            normalizedName,
            locationHint: input.locationHint,
            careerUrl: input.careerUrl,
            priority: nextPriority,
            active: jobsFound > 0,
            centerHits: jobsFound > 0 ? 1 : 0,
            totalJobsFound: jobsFound,
            checksCount: 1,
            consecutiveNoJobs: nextNoJobs,
            lastFoundAt: jobsFound > 0 ? now : undefined,
            lastCheckedAt: now,
            nextCheckAt: cooldownFor(nextPriority, nextNoJobs, jobsFound > 0),
            lastSource: input.source ?? "CENTER_ISRAEL",
            lastError: input.error,
        },
        update: {
            name: input.name,
            locationHint: input.locationHint,
            careerUrl: input.careerUrl,
            priority: nextPriority,
            active: jobsFound > 0 || nextPriority >= 35,
            centerHits: { increment: jobsFound > 0 ? 1 : 0 },
            totalJobsFound: { increment: jobsFound },
            checksCount: { increment: 1 },
            consecutiveNoJobs: nextNoJobs,
            lastFoundAt: jobsFound > 0 ? now : existing?.lastFoundAt,
            lastCheckedAt: now,
            nextCheckAt: cooldownFor(nextPriority, nextNoJobs, jobsFound > 0),
            lastSource: input.source ?? "CENTER_ISRAEL",
            lastError: input.error,
        },
    });
}

export async function recordProviderCompanyHits(jobs: ParsedJob[]) {
    const grouped = new Map<string, { name: string; count: number; source?: string; location?: string }>();

    for (const job of jobs) {
        if (!job.company) continue;
        const normalizedName = normalizeCompanyName(job.company);
        if (!normalizedName) continue;

        const current = grouped.get(normalizedName) ?? {
            name: job.company,
            count: 0,
            source: job.source,
            location: job.location,
        };
        current.count += 1;
        current.source = current.source ?? job.source;
        current.location = current.location ?? job.location;
        grouped.set(normalizedName, current);
    }

    for (const [normalizedName, group] of grouped) {
        const existing = await prisma.companyPriorityTarget.findUnique({ where: { normalizedName } });
        const now = new Date();
        const nextPriority = clampPriority((existing?.priority ?? 50) + Math.min(30, 12 + group.count * 4));

        await prisma.companyPriorityTarget.upsert({
            where: { normalizedName },
            create: {
                name: group.name,
                normalizedName,
                locationHint: group.location,
                priority: nextPriority,
                active: true,
                sourceHits: 1,
                totalJobsFound: group.count,
                consecutiveNoJobs: 0,
                lastFoundAt: now,
                nextCheckAt: cooldownFor(nextPriority, 0, true),
                lastSource: group.source,
            },
            update: {
                name: group.name,
                locationHint: group.location ?? existing?.locationHint,
                priority: nextPriority,
                active: true,
                sourceHits: { increment: 1 },
                totalJobsFound: { increment: group.count },
                consecutiveNoJobs: 0,
                lastFoundAt: now,
                nextCheckAt: cooldownFor(nextPriority, 0, true),
                lastSource: group.source,
                lastError: null,
            },
        });
    }
}

export async function listCompanyPriorityTargets(options: {
    activeOnly?: boolean;
    limit?: number;
} = {}) {
    const limit = Math.max(1, options.limit ?? 100);

    return prisma.companyPriorityTarget.findMany({
        where: options.activeOnly ? { active: true } : undefined,
        orderBy: [
            { active: "desc" },
            { priority: "desc" },
            { lastFoundAt: "desc" },
            { lastCheckedAt: "asc" },
        ],
        take: limit,
    });
}
