import fs from "fs/promises";
import { execFile } from "child_process";
import os from "os";
import path from "path";
import { promisify } from "util";
import JSZip from "jszip";
import {
    AlignmentType,
    BorderStyle,
    convertInchesToTwip,
    Document,
    ExternalHyperlink,
    HeadingLevel,
    ISpacingProperties,
    Packer,
    Paragraph,
    TextRun,
    UnderlineType,
} from "docx";
import { ensureDir } from "./file-storage.service";

const execFileAsync = promisify(execFile);

function normalizeLine(value: string): string {
    return value.replace(/\s+/g, " ").trim();
}

function escapeXml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function decodeXml(value: string): string {
    return value
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, "\"")
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, "&");
}

function contentLines(value: string): string[] {
    return value
        .split(/\r?\n/)
        .map(normalizeLine)
        .filter(Boolean);
}

function paragraphText(paragraphXml: string): string {
    return Array.from(paragraphXml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g))
        .map((match) => decodeXml(match[1] ?? ""))
        .join("");
}

function replaceParagraphText(paragraphXml: string, text: string): string {
    let replaced = false;

    return paragraphXml.replace(/(<w:t(?:\s[^>]*)?>)([\s\S]*?)(<\/w:t>)/g, (_match, open: string, _value: string, close: string) => {
        if (!replaced) {
            replaced = true;
            return `${open}${escapeXml(text)}${close}`;
        }
        return `${open}${close}`;
    });
}

const RESUME_SECTIONS = new Set([
    "SUMMARY", "SKILLS", "EXPERIENCE", "EDUCATION",
    "LANGUAGES", "PERSONAL PROJECTS",
]);

