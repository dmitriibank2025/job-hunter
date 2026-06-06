import fs from "fs/promises";
import { createRequire } from "module";
import path from "path";
import { createReport } from "docx-templates";

const localRequire = createRequire(__filename);
const docxTemplatesPath = path.dirname(localRequire.resolve("docx-templates"));
const JSZip = localRequire(path.join(docxTemplatesPath, "..", "..", "jszip"));

export type ResumeTemplateData = {
    FULL_NAME?: string;
    LOCATION?: string;
    PHONE?: string;
    LINKEDIN?: string;
    EMAIL?: string;
    GITHUB?: string;
    LANGUAGES?: string;
    TITLE: string;
    SUMMARY: string;
    SKILLS: string;
    INETEX_BULLETS: string;
    INETEX_TECHNOLOGIES: string;
    VTA_BULLETS: string;
    VTA_TECHNOLOGIES: string;
    AVSD_BULLETS: string;
    AVSD_TECHNOLOGIES: string;
};

function escapeXml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function unescapeXml(value: string): string {
    return value
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, "\"")
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, "&");
}

function getParagraphText(paragraphXml: string): string {
    return unescapeXml(
        Array.from(paragraphXml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g))
            .map((match) => match[1])
            .join(""),
    );
}

function buildTitleRuns(title: string): string {
    const parts = title.split("|").map((part) => part.trim()).filter(Boolean);
    const role = parts[0] || title.trim();
    const stack = parts.slice(1).join(" | ");
    const roleRun = [
        "<w:r>",
        "<w:rPr><w:rFonts w:ascii=\"Arial\" w:hAnsi=\"Arial\"/><w:b/><w:sz w:val=\"32\"/><w:szCs w:val=\"32\"/></w:rPr>",
        `<w:t xml:space="preserve">${escapeXml(role)}</w:t>`,
        "</w:r>",
    ].join("");
    const stackRun = stack
        ? [
            "<w:r>",
            "<w:rPr><w:rFonts w:ascii=\"Arial\" w:hAnsi=\"Arial\"/><w:sz w:val=\"24\"/><w:szCs w:val=\"24\"/></w:rPr>",
            `<w:t xml:space="preserve">${escapeXml(` | ${stack}`)}</w:t>`,
            "</w:r>",
        ].join("")
        : "";

    return `${roleRun}${stackRun}`;
}

function buildSkillsRuns(skills: string): string {
    const lines = skills
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    const runs: string[] = [];

    for (const line of lines) {
        const match = /^([^:]+):\s*(.*)$/.exec(line);

        if (match) {
            runs.push([
                "<w:r>",
                "<w:rPr><w:rFonts w:ascii=\"Arial\" w:hAnsi=\"Arial\"/><w:b/><w:sz w:val=\"22\"/><w:szCs w:val=\"22\"/></w:rPr>",
                `<w:t xml:space="preserve">${escapeXml(match[1].trim())}</w:t>`,
                "</w:r>",
            ].join(""));
            runs.push([
                "<w:r>",
                "<w:rPr><w:rFonts w:ascii=\"Arial\" w:hAnsi=\"Arial\"/><w:sz w:val=\"22\"/><w:szCs w:val=\"22\"/></w:rPr>",
                `<w:t xml:space="preserve">${escapeXml(`: ${match[2].trim()}`)}</w:t>`,
                "</w:r>",
            ].join(""));
        } else {
            runs.push([
                "<w:r>",
                "<w:rPr><w:rFonts w:ascii=\"Arial\" w:hAnsi=\"Arial\"/><w:sz w:val=\"22\"/><w:szCs w:val=\"22\"/></w:rPr>",
                `<w:t xml:space="preserve">${escapeXml(line)}</w:t>`,
                "</w:r>",
            ].join(""));
        }

        runs.push("<w:r><w:br/></w:r>");
    }

    if (runs.length > 0) runs.pop();

    return runs.join("");
}

function buildTechnologiesRuns(technologies: string): string {
    return [
        "<w:r>",
        "<w:rPr><w:rFonts w:ascii=\"Arial\" w:hAnsi=\"Arial\"/><w:b/><w:sz w:val=\"22\"/><w:szCs w:val=\"22\"/></w:rPr>",
        "<w:t xml:space=\"preserve\">Technologies</w:t>",
        "</w:r>",
        "<w:r>",
        "<w:rPr><w:rFonts w:ascii=\"Arial\" w:hAnsi=\"Arial\"/><w:sz w:val=\"22\"/><w:szCs w:val=\"22\"/></w:rPr>",
        `<w:t xml:space="preserve">${escapeXml(`: ${technologies}`)}</w:t>`,
        "</w:r>",
    ].join("");
}

