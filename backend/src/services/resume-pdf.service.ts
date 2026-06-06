import fs from "fs/promises";
import path from "path";
import { chromium } from "playwright";
import { ResumeTemplateData } from "./template-docx.service";

export type BasicResumePdfTemplate = "ATS" | "MODERN" | "COMPACT";

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function formatSkills(skills: string): string {
    return skills
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
            const match = /^([^:]+):\s*(.*)$/.exec(line);

            if (!match) return `<div>${escapeHtml(line)}</div>`;

            return `<div><strong>${escapeHtml(match[1].trim())}</strong>: ${escapeHtml(match[2].trim())}</div>`;
        })
        .join("");
}

function formatBullets(value: string): string {
    const bullets = value
        .split(/\r?\n/)
        .map((line) => line.trim().replace(/^[•*-]\s+/, ""))
        .filter(Boolean);

    if (!bullets.length) return "";

    return `<ul>${bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}</ul>`;
}

function candidateContact(data?: ResumeTemplateData) {
    return {
        name: data?.FULL_NAME || process.env.DEFAULT_CANDIDATE_FULL_NAME || "Candidate",
        location: data?.LOCATION || process.env.DEFAULT_CANDIDATE_LOCATION || "Israel",
        phone: data?.PHONE || process.env.DEFAULT_CANDIDATE_PHONE || "",
        linkedin: data?.LINKEDIN || process.env.DEFAULT_CANDIDATE_LINKEDIN || "",
        email: data?.EMAIL || process.env.DEFAULT_CANDIDATE_EMAIL || "candidate@example.com",
        github: data?.GITHUB || process.env.DEFAULT_CANDIDATE_GITHUB || "",
        languages: data?.LANGUAGES || process.env.DEFAULT_CANDIDATE_LANGUAGES || "Hebrew, English, Russian",
    };
}