function isSectionHeading(line: string): boolean {
    // Strip markdown heading prefix (## Personal Projects → PERSONAL PROJECTS)
    // so the LLM's markdown-formatted headings are recognised correctly.
    return RESUME_SECTIONS.has(line.trim().replace(/^#+\s*/, "").toUpperCase());
}

/** Sentinel: instructs createResumeDocxFromTemplate to remove the paragraph entirely. */
export const REMOVE_PARAGRAPH = "\x00REMOVE";

/**
 * Section-aware replacement map.
 * Pure positional mapping shifts all content when section line-counts differ
 * (e.g. Backend has 7 skills, FullStack has 8) causing Education/Languages to
 * fall outside the template and be dropped.  This version aligns each section
 * independently so every section heading always maps to its counterpart.
 */
function buildLineReplacementMap(baseContent: string, generatedContent: string): string[] {
    const baseLines = contentLines(baseContent);
    const generatedLines = contentLines(generatedContent);
    const replacements: string[] = [];

    // Collect section start indices for base and generated.
    const baseSectionStarts: number[] = [];
    const genSectionStarts: number[] = [];
    baseLines.forEach((l, i) => { if (isSectionHeading(l)) baseSectionStarts.push(i); });
    generatedLines.forEach((l, i) => { if (isSectionHeading(l)) genSectionStarts.push(i); });
    baseSectionStarts.push(baseLines.length);      // sentinel
    genSectionStarts.push(generatedLines.length);  // sentinel

    // Align pre-section lines (name, subtitle, contact) positionally.
    const preBase = baseSectionStarts[0] ?? baseLines.length;
    for (let i = 0; i < preBase; i++) {
        replacements[i] = generatedLines[i] ?? baseLines[i];
    }

    // Detect a job-role header: has "|" separator AND a year or "Present".
    const isJobHeader = (line: string) =>
        /\|/.test(line) && /\b(19|20)\d{2}\b|Present/i.test(line);

    // Collect job-header offsets within a slice of lines (relative to slice start).
    const jobHeaderOffsets = (lines: string[], start: number, end: number): number[] => {
        const offsets: number[] = [];
        for (let i = start; i < end; i++) {
            if (isJobHeader(lines[i])) offsets.push(i - start);
        }
        return offsets;
    };

    // Align a slice positionally between anchor points.
    // When the generated content is shorter than the template slot, use REMOVE_PARAGRAPH
    // so the paragraph is deleted from the DOCX rather than showing as an empty bullet.
    // Also strip markdown heading prefix from section headings so "## Personal Projects"
    // is normalised to "Personal Projects" (the template already has the styled heading).
    const alignSlice = (
        bStart: number, bEnd: number,
        gStart: number, gEnd: number,
    ) => {
        for (let offset = 0; offset < bEnd - bStart; offset++) {
            const bIdx = bStart + offset;
            const gIdx = gStart + offset;
            const raw = gIdx < gEnd ? (generatedLines[gIdx] ?? REMOVE_PARAGRAPH) : REMOVE_PARAGRAPH;
            // Normalise section heading text (strip leading ## so it renders cleanly).
            const value = raw !== REMOVE_PARAGRAPH && isSectionHeading(raw)
                ? raw.trim().replace(/^#+\s*/, "")
                : raw;
            replacements[bIdx] = value;
        }
    };

    // Build a name→index map for generated sections so we can match by heading name,
    // not by position. This handles the common case where the LLM removes a section
    // (e.g. PERSONAL PROJECTS) — without name matching, every subsequent section
    // would be misaligned, causing Education content to appear with bullet styles.
    // Build name→index map for generated sections.
    // Strip markdown heading prefix (## Personal Projects → PERSONAL PROJECTS)
    // so LLM-formatted headings are matched against plain-text base section names.
    const genSectionByName = new Map<string, number>();
    for (let s = 0; s < genSectionStarts.length - 1; s++) {
        const raw = generatedLines[genSectionStarts[s]] ?? "";
        const heading = raw.trim().replace(/^#+\s*/, "").toUpperCase();
        if (heading) genSectionByName.set(heading, s);
    }

    // For each base section, find the matching generated section by name.
    for (let s = 0; s < baseSectionStarts.length - 1; s++) {
        const bStart = baseSectionStarts[s];
        const bEnd   = baseSectionStarts[s + 1];
        const sectionName = baseLines[bStart]?.trim().replace(/^#+\s*/, "").toUpperCase();

        // Look up generated section by name; fall back to clearing base slots.
        const gSectionIdx = genSectionByName.get(sectionName);
        if (gSectionIdx === undefined) {
            // Section missing in generated content — clear all base slots.
            alignSlice(bStart, bEnd, 0, 0);
            continue;
        }
        const gStart = genSectionStarts[gSectionIdx];
        const gEnd   = genSectionStarts[gSectionIdx + 1];

        // For EXPERIENCE: also align at job-header level to handle per-role bullet count diffs.
        if (sectionName === "EXPERIENCE") {
            const bJobOffsets = jobHeaderOffsets(baseLines, bStart, bEnd);
            const gJobOffsets = jobHeaderOffsets(generatedLines, gStart, gEnd);
            const jobCount = Math.min(bJobOffsets.length, gJobOffsets.length);

            // Sentinel: end of section
            bJobOffsets.push(bEnd - bStart);
            gJobOffsets.push(gEnd - gStart);

            // Content before first job header (just the EXPERIENCE heading itself)
            alignSlice(bStart, bStart + (bJobOffsets[0] ?? 0), gStart, gStart + (gJobOffsets[0] ?? 0));

            // Each job block — align with Technologies-line awareness.
            // Technologies line is always the last non-empty line in a job block.
            // By anchoring it separately we avoid bullet-count diffs shifting
            // the Technologies line into a bullet slot (or vice versa).
            const isTech = (line: string) => /^Technologies:/i.test(line);

            const techOffsetInBlock = (lines: string[], absStart: number, absEnd: number): number => {
                for (let i = absEnd - 1; i >= absStart; i--) {
                    if (isTech(lines[i])) return i - absStart;
                }
                return -1;
            };

            for (let j = 0; j < jobCount; j++) {
                const bBlockStart = bStart + bJobOffsets[j];
                const bBlockEnd   = bStart + bJobOffsets[j + 1];
                const gBlockStart = gStart + gJobOffsets[j];
                const gBlockEnd   = gStart + gJobOffsets[j + 1];

                const bTechOff = techOffsetInBlock(baseLines, bBlockStart, bBlockEnd);
                const gTechOff = techOffsetInBlock(generatedLines, gBlockStart, gBlockEnd);

                if (bTechOff >= 0 && gTechOff >= 0) {
                    // Align content BEFORE Technologies positionally (header, subtitle, bullets).
                    alignSlice(bBlockStart, bBlockStart + bTechOff, gBlockStart, gBlockStart + gTechOff);
                    // Align Technologies line to Technologies line.
                    replacements[bBlockStart + bTechOff] = generatedLines[gBlockStart + gTechOff] ?? baseLines[bBlockStart + bTechOff];
                    // Anything after Technologies (none expected, but safety).
                    alignSlice(bBlockStart + bTechOff + 1, bBlockEnd, gBlockStart + gTechOff + 1, gBlockEnd);
                } else {
                    alignSlice(bBlockStart, bBlockEnd, gBlockStart, gBlockEnd);
                }
            }
        } else {
            alignSlice(bStart, bEnd, gStart, gEnd);
        }
    }

    return replacements;
}

export async function createResumeDocxFromTemplate(input: {
    templatePath: string;
    baseContent: string;
    generatedContent: string;
    outputPath: string;
}): Promise<boolean> {
    const templateBuffer = await fs.readFile(input.templatePath).catch(() => null);
    if (!templateBuffer) return false;

    const zip = await JSZip.loadAsync(templateBuffer);
    const documentFile = zip.file("word/document.xml");
    if (!documentFile) return false;

    const baseLines = contentLines(input.baseContent);
    const replacementLines = buildLineReplacementMap(input.baseContent, input.generatedContent);
    let cursor = 0;
    const documentXml = await documentFile.async("string");
    const updatedXml = documentXml.replace(/<w:p[\s\S]*?<\/w:p>/g, (paragraphXml) => {
        const text = normalizeLine(paragraphText(paragraphXml));
        if (!text) return paragraphXml;

        for (let index = cursor; index < baseLines.length; index += 1) {
            if (normalizeLine(baseLines[index]) === text) {
                cursor = index + 1;
                const replacement = replacementLines[index] ?? baseLines[index];
                // REMOVE_PARAGRAPH: paragraph slot has no generated content → delete it
                // (e.g. PERSONAL PROJECTS missing, or extra bullet slot with no match).
                if (replacement === REMOVE_PARAGRAPH) return "";
                return replacement !== baseLines[index]
                    ? replaceParagraphText(paragraphXml, replacement)
                    : paragraphXml;
            }
        }

        return paragraphXml;
    });

    zip.file("word/document.xml", updatedXml);
    const outputBuffer = await zip.generateAsync({ type: "nodebuffer" });
    await ensureDir(path.dirname(input.outputPath));
    await fs.writeFile(input.outputPath, outputBuffer);
    return true;
}

export async function convertDocxToPdf(input: {
    docxPath: string;
    outputPath: string;
}): Promise<string> {
    await ensureDir(path.dirname(input.outputPath));
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "docx-to-pdf-"));

    try {
        const libreOfficeBin = process.env.LIBREOFFICE_BIN ?? "soffice";
        await execFileAsync(libreOfficeBin, [
            "--headless",
            "--nologo",
            "--nofirststartwizard",
            "--convert-to",
            "pdf",
            "--outdir",
            tempDir,
            input.docxPath,
        ], { timeout: 120_000 });

        const convertedPath = path.join(
            tempDir,
            `${path.basename(input.docxPath, path.extname(input.docxPath))}.pdf`,
        );

        await fs.copyFile(convertedPath, input.outputPath);
        return input.outputPath;
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
}

function createParagraph(line: string): Paragraph {
    const clean = line.trim();

    if (!clean) {
        return new Paragraph("");
    }

    if (clean.startsWith("# ")) {
        return new Paragraph({
            text: clean.slice(2).trim(),
            heading: HeadingLevel.TITLE,
        });
    }

    if (clean.startsWith("## ")) {
        return new Paragraph({
            text: clean.slice(3).trim(),
            heading: HeadingLevel.HEADING_2,
        });
    }

    if (clean.startsWith("### ")) {
        return new Paragraph({
            text: clean.slice(4).trim(),
            heading: HeadingLevel.HEADING_3,
        });
    }

    if (
        clean === "SUMMARY" ||
        clean === "SKILLS" ||
        clean === "EXPERIENCE" ||
        clean === "EDUCATION"
    ) {
        return new Paragraph({
            text: clean,
            heading: HeadingLevel.HEADING_2,
        });
    }

    if (clean.startsWith("•") || clean.startsWith("-")) {
        return new Paragraph({
            children: [
                new TextRun(clean.replace(/^[-•]\s*/, "")),
            ],
            bullet: {
                level: 0,
            },
        });
    }

    return new Paragraph({
        children: [
            new TextRun(clean),
        ],
    });
}

// ─── STYLED BASE RESUME DOCX ──────────────────────────────────────────────────
// Replicates the visual design of the v2 DOCX templates:
//   - Bold centered name, blue subtitle, small centered contact line
//   - Blue bold section headings with bottom border
//   - Job title (bold) | Company (blue bold) | location | date
//   - Italic project name below job header
//   - Bullet points for experience items
//   - Technologies: italic line
//   - Bold skill labels, italic education descriptions

// Exact values extracted from CV_Dmitrii_Bank_FSWD.docx reference
const BLUE    = "2563EB";
const DARK    = "1A1A2E";
const GRAY    = "64748B";
const SEP     = "CBD5E1"; // separator bullet color in contact line

function styledName(text: string): Paragraph {
    return new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 60 },
        children: [new TextRun({ text, bold: true, size: 52, color: DARK })],
    });
}

function styledSubtitle(text: string): Paragraph {
    return new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 120 },
        children: [new TextRun({ text, bold: false, size: 26, color: BLUE })],
    });
}