async function formatTitleLine(buffer: Buffer, title: string): Promise<Buffer> {
    const zip = await JSZip.loadAsync(buffer);
    const documentFile = zip.file("word/document.xml");

    if (!documentFile) return buffer;

    const documentXml = await documentFile.async("string");
    const normalizedTitle = title.replace(/\s+/g, " ").trim();
    let replaced = false;
    const updatedXml = documentXml.replace(/<w:p[\s\S]*?<\/w:p>/g, (paragraphXml: string) => {
        if (replaced) return paragraphXml;

        const paragraphText = getParagraphText(paragraphXml).replace(/\s+/g, " ").trim();
        const containsTitle =
            paragraphText === normalizedTitle ||
            paragraphText.includes(normalizedTitle) ||
            paragraphText.includes("<w:r>") && paragraphText.includes(normalizedTitle.split("|")[0]?.trim() ?? "");

        if (!containsTitle || !/\b(developer|engineer)\b/i.test(paragraphText)) {
            return paragraphXml;
        }

        const paragraphProps = paragraphXml.match(/<w:pPr[\s\S]*?<\/w:pPr>/)?.[0] ?? "";
        replaced = true;

        return `<w:p>${paragraphProps}${buildTitleRuns(title)}</w:p>`;
    });

    if (!replaced) return buffer;

    zip.file("word/document.xml", updatedXml);

    return zip.generateAsync({ type: "nodebuffer" });
}

async function formatSkillsLine(buffer: Buffer, skills: string): Promise<Buffer> {
    const zip = await JSZip.loadAsync(buffer);
    const documentFile = zip.file("word/document.xml");

    if (!documentFile) return buffer;

    const documentXml = await documentFile.async("string");
    let replaced = false;
    const updatedXml = documentXml.replace(/<w:p[\s\S]*?<\/w:p>/g, (paragraphXml: string) => {
        if (replaced) return paragraphXml;

        const paragraphText = getParagraphText(paragraphXml).replace(/\s+/g, " ").trim();

        if (!paragraphText.includes("Languages: TypeScript") || !paragraphText.includes("Backend:")) {
            return paragraphXml;
        }

        const paragraphProps = paragraphXml.match(/<w:pPr[\s\S]*?<\/w:pPr>/)?.[0] ?? "";
        replaced = true;

        return `<w:p>${paragraphProps}${buildSkillsRuns(skills)}</w:p>`;
    });

    if (!replaced) return buffer;

    zip.file("word/document.xml", updatedXml);

    return zip.generateAsync({ type: "nodebuffer" });
}

async function formatTechnologyLines(buffer: Buffer, data: ResumeTemplateData): Promise<Buffer> {
    const zip = await JSZip.loadAsync(buffer);
    const documentFile = zip.file("word/document.xml");

    if (!documentFile) return buffer;

    const documentXml = await documentFile.async("string");
    const replacements = [
        {
            match: "PostGIS",
            value: data.INETEX_TECHNOLOGIES,
        },
        {
            match: "Google OAuth",
            value: data.VTA_TECHNOLOGIES,
        },
        {
            match: "Material UI, Bootstrap",
            value: data.AVSD_TECHNOLOGIES,
        },
    ];

    const updatedXml = documentXml.replace(/<w:p[\s\S]*?<\/w:p>/g, (paragraphXml: string) => {
        const paragraphText = getParagraphText(paragraphXml).replace(/\s+/g, " ").trim();
        if (!/^Technologies:/i.test(paragraphText)) return paragraphXml;

        const replacement = replacements.find((item) => paragraphText.includes(item.match));
        if (!replacement) return paragraphXml;

        const paragraphProps = paragraphXml.match(/<w:pPr[\s\S]*?<\/w:pPr>/)?.[0] ?? "";

        return `<w:p>${paragraphProps}${buildTechnologiesRuns(replacement.value)}</w:p>`;
    });

    zip.file("word/document.xml", updatedXml);

    return zip.generateAsync({ type: "nodebuffer" });
}

export async function createResumeFromTemplate(
    data: ResumeTemplateData,
    outputPath: string,
) {
    const templatePath = path.join(
        process.cwd(),
        "templates",
        "cv-template.docx",
    );

    const template = await fs.readFile(templatePath);

    const templateData: ResumeTemplateData = {
        FULL_NAME: "Candidate",
        LOCATION: "",
        PHONE: "",
        LINKEDIN: "",
        EMAIL: "candidate@example.com",
        GITHUB: "",
        LANGUAGES: "",
        ...data,
    };

    const buffer = await createReport({
        template,
        data: templateData,
        cmdDelimiter: ["{{", "}}"],
        processLineBreaks: true,
    });
    const titleFormattedBuffer = await formatTitleLine(Buffer.from(buffer), templateData.TITLE);
    const skillsFormattedBuffer = await formatSkillsLine(titleFormattedBuffer, templateData.SKILLS);
    const formattedBuffer = await formatTechnologyLines(skillsFormattedBuffer, templateData);

    await fs.mkdir(path.dirname(outputPath), {
        recursive: true,
    });

    await fs.writeFile(outputPath, formattedBuffer);

    return outputPath;
}
