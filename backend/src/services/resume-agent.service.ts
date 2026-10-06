/** Compatibility entry point: the agent and production use the same validated pipeline. */
import { prisma } from "../infrastructure/prisma";
import { inferResumeTargetForJob } from "./resume-base-selector.service";
import { getWorkspaceCandidateProfile } from "./user-workspace.service";
import { generateVerifiedResume } from "./resume-generator.service";

export type ResumeAgentResult = {
  content: string;
  finalScore: number | null;
  scoreTrace: number[];
  searchCalls: number;
  scoreCalls: number;
  rounds: number;
};

export async function runResumeAgent(
  jobId: string,
  userId: string,
  opts: { maxRounds?: number } = {},
): Promise<ResumeAgentResult> {
  const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
  const target = inferResumeTargetForJob(job);
  const base =
    (await prisma.userResumeBase.findFirst({ where: { userId, target } })) ??
    (await prisma.userResumeBase.findFirst({
      where: { userId, isDefault: true },
    }));
  if (!base) throw new Error("No resume base found for user");
  const profile = await getWorkspaceCandidateProfile(userId, base.id);
  if (!profile) throw new Error("Candidate profile not found");
  const result = await generateVerifiedResume(
    job,
    userId,
    profile.candidateContext,
    opts.maxRounds === undefined ? undefined : Math.max(0, opts.maxRounds - 1),
  );
  return {
    content: result.content,
    finalScore: result.atsScore,
    scoreTrace: result.evidenceTrace.attempts.map(
      (a) => a.validation.score.total,
    ),
    searchCalls: result.evidenceTrace.retrieval.length,
    scoreCalls: 1,
    rounds: result.evidenceTrace.attempts.length,
  };
}