function buildHtml(data: ResumeTemplateData): string {
    const titleParts = data.TITLE.split("|").map((part) => part.trim()).filter(Boolean);
    const role = titleParts[0] || data.TITLE;
    const stack = titleParts.slice(1).join(" | ");
    const contact = candidateContact(data);

    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    @page { size: Letter; margin: 0.45in; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #111;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 10.4pt;
      line-height: 1.22;
    }
    .top {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8px;
      align-items: baseline;
    }
    .name {
      font-size: 18pt;
      font-weight: 700;
      letter-spacing: 0;
    }
    .location {
      font-size: 10pt;
    }
    .title {
      margin-top: 3px;
      font-size: 12pt;
    }
    .title strong {
      font-size: 16pt;
    }
    .contact {
      margin-top: 4px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 2px 18px;
      font-size: 9.5pt;
    }
    .languages {
      margin-top: 3px;
      font-size: 9.5pt;
    }
    .summary {
      margin-top: 10px;
      font-size: 10.2pt;
    }
    h2 {
      margin: 10px 0 4px;
      font-size: 12pt;
      line-height: 1.1;
    }
    .skills {
      font-size: 11pt;
      line-height: 1.2;
    }
    .experience {
      margin-top: 7px;
      break-inside: avoid;
    }
    .role-line {
      font-weight: 700;
      font-size: 10.5pt;
    }
    .project {
      margin-top: 2px;
      font-style: italic;
    }
    ul {
      margin: 3px 0 0 17px;
      padding: 0;
    }
    li {
      margin: 1.5px 0;
      padding-left: 1px;
    }
    .tech {
      margin-top: 3px;
      font-size: 9.6pt;
    }
    .education div {
      margin-top: 2px;
    }
  </style>
</head>
<body>
  <div class="top">
    <div class="name">${escapeHtml(contact.name.toUpperCase())}</div>
    <div class="location">${escapeHtml(contact.location)}</div>
  </div>
  <div class="title"><strong>${escapeHtml(role)}</strong>${stack ? ` | ${escapeHtml(stack)}` : ""}</div>
  <div class="contact">
    ${contact.phone ? `<div>Phone: ${escapeHtml(contact.phone)}</div>` : ""}
    ${contact.linkedin ? `<div>LinkedIn: ${escapeHtml(contact.linkedin)}</div>` : ""}
    <div>Email: ${escapeHtml(contact.email)}</div>
    ${contact.github ? `<div>GitHub: ${escapeHtml(contact.github)}</div>` : ""}
  </div>
  <div class="languages"><strong>Languages:</strong> ${escapeHtml(contact.languages)}</div>
  <div class="summary">${escapeHtml(data.SUMMARY)}</div>

  <h2>Skills</h2>
  <div class="skills">${formatSkills(data.SKILLS)}</div>

  <h2>Experience</h2>
  <section class="experience">
    <div class="role-line">2024 - Present | Full-stack Developer | Inetex LTD (Rehovot, Israel)</div>
    <div class="project">Cloud-Native Booking and Locker Management System</div>
    ${formatBullets(data.INETEX_BULLETS)}
    <div class="tech"><strong>Technologies:</strong> ${escapeHtml(data.INETEX_TECHNOLOGIES)}</div>
  </section>
  <section class="experience">
    <div class="role-line">2022 - 2024 | Full Stack Developer | VTA Center (Ramat Gan, Israel)</div>
    <div class="project">Educational Assessment Platform</div>
    ${formatBullets(data.VTA_BULLETS)}
    <div class="tech"><strong>Technologies:</strong> ${escapeHtml(data.VTA_TECHNOLOGIES)}</div>
  </section>
  <section class="experience">
    <div class="role-line">2019 - 2022 | Frontend Developer | AVSD+ (Moscow, Russia)</div>
    <div class="project">Healthcare Services Web Platform</div>
    ${formatBullets(data.AVSD_BULLETS)}
    <div class="tech"><strong>Technologies:</strong> ${escapeHtml(data.AVSD_TECHNOLOGIES)}</div>
  </section>

  <h2>Education</h2>
  <section class="education">
    <div>2008 - 2014 &nbsp; M.Sc., Computer Science &amp; Medical Informatics | MSUMD (Moscow, Russia)</div>
    <div>2021 - 2022 &nbsp; Backend Developer | Tel-Ran College (Israel)</div>
    <div>447 hours intensive program covering backend (Java, Node.js) and databases</div>
    <div>Completed training in enterprise application development and system design</div>
  </section>
</body>
</html>`;
}

export async function createResumePdfFromTemplate(
    data: ResumeTemplateData,
    outputPath: string,
) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    const browser = await chromium.launch({
        headless: process.env.PROVIDER_HEADLESS !== "false",
    });

    try {
        const page = await browser.newPage();
        await page.setContent(buildHtml(data), { waitUntil: "load" });
        await page.pdf({
            path: outputPath,
            format: "Letter",
            printBackground: true,
            preferCSSPageSize: true,
        });
    } finally {
        await browser.close().catch(() => undefined);
    }

    return outputPath;
}

function markdownToBasicHtml(content: string): string {
    const lines = content.split(/\r?\n/);

    return lines.map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return `<div class="spacer"></div>`;
        if (trimmed.startsWith("# ")) return `<h1>${escapeHtml(trimmed.slice(2))}</h1>`;
        if (trimmed.startsWith("## ")) return `<h2>${escapeHtml(trimmed.slice(3))}</h2>`;
        if (trimmed.startsWith("### ")) return `<h3>${escapeHtml(trimmed.slice(4))}</h3>`;
        if (/^[-*]\s+/.test(trimmed)) return `<li>${escapeHtml(trimmed.replace(/^[-*]\s+/, ""))}</li>`;
        return `<p>${escapeHtml(trimmed)}</p>`;
    }).join("\n");
}

function buildBasicResumeHtml(content: string, template: BasicResumePdfTemplate): string {
    const theme = {
        ATS: {
            page: "A4",
            margin: "18mm",
            font: "Arial, Helvetica, sans-serif",
            bodySize: "10.6pt",
            lineHeight: "1.38",
            h1: "21pt",
            h2: "12.5pt",
            h3: "10.8pt",
            accent: "#151515",
            background: "#fff",
            border: "#d5d5d5",
        },
        MODERN: {
            page: "A4",
            margin: "17mm",
            font: "Arial, Helvetica, sans-serif",
            bodySize: "10.5pt",
            lineHeight: "1.42",
            h1: "23pt",
            h2: "12.8pt",
            h3: "11pt",
            accent: "#1d5f72",
            background: "#fbfbf8",
            border: "#bfd2d8",
        },
        COMPACT: {
            page: "A4",
            margin: "13mm",
            font: "Arial, Helvetica, sans-serif",
            bodySize: "9.8pt",
            lineHeight: "1.26",
            h1: "18pt",
            h2: "11.2pt",
            h3: "10.2pt",
            accent: "#111",
            background: "#fff",
            border: "#cfcfcf",
        },
    }[template];

    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    @page { size: ${theme.page}; margin: ${theme.margin}; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #151515;
      background: ${theme.background};
      font-family: ${theme.font};
      font-size: ${theme.bodySize};
      line-height: ${theme.lineHeight};
    }
    h1 {
      margin: 0 0 6px;
      color: ${theme.accent};
      font-size: ${theme.h1};
      line-height: 1.1;
      letter-spacing: 0;
    }
    h2 {
      margin: 13px 0 5px;
      padding-bottom: 2px;
      border-bottom: 1px solid ${theme.border};
      color: ${theme.accent};
      font-size: ${theme.h2};
      line-height: 1.15;
    }
    h3 {
      margin: 8px 0 3px;
      font-size: ${theme.h3};
      line-height: 1.2;
    }
    p {
      margin: 2px 0;
      white-space: pre-wrap;
    }
    li {
      margin: 2px 0 2px 16px;
      padding-left: 2px;
    }
    .spacer { height: 6px; }
  </style>
</head>
<body>${markdownToBasicHtml(content)}</body>
</html>`;
}

export async function createBasicResumePdf(
    content: string,
    outputPath: string,
    template: BasicResumePdfTemplate = "ATS",
) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    const browser = await chromium.launch({
        headless: process.env.PROVIDER_HEADLESS !== "false",
    });

    try {
        const page = await browser.newPage();
        await page.setContent(buildBasicResumeHtml(content, template), { waitUntil: "load" });
        await page.pdf({
            path: outputPath,
            format: "A4",
            printBackground: true,
            preferCSSPageSize: true,
        });
    } finally {
        await browser.close().catch(() => undefined);
    }

    return outputPath;
}
