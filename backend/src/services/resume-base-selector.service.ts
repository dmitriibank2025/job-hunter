import { Job, ResumeBaseTarget } from "@prisma/client";
import { prisma } from "../infrastructure/prisma";

type SelectableResumeTarget = Exclude<ResumeBaseTarget, "CUSTOM">;

export type ResumeBaseSelectionMap = Partial<Record<SelectableResumeTarget, string>>;

const FULLSTACK_TITLE = /\bfull[\s-]*stack\b/i;
const FRONTEND_TITLE = /\bfront[\s-]*end\b|\bfrontend\b/i;
const BACKEND_TITLE = /\bback[\s-]*end\b|\bbackend\b/i;
const INFRA_BACKEND_TITLE = /\b(devops|infrastructure|platform|cloud|data engineer|ml engineer|machine learning|automation|systems?|architect|security)\b/i;

const FRONTEND_SIGNALS = [
    /\breact(?:\.js)?\b/i,
    /\bangular\b/i,
    /\bvue(?:\.js)?\b/i,
    /\bnext(?:\.js)?\b/i,
    /\bfrontend\b|\bfront[\s-]*end\b/i,
    /\buser interface\b|\bui\b/i,
    /\bhtml5?\b|\bcss3?\b/i,
    /\bstate management\b|\bredux\b|\bzustand\b/i,
];

const BACKEND_SIGNALS = [
    /\bnode(?:\.js)?\b/i,
    /\bnest(?:js)?\b|\bexpress(?:\.js)?\b/i,
    /\bbackend\b|\bback[\s-]*end\b|\bserver[\s-]*side\b/i,
    /\bmicroservices?\b/i,
    /\brest(?:ful)?\s+apis?\b|\bgraphql\b/i,
    /\bpostgres(?:ql)?\b|\bmongodb\b|\bredis\b|\bdynamodb\b/i,
    /\baws\s+lambda\b|\bsqs\b|\bsns\b/i,
    /\bevent[\s-]*driven\b/i,
];

function signalScore(text: string, signals: readonly RegExp[]): number {
    return signals.reduce((score, signal) => score + (signal.test(text) ? 1 : 0), 0);
}

export function inferResumeTargetForJob(job: Pick<Job, "title" | "description">): SelectableResumeTarget {
    const title = job.title.trim();

    // Explicit role names are more reliable than incidental technologies in the description.
    if (FULLSTACK_TITLE.test(title)) return "FULLSTACK";
    if (FRONTEND_TITLE.test(title)) return "FRONTEND";
    if (BACKEND_TITLE.test(title)) return "BACKEND";
    if (INFRA_BACKEND_TITLE.test(title)) return "BACKEND";

    const text = `${title}\n${job.description}`;
    const frontendScore = signalScore(text, FRONTEND_SIGNALS);
    const backendScore = signalScore(text, BACKEND_SIGNALS);

    if (frontendScore >= 2 && backendScore >= 2 && Math.abs(frontendScore - backendScore) <= 2) {
        return "FULLSTACK";
    }

    if (frontendScore > backendScore) return "FRONTEND";
    if (backendScore > frontendScore) return "BACKEND";

    return "FULLSTACK";
}

export async function selectResumeBaseForJob(
    userId: string,
    job: Pick<Job, "title" | "description">,
    fallbackResumeBaseId?: string,
    resumeBaseIds?: ResumeBaseSelectionMap,
) {
    const target = inferResumeTargetForJob(job);
    const resumeBases = await prisma.userResumeBase.findMany({
        where: { userId },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        select: {
            id: true,
            name: true,
            target: true,
            isDefault: true,
        },
    });

    if (resumeBases.length === 0) {
        throw new Error("Create at least one base resume before analyzing jobs or generating resumes.");
    }

    const selected = resumeBases.find((resumeBase) => resumeBase.id === resumeBaseIds?.[target])
        ?? resumeBases.find((resumeBase) => resumeBase.target === target)
        ?? resumeBases.find((resumeBase) => resumeBase.id === fallbackResumeBaseId)
        ?? resumeBases.find((resumeBase) => resumeBase.isDefault)
        ?? resumeBases[0];

    return {
        ...selected,
        inferredTarget: target,
    };
}
