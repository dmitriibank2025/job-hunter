import fs from "fs/promises";
import path from "path";
import { prisma } from "../infrastructure/prisma";
import { generateResumeForJob, generateCoverLetterForJob } from "../services/resume-generator.service";

// Explicit targets: no scraping, applications, email or notification side effects.
const userId = process.env.LIVE_USER_ID;
const resumeBaseId = process.env.LIVE_RESUME_BASE_ID;
async function main() {
  if (!userId) throw new Error("LIVE_USER_ID is required");
  const folder = path.join(process.env.STORAGE_DIR ?? "/app/storage", "live-qa-2026-10-04");
  await fs.mkdir(folder, { recursive: true });
  const selected = [...new Set(process.argv.slice(2))];
  if (selected.length !== 5) throw new Error("Pass exactly five explicit job UUIDs");
  if (selected.some(id => !/^[0-9a-f-]{36}$/i.test(id))) throw new Error("Expected explicit job UUIDs");
  for (const jobId of selected) {
    const reportPath = path.join(folder, `${jobId}.json`);
    const previous = await fs.readFile(reportPath, "utf8").then(JSON.parse).catch(() => null);
    if (previous?.ok) { console.log("ALREADY_COMPLETE", jobId); continue; }
    const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    console.log("START", job.company, job.title, jobId);
    try {
      const resume = previous?.resume ?? await generateResumeForJob(jobId, { userId, resumeBaseId });
      await fs.writeFile(reportPath, JSON.stringify({ ok: false, jobId, company: job.company, title: job.title, resume }, null, 2));
      const coverLetter = await generateCoverLetterForJob(jobId, { userId, resumeBaseId });
      const evidence = JSON.parse(await fs.readFile(resume.filePath!.replace(/\.docx$/, ".evidence.json"), "utf8"));
      const stale = /AVSD\+|Tel-Ran|Master's degree|\b[56]\+ years/i;
      if (!evidence.validation.valid || stale.test(resume.content) || stale.test(coverLetter.content)) throw new Error("Final artifact audit: invalid or stale candidate data");
      for (const file of [resume.filePath, resume.pdfFilePath, coverLetter.filePath]) if (!file || !(await fs.stat(file)).size) throw new Error("Missing output file");
      await fs.writeFile(reportPath, JSON.stringify({ ok: true, jobId, company: job.company, title: job.title, resume, coverLetter, score: evidence.validation.score, critic: evidence.critic, attempts: evidence.attempts.length }, null, 2));
      console.log("PASS", job.company, resume.id, coverLetter.id, "score", resume.atsScore);
    } catch (error) {
      await fs.writeFile(path.join(folder, `${jobId}.failure.json`), JSON.stringify({ message: error instanceof Error ? error.message : String(error), details: error instanceof Error ? error.cause : null }, null, 2));
      console.error("FAILED", jobId, error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
