/**
 * Upsert the honest, rule-compliant base resumes (FULLSTACK / BACKEND / FRONTEND)
 * into UserResumeBase for a given user, and wire them as the daily-automation bases.
 *
 * Usage:
 *   tsx src/scripts/upsert-base-resumes.ts --email=user@example.com
 *   tsx src/scripts/upsert-base-resumes.ts --user-id=<uuid>
 *   tsx src/scripts/upsert-base-resumes.ts            # only if exactly one user exists
 *
 * Source content lives in src/data/base-resumes/{fullstack,backend,frontend}.md
 */
import fs from "fs/promises";
import path from "path";
import { ResumeBaseTarget } from "@prisma/client";
import { prisma } from "../infrastructure/prisma";

type Target = Exclude<ResumeBaseTarget, "CUSTOM">;

const FILES: Record<Target, { file: string; name: string; targetTitle: string }> = {
    FULLSTACK: { file: "fullstack.md", name: "Base — Full Stack (honest)", targetTitle: "Full Stack Developer" },
    BACKEND: { file: "backend.md", name: "Base — Backend (honest)", targetTitle: "Backend Developer" },
    FRONTEND: { file: "frontend.md", name: "Base — Frontend (honest)", targetTitle: "Frontend Engineer" },
};

function getArg(flag: string): string | undefined {
    const hit = process.argv.find((a) => a.startsWith(`--${flag}=`));
    return hit?.split("=").slice(1).join("=").trim() || undefined;
}

async function resolveUserId(): Promise<string> {
    const userId = getArg("user-id");
    if (userId) {
        await prisma.appUser.findUniqueOrThrow({ where: { id: userId } });
        return userId;
    }
    const email = getArg("email");
    if (email) {
        const u = await prisma.appUser.findUniqueOrThrow({ where: { email } });
        return u.id;
    }
    const users = await prisma.appUser.findMany({ select: { id: true, email: true } });
    if (users.length === 1) return users[0].id;
    throw new Error(
        `Specify a user. Found ${users.length} users:\n` +
            users.map((u) => `  ${u.id}  ${u.email}`).join("\n") +
            `\nRe-run with --email=<email> or --user-id=<id>.`,
    );
}

async function upsertBase(userId: string, target: Target) {
    const meta = FILES[target];
    const filePath = path.join(__dirname, "..", "data", "base-resumes", meta.file);
    const content = (await fs.readFile(filePath, "utf-8")).trim();

    const existing = await prisma.userResumeBase.findFirst({
        where: { userId, name: meta.name },
    });

    if (existing) {
        const updated = await prisma.userResumeBase.update({
            where: { id: existing.id },
            data: { target, targetTitle: meta.targetTitle, content },
        });
        console.log(`  updated ${target.padEnd(9)} -> ${updated.id} (${content.length} chars)`);
        return updated.id;
    }

    const created = await prisma.userResumeBase.create({
        data: { userId, name: meta.name, target, targetTitle: meta.targetTitle, content, isDefault: false },
    });
    console.log(`  created ${target.padEnd(9)} -> ${created.id} (${content.length} chars)`);
    return created.id;
}

async function main() {
    const userId = await resolveUserId();
    const user = await prisma.appUser.findUniqueOrThrow({ where: { id: userId }, select: { id: true, email: true } });
    console.log(`Upserting honest base resumes for ${user.email} (${user.id})`);

    const ids: Record<Target, string> = {
        FULLSTACK: await upsertBase(userId, "FULLSTACK"),
        BACKEND: await upsertBase(userId, "BACKEND"),
        FRONTEND: await upsertBase(userId, "FRONTEND"),
    };

    // Make FULLSTACK the single default base (selector falls back to isDefault).
    await prisma.userResumeBase.updateMany({ where: { userId }, data: { isDefault: false } });
    await prisma.userResumeBase.update({ where: { id: ids.FULLSTACK }, data: { isDefault: true } });

    // Wire the daily-automation base ids so automated generation uses these bases.
    await prisma.appUser.update({
        where: { id: userId },
        data: {
            dailyAutomationFullstackResumeBaseId: ids.FULLSTACK,
            dailyAutomationBackendResumeBaseId: ids.BACKEND,
            dailyAutomationFrontendResumeBaseId: ids.FRONTEND,
        },
    });

    console.log("Done. FULLSTACK set as default; daily-automation base ids wired.");
}

main()
    .catch((err) => {
        console.error(err instanceof Error ? err.message : err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