function styledContact(text: string): Paragraph {
    const parts = text.split(/\s*•\s*/);
    const children: (TextRun | ExternalHyperlink)[] = [];
    parts.forEach((part, i) => {
        const trimmed = part.trim();
        if (i > 0) children.push(new TextRun({ text: "   •   ", size: 19, color: SEP }));
        if (/^https?:\/\/|linkedin\.com|github\.com/i.test(trimmed)) {
            const href = trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
            children.push(new ExternalHyperlink({
                link: href,
                children: [new TextRun({ text: trimmed, color: BLUE, underline: { type: UnderlineType.SINGLE } })],
            }));
        } else {
            children.push(new TextRun({ text: trimmed, size: 19, color: GRAY }));
        }
    });
    return new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 160 },
        children,
    });
}

function styledSectionHeading(text: string): Paragraph {
    return new Paragraph({
        spacing: { before: 200, after: 60 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: BLUE, space: 4 } },
        children: [new TextRun({ text, bold: true, size: 22, color: BLUE })],
    });
}

function styledJobHeader(line: string): Paragraph {
    // "Title | Company | Location | Date"
    // ref: role=bold dark sz=22, sep=gray sz=22, company=bold blue sz=22, rest=gray no sz
    const parts = line.split("|").map((p) => p.trim());
    const runs: TextRun[] = [];
    parts.forEach((part, i) => {
        if (i === 0) {
            runs.push(new TextRun({ text: part, bold: true, size: 22, color: DARK }));
        } else if (i === 1) {
            runs.push(new TextRun({ text: "  |  ", bold: false, size: 22, color: GRAY }));
            runs.push(new TextRun({ text: part, bold: true, size: 22, color: BLUE }));
        } else {
            runs.push(new TextRun({ text: `  |  ${part}`, color: GRAY }));
        }
    });
    return new Paragraph({ spacing: { before: 160, after: 40 }, children: runs });
}

