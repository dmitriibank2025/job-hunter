import type { ResumeBaseTarget } from "@prisma/client";

/** Role targeting changes order only: every fact remains verbatim from the current source. */
export function buildRoleResumeVariant(source: string, target: ResumeBaseTarget): string {
  if (target === "FULLSTACK" || target === "CUSTOM") return source;
  const preferred = target === "FRONTEND"
    ? ["Frontend", "Languages", "Architecture", "Backend", "Testing & Observability", "Databases", "Cloud & DevOps", "AI & LLM"]
    : ["Backend", "Languages", "Databases", "Architecture", "Cloud & DevOps", "Testing & Observability", "Frontend", "AI & LLM"];
  const lines = source.split(/\r?\n/);
  const skillsStart = lines.findIndex(line => /^\s*(?:#+\s*)?SKILLS\s*$/i.test(line));
  const skillsEnd = lines.findIndex((line, i) => i > skillsStart && /^\s*(?:#+\s*)?EXPERIENCE\s*$/i.test(line));
  if (skillsStart < 0 || skillsEnd < 0) throw new Error("Source resume must include Skills and Experience sections");
  const skills = lines.slice(skillsStart + 1, skillsEnd).filter(line => line.trim());
  const rank = (line: string) => { const n = preferred.indexOf(line.split(":")[0].trim()); return n < 0 ? preferred.length : n; };
  lines.splice(skillsStart + 1, skillsEnd - skillsStart - 1, ...skills.sort((a, b) => rank(a) - rank(b)), "");
  return lines.join("\n");
}
