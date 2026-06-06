import path from "path";
import { PrismaClient } from "@prisma/client";
import { createCoverLetterDocx } from "../services/docx.service";
import { ensureDir, getStorageRoot, slugify } from "../services/file-storage.service";

const prisma = new PrismaClient();

function hasGreeting(content: string): boolean {
    return /^(dear|hello|hi)\b/i.test(content.trim());
}

function hasSignature(content: string, fullName: string): boolean {
    const normalized = content.toLowerCase();
    const firstName = fullName.split(/\s+/)[0]?.toLowerCase();

    return (
        /\b(sincerely|best regards|kind regards|regards|thank you)\b/i.test(content) &&
        (normalized.includes(fullName.toLowerCase()) || Boolean(firstName && normalized.includes(firstName)))
    );
}

function formatCoverLetter(content: string, fullName: string): string {
    let output = content
        .replace(/\r/g, "")
        .split(/\n{2,}/)
        .map((block) => block.trim())
        .filter(Boolean)
        .join("\n\n");

    if (!hasGreeting(output)) {
        output = `Dear Hiring Manager,\n\n${output}`;
    }

    if (!hasSignature(output, fullName)) {
        output = `${output.replace(/\s+$/g, "")}\n\nSincerely,\n${fullName}`;
    }

    return output;
}

async function main() {
    const profile = await prisma.candidateProfile.findFirst({
        orderBy: { createdAt: "desc" },
    });
    const fullName = profile?.fullName || "Dmitrii Bank";
    const letters = await prisma.coverLetter.findMany({
        include: { job: true },
    });

    let updated = 0;

    for (const letter of letters) {
        const folderName = slugify(`${letter.job.company ?? "unknown"}-${letter.job.title}`);
        const dir = path.join(getStorageRoot(), "resumes", folderName);
        const filePath = path.join(dir, "cover-letter.docx");
        const content = formatCoverLetter(letter.content, fullName);

        await ensureDir(dir);
        await createCoverLetterDocx(content, filePath);
        await prisma.coverLetter.update({
            where: { id: letter.id },
            data: {
                content,
                filePath,
            },
        });

        updated++;
    }

    console.log(JSON.stringify({ updated }, null, 2));
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