function styledProjectName(text: string): Paragraph {
    return new Paragraph({
        spacing: { before: 20, after: 60 },
        children: [new TextRun({ text, bold: true, italics: true, color: GRAY })],
    });
}

function styledBullet(text: string): Paragraph {
    return new Paragraph({
        bullet: { level: 0 },  // docx library generates proper numbering.xml
        spacing: { before: 40, after: 40 },
        children: [new TextRun({ text, color: DARK })],
    });
}

function styledPlainPara(text: string): Paragraph {
    // For Personal Projects — plain text, no bullets, compact spacing (same size as body)
    return new Paragraph({
        spacing: { before: 40, after: 40 },
        children: [new TextRun({ text, color: DARK })],
    });
}

function styledTechnologies(text: string): Paragraph {
    // ref: "Technologies: " bold gray sz=19, values italic gray sz=19
    const colonIdx = text.indexOf(":");
    const label = colonIdx >= 0 ? text.slice(0, colonIdx + 1) : text;
    const rest  = colonIdx >= 0 ? text.slice(colonIdx + 1) : "";
    return new Paragraph({
        spacing: { before: 60, after: 20 },
        children: [
            new TextRun({ text: label, bold: true, size: 19, color: GRAY }),
            new TextRun({ text: rest,  bold: false, italics: true, size: 19, color: GRAY }),
        ],
    });
}

function styledSkillLine(text: string): Paragraph {
    // ref: label run (bold, no sz), values run (not bold, no sz), both col=1E293B
    const colonIdx = text.indexOf(":");
    const label  = colonIdx >= 0 ? text.slice(0, colonIdx + 1) + " " : text;
    const values = colonIdx >= 0 ? text.slice(colonIdx + 1).trimStart() : "";
    return new Paragraph({
        spacing: { before: 40, after: 40 },
        children: [
            new TextRun({ text: label,  bold: true,  color: DARK }),
            new TextRun({ text: values, bold: false, color: DARK }),
        ],
    });
}

