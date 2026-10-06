import fs from "fs/promises";
import path from "path";
import { createHash } from "crypto";
import mammoth from "mammoth";
import { prisma } from "../infrastructure/prisma";
import { cleanExtractedResumeText } from "../services/user-workspace.service";
import { buildRoleResumeVariant } from "../services/resume-role-variant.service";
import { buildEvidenceCorpus } from "../services/resume-evidence.service";
import { getStorageRoot } from "../services/file-storage.service";

// Explicit local import: no model calls, generated applications or external messages.
async function main() {
  const [userId, inputPath] = process.argv.slice(2);
  if (!userId || !inputPath || path.extname(inputPath).toLowerCase() !== ".docx") throw new Error("Usage: activate-resume-source USER_ID FILE.docx");
  const user = await prisma.appUser.findUniqueOrThrow({ where: { id: userId }, include: { profile: true, resumeBases: true } });
  if (!user.profile) throw new Error("User profile required");
  const buffer = await fs.readFile(inputPath);
  const hash = createHash("sha256").update(buffer).digest("hex");
  const source = cleanExtractedResumeText((await mammoth.extractRawText({ buffer })).value);
  const corpus = buildEvidenceCorpus(source, user.profile.fullName);
  if (corpus.evidence.filter(e => e.kind === "education").length !== 1) throw new Error("Expected one unambiguous source education entry");
  const directory = path.join(getStorageRoot(), "resumes", userId, "sources", hash);
  await fs.mkdir(directory, { recursive: true });
  const sourceFilePath = path.join(directory, path.basename(inputPath));
  const sourceFileKey = path.relative(getStorageRoot(), sourceFilePath).split(path.sep).join("/");
  await fs.copyFile(inputPath, sourceFilePath);
  // Retain existing records and a rollback snapshot before changing active selections.
  await fs.writeFile(path.join(directory, `previous-selections-${Date.now()}.json`), JSON.stringify({
    resumeBases: user.resumeBases,
    defaultIds: { FULLSTACK: user.dailyAutomationFullstackResumeBaseId, BACKEND: user.dailyAutomationBackendResumeBaseId, FRONTEND: user.dailyAutomationFrontendResumeBaseId },
    resumeFilePath: user.profile.resumeFilePath,
  }, null, 2));
  const bases = await prisma.$transaction(async tx => {
    await tx.userResumeBase.updateMany({ where: { userId }, data: { isDefault: false } });
    const result = [];
    for (const target of ["FULLSTACK", "BACKEND", "FRONTEND"] as const) {
      const content = buildRoleResumeVariant(source, target);
      const variant = buildEvidenceCorpus(content, user.profile!.fullName);
      if (JSON.stringify(variant.evidence.map(e => e.id).sort()) !== JSON.stringify(corpus.evidence.map(e => e.id).sort())) throw new Error("Role variant changed source facts");
      const existing = await tx.userResumeBase.findFirst({ where: { userId, sourceFilePath: sourceFileKey, target } });
      const data = { name: `2026 Verified Source — ${target}`, target, targetTitle: `Full Stack Engineer${target === "FULLSTACK" ? "" : ` (${target.toLowerCase()} focus)`}`, content, sourceFilePath: sourceFileKey, isDefault: target === "FULLSTACK" };
      result.push(existing ? await tx.userResumeBase.update({ where: { id: existing.id }, data }) : await tx.userResumeBase.create({ data: { userId, ...data } }));
    }
    await tx.appUser.update({ where: { id: userId }, data: { dailyAutomationFullstackResumeBaseId: result[0].id, dailyAutomationBackendResumeBaseId: result[1].id, dailyAutomationFrontendResumeBaseId: result[2].id } });
    await tx.userProfile.update({ where: { userId }, data: { resumeFilePath: sourceFileKey } });
    return result;
  });
  console.log(JSON.stringify({ sourceHash: hash, education: corpus.evidence.filter(e => e.kind === "education").map(e => e.text), bases: bases.map(({ id, target, isDefault }) => ({ id, target, isDefault })) }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
