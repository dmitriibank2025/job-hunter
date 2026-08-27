import { prisma } from "../infrastructure/prisma";
import { normalizeCompanyName, SearchPreferences } from "./search-preferences.service";

export type BlacklistedCompany = {
    id: string;
    name: string;
    createdAt: Date;
};

export async function listUserBlacklistedCompanies(userId: string): Promise<BlacklistedCompany[]> {
    const rows = await prisma.userBlacklistedCompany.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        select: { id: true, name: true, createdAt: true },
    });

    return rows;
}

export async function addUserBlacklistedCompany(userId: string, name: string): Promise<BlacklistedCompany> {
    const trimmed = name.trim();
    const normalizedName = normalizeCompanyName(trimmed);

    if (!trimmed || !normalizedName) {
        throw new Error("Company name is required.");
    }

    // Idempotent: re-adding the same company (any casing/suffix) updates the label.
    const row = await prisma.userBlacklistedCompany.upsert({
        where: { userId_normalizedName: { userId, normalizedName } },
        create: { userId, name: trimmed, normalizedName },
        update: { name: trimmed },
        select: { id: true, name: true, createdAt: true },
    });

    return row;
}

export async function removeUserBlacklistedCompany(userId: string, id: string): Promise<void> {
    // deleteMany scopes by userId so one user can never delete another's entry.
    await prisma.userBlacklistedCompany.deleteMany({ where: { id, userId } });
}

async function getUserBlacklistNames(userId: string): Promise<string[]> {
    const rows = await prisma.userBlacklistedCompany.findMany({
        where: { userId },
        select: { name: true },
    });

    return rows.map((row) => row.name);
}

/**
 * Merge a user's persisted search filters (company blacklist + exclude-remote
 * toggle) into whatever preferences the caller supplied. Applied for BOTH the
 * daily automation (which has no per-run preference UI) and manual searches, so
 * blacklisted companies and remote vacancies are dropped everywhere.
 */
export async function applyUserSearchFiltersToPreferences(
    userId: string,
    preferences: SearchPreferences | undefined,
): Promise<SearchPreferences> {
    const [blacklistNames, user] = await Promise.all([
        getUserBlacklistNames(userId),
        prisma.appUser.findUnique({
            where: { id: userId },
            select: { searchExcludeRemote: true },
        }),
    ]);

    const base = preferences ?? {};
    const mergedCompanies = [...(base.excludedCompanies ?? []), ...blacklistNames];

    return {
        ...base,
        excludedCompanies: mergedCompanies,
        excludeRemote: Boolean(base.excludeRemote) || Boolean(user?.searchExcludeRemote),
    };
}

export async function updateUserSearchSettings(userId: string, input: { excludeRemote: boolean }) {
    return prisma.appUser.update({
        where: { id: userId },
        data: { searchExcludeRemote: input.excludeRemote },
        select: { searchExcludeRemote: true },
    });
}
