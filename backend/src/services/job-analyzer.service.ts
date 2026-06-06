import OpenAI from "openai";
import { PrismaClient } from "@prisma/client";
import {
    assertUserLimit,
    getWorkspaceCandidateProfile,
    recordUsageEvent,
    upsertUserJobMatch,
} from "./user-workspace.service";

const prisma = new PrismaClient();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

type AnalyzeJobOptions = {
    userId?: string;
    resumeBaseId?: string;
};

export async function analyzeJob(jobId: string, options: AnalyzeJobOptions = {}) {
     if (!options.userId) {
         throw new Error("userId is required for multi-user job analysis");
     }

     const job = await prisma.job.findUnique({
         where: { id: jobId },
     });

     if (!job) {
         throw new Error("Job not found");
     }

     await assertUserLimit(options.userId, "OPENAI_TOKENS");

     const profile = await getWorkspaceCandidateProfile(options.userId, options.resumeBaseId);

     if (!profile) {
         throw new Error("Candidate profile not found for this user.");
     }

     const prompt = `
 You are an expert technical recruiter analyzing job fit for a candidate.

 Candidate Profile:
 Name: ${profile.fullName}
 Email: ${profile.email}

 Candidate Resume:
 ${profile.resume}

 Job Title: ${job.title}
 Company: ${job.company ?? "Unknown"}
 Location: ${job.location ?? "Unknown"}

 Job Description:
 ${job.description}

 Analyze if the candidate is a good fit for this job. Consider:
 1. Technical skills match (look for skills mentioned in resume)
 2. Experience level (compare job seniority with resume experience)
 3. Tech stack alignment (check if key technologies match)
 4. Type of role (full-stack, backend, frontend, etc.)

 Return a JSON object:
 {
  "matchScore": <number between 0-100>,
  "matchedSkills": [<list of candidate skills found in job description>],
  "missingSkills": [<list of important job requirements not in candidate resume>],
  "recommendation": "APPLY" | "MAYBE" | "SKIP",
  "reason": "<brief explanation of the score and recommendation>"
 }
 `;

     const response = await openai.chat.completions.create({
         model: "gpt-4.1-mini",
         messages: [
             {
                 role: "user",
                 content: prompt,
             },
         ],
         response_format: {
             type: "json_object",
         },
     });

     if (response.usage?.total_tokens) {
         await recordUsageEvent(options.userId, "OPENAI_TOKENS", response.usage.total_tokens, {
             scope: "job_analysis",
             jobId,
             model: "gpt-4.1-mini",
         });
     }

     let analysis;
     try {
         analysis = JSON.parse(response.choices[0].message.content || "{}");
     } catch (error) {
         console.error("Failed to parse job analysis response:", error);
         // Default to MAYBE if parsing fails
         analysis = {
             matchScore: 50,
             matchedSkills: [],
             missingSkills: [],
             recommendation: "MAYBE",
             reason: "Analysis parsing failed",
         };
     }

     const matchScore = Number.isFinite(Number(analysis.matchScore))
         ? Math.max(0, Math.min(100, Math.round(Number(analysis.matchScore))))
         : 50;
     analysis.matchScore = matchScore;

     await prisma.job.update({
         where: { id: job.id },
         data: { status: "ANALYZED" },
     });

     const userMatch = await upsertUserJobMatch(options.userId, job.id, {
         status: "ANALYZED",
         matchScore,
         analysis,
     });

     return {
         ...job,
         status: "ANALYZED" as const,
         matchScore,
         analysis,
         userMatch,
     };
}