function styledEducationEntry(text: string): Paragraph {
    // ref: degree bold no-sz DARK, " | Institution | Dates" not-bold GRAY, sp_before=100, sp_after=20
    const parts = text.split("|").map((p) => p.trim());
    const runs: TextRun[] = [];
    parts.forEach((part, i) => {
        if (i === 0) runs.push(new TextRun({ text: part, bold: true, color: DARK }));
        else          runs.push(new TextRun({ text: `  |  ${part}`, color: GRAY }));
    });
    return new Paragraph({ spacing: { before: 100, after: 20 }, children: runs });
}

function styledItalicLine(text: string): Paragraph {
    // ref: sp_after=40, italic, gray, no sz
    return new Paragraph({
        spacing: { before: 0, after: 40 },
        children: [new TextRun({ text, italics: true, color: GRAY })],
    });
}

function styledLanguages(text: string): Paragraph {
    // ref: sp_before=60, sp_after=60, no bold, no sz, DARK
    return new Paragraph({
        spacing: { before: 60, after: 60 },
        children: [new TextRun({ text, color: DARK })],
    });
}

function parseBoldSegments(text: string, size: number, color: string): TextRun[] {
    // handles **bold** inline markdown within bullet text
    const runs: TextRun[] = [];
    const parts = text.split(/\*\*([^*]+)\*\*/g);
    parts.forEach((part, i) => {
        runs.push(new TextRun({ text: part, bold: i % 2 === 1, size, color }));
    });
    return runs;
}

const SECTION_HEADINGS = new Set(["SUMMARY", "SKILLS", "EXPERIENCE", "EDUCATION", "LANGUAGES", "PERSONAL PROJECTS"]);

function isJobHeader(line: string): boolean {
    return /\|/.test(line) && /\b(20\d{2}|Present)\b/.test(line);
}

function isProjectName(line: string, prevWasJobHeader: boolean): boolean {
    return prevWasJobHeader && !/\|/.test(line);
}

