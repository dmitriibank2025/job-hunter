import fs from "fs/promises";
import {
    Document,
    HeadingLevel,
    Packer,
    Paragraph,
    TextRun,
} from "docx";

function createParagraph(line: string): Paragraph {
    const clean = line.trim();

    if (!clean) {
        return new Paragraph("");
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