function buildStyledParagraphs(content: string): Paragraph[] {
    const rawLines = content.split("\n");
    const paragraphs: Paragraph[] = [];
    let prevWasJobHeader = false;
    // Tracks whether the NEXT non-empty line is the project subtitle.
    // Blank lines between a job header and subtitle must NOT clear this.
    let awaitingSubtitle = false;
    let inSkills = false;
    let inExperience = false;
    let inEducation = false;
    let inProjects = false;
    let inSummary = false;
    let headerDone = false;
    let subtitleDone = false;
    let contactDone = false;

    for (const raw of rawLines) {
        const line = raw.trim();

        // Skip blank lines entirely — spacing is handled via sp_before/sp_after on paragraphs.
        // Crucially, do NOT reset prevWasJobHeader here: a blank line between a job header
        // and the project subtitle (e.g. "Cloud-Native Booking...") would otherwise cause
        // the subtitle to be rendered as a bullet instead of an italic sub-heading.
        if (!line) {
            continue;
        }

        // First non-empty line = name
        if (!headerDone) { paragraphs.push(styledName(line)); headerDone = true; continue; }
        // Second = subtitle
        if (!subtitleDone) { paragraphs.push(styledSubtitle(line)); subtitleDone = true; continue; }
        // Third = contact
        if (!contactDone) { paragraphs.push(styledContact(line)); contactDone = true; continue; }

        // Section headings — also strip markdown prefix (## Summary → SUMMARY)
        const lineNoMd = line.replace(/^#+\s*/, "");
        if (SECTION_HEADINGS.has(lineNoMd.toUpperCase())) {
            const heading = lineNoMd.toUpperCase();
            paragraphs.push(styledSectionHeading(heading));
            inSkills = heading === "SKILLS";
            inExperience = heading === "EXPERIENCE";
            inEducation = heading === "EDUCATION";
            inProjects = heading === "PERSONAL PROJECTS";
            inSummary = heading === "SUMMARY";
            prevWasJobHeader = false;
            continue;
        }

        // Summary text — 10pt body text, compact
        if (inSummary) {
            paragraphs.push(new Paragraph({
                spacing: { before: 80, after: 80 },
                children: [new TextRun({ text: line, size: 20, color: DARK })],
            }));
            continue;
        }

        // Skills: Label: values
        if (inSkills && line.includes(":")) {
            paragraphs.push(styledSkillLine(line));
            continue;
        }

        // Technologies line (any section)
        if (/^Technologies:/i.test(line)) {
            paragraphs.push(styledTechnologies(line));
            prevWasJobHeader = false;
            continue;
        }

        // Education entries MUST be checked BEFORE isJobHeader because education lines
        // also contain "|" and a year (e.g. "M.Sc. | MSUMD, Moscow | 2008 – 2014"),
        // which would falsely match isJobHeader and reset inEducation=false.
        if (inEducation && line.includes("|")) {
            paragraphs.push(styledEducationEntry(line));
            continue;
        }
        if (inEducation) {
            paragraphs.push(styledItalicLine(line));
            continue;
        }

        // Job header (has | and year/Present) — only outside Education section
        if (isJobHeader(line)) {
            paragraphs.push(styledJobHeader(line));
            prevWasJobHeader = true;
            awaitingSubtitle = (inExperience || inProjects); // subtitle expected in experience/projects
            inSummary = false;
            continue;
        }

        // Project subtitle — the FIRST non-empty line after a job header (in EXPERIENCE).
        // Uses awaitingSubtitle so that blank lines between the header and subtitle
        // don't break detection (prevWasJobHeader was previously reset on blank lines).
        // Personal Projects section has no italic sub-title — handled separately.
        if (!inProjects && awaitingSubtitle && !isJobHeader(line) && !/^Technologies:/i.test(line)) {
            awaitingSubtitle = false;
            prevWasJobHeader = false;
            paragraphs.push(styledProjectName(line));
            continue;
        }
        awaitingSubtitle = false;
        prevWasJobHeader = false;

        // Explicit bullet markers
        if (/^[•\-\*]\s+/.test(line)) {
            paragraphs.push(styledBullet(line.replace(/^[•\-\*]\s+/, "")));
            continue;
        }

        // Experience section: plain paragraphs are bullets (DOCX-format base has no • prefix)
        if (inExperience) {
            paragraphs.push(styledBullet(line));
            continue;
        }

        // Personal Projects: bullet points (same style as Experience)
        if (inProjects) {
            paragraphs.push(styledBullet(line));
            continue;
        }

        // Languages
        if (line.includes("•") && !line.includes("|")) {
            paragraphs.push(styledLanguages(line));
            continue;
        }

        // Default — same size as body (10pt)
        paragraphs.push(new Paragraph({
            spacing: { before: 40, after: 40 },
            children: [new TextRun({ text: line, size: 20, color: DARK })],
        }));
    }

    return paragraphs;
}

export async function createStyledResumeDocx(
    content: string,
    outputPath: string,
): Promise<void> {
    await ensureDir(path.dirname(outputPath));
    const doc = new Document({
        styles: {
            default: {
                document: {
                    run: { font: "Calibri", size: 20, color: DARK },
                    paragraph: { spacing: { before: 0, after: 0 } },
                },
            },
        },
        sections: [{
            properties: {
                page: {
                    margin: {
                        top: convertInchesToTwip(0.6),
                        bottom: convertInchesToTwip(0.6),
                        left: convertInchesToTwip(0.7),
                        right: convertInchesToTwip(0.7),
                    },
                },
            },
            children: buildStyledParagraphs(content),
        }],
    });
    const buffer = await Packer.toBuffer(doc);
    await fs.writeFile(outputPath, buffer);
}

export async function createResumeDocx(
    content: string,
    outputPath: string,
) {
    const lines = content.split("\n");

    const doc = new Document({
        sections: [
            {
                children: lines.map(createParagraph),
            },
        ],
    });

    const buffer = await Packer.toBuffer(doc);

    await fs.writeFile(outputPath, buffer);
}

export async function createCoverLetterDocx(
    content: string,
    outputPath: string,
) {
    const paragraphs = content
        .split(/\n{2,}/)
        .map((block) => block.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .map((block) =>
            new Paragraph({
                children: [
                    new TextRun({
                        text: block,
                        size: 22,
                    }),
                ],
                spacing: {
                    after: 220,
                    line: 276,
                },
            }),
        );

    const doc = new Document({
        sections: [
            {
                properties: {},
                children: paragraphs,
            },
        ],
    });

    const buffer = await Packer.toBuffer(doc);

    await fs.writeFile(outputPath, buffer);
}
