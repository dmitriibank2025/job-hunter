import fs from "fs/promises";
import path from "path";
import { prisma } from "../infrastructure/prisma";
import { ensureDir, getStorageRoot } from "../services/file-storage.service";

function storageRelative(filePath?: string | null) {
    if (!filePath) return null;
    const normalized = filePath.replace(/\\/g, "/");
    const marker = "/storage/";
    const markerIndex = normalized.indexOf(marker);
    if (markerIndex >= 0) return normalized.slice(markerIndex + marker.length);
    const storageIndex = normalized.indexOf("storage/");
    if (storageIndex >= 0) return normalized.slice(storageIndex + "storage/".length);
    return normalized.replace(/^\/+/, "");
}

function migrateRelativePath(relativePath: string, userId: string) {
    const normalized = relativePath.replace(/\\/g, "/");
    const match = /^resumes\/([^/]+)\/(.+)$/i.exec(normalized);
    if (!match) return null;
    if (match[1] === userId) return normalized;
    if (/^[0-9a-f-]{36}$/i.test(match[1])) return normalized;
    return `resumes/${userId}/${match[1]}/${match[2]}`;
}

function legacyRelativePath(relativePath: string, userId: string) {
    const normalized = relativePath.replace(/\\/g, "/");
    const prefix = `resumes/${userId}/`;
    return normalized.startsWith(prefix) ? `resumes/${normalized.slice(prefix.length)}` : normalized;
}

function storageRoots() {
    return Array.from(new Set([
        getStorageRoot(),
        path.join(process.cwd(), "..", "storage"),
    ].map((root) => path.resolve(root))));
}

async function pathExists(filePath: string) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

async function findStorageFile(relativePath: string) {
    for (const root of storageRoots()) {
        const candidate = path.join(root, relativePath);
        if (await pathExists(candidate)) return candidate;
    }
    return null;
}

function storageDestination(relativePath: string) {
    return path.join(path.resolve(process.cwd(), "..", "storage"), relativePath);
}

async function moveStorageFile(currentPath: string | null | undefined, userId: string) {
    const relative = storageRelative(currentPath);
    if (!relative) return currentPath ?? null;

    const migratedRelative = migrateRelativePath(relative, userId);
    if (!migratedRelative || migratedRelative === relative) return currentPath ?? relative;

    const source = await findStorageFile(relative);
    const destination = storageDestination(migratedRelative);

    if (!source) return currentPath ?? relative;
    if (process.argv.includes("--dry-run")) return destination;

    await ensureDir(path.dirname(destination));

    try {
        await fs.access(destination);
    } catch {
        await fs.copyFile(source, destination);
    }

    return destination;
}

async function copyIfExists(source: string, destination: string, dryRun: boolean) {
    if (dryRun) return true;

    await ensureDir(path.dirname(destination));

    if (!(await pathExists(destination))) {
        await fs.copyFile(source, destination);
    }

    return true;
}

async function copyStorageSidecar(
    migratedFilePath: string | null | undefined,
    userId: string,
    extension: string,
    dryRun: boolean,
) {
    const migratedRelative = storageRelative(migratedFilePath);
    if (!migratedRelative || !/\.docx$/i.test(migratedRelative)) return null;

    const destinationRelative = migratedRelative.replace(/\.docx$/i, extension);
    const legacyRelative = legacyRelativePath(destinationRelative, userId);
    const source = await findStorageFile(destinationRelative) ?? await findStorageFile(legacyRelative);
    const destination = storageDestination(destinationRelative);

    if (!source) return null;

    await copyIfExists(source, destination, dryRun);
    return destination;
}

async function copyResumeSidecars(migratedFilePath: string | null | undefined, userId: string, dryRun: boolean) {
    const pdfFilePath = await copyStorageSidecar(migratedFilePath, userId, ".pdf", dryRun);
    await copyStorageSidecar(migratedFilePath, userId, ".md", dryRun);
    return pdfFilePath;
}

async function copyCoverLetterSidecar(migratedFilePath: string | null | undefined, userId: string, dryRun: boolean) {
    const migratedRelative = storageRelative(migratedFilePath);
    if (!migratedRelative || !/cover-letter\.docx$/i.test(migratedRelative)) return;

    const destinationRelative = migratedRelative.replace(/cover-letter\.docx$/i, "cover-letter.txt");
    const legacyRelative = legacyRelativePath(destinationRelative, userId);
    const source = await findStorageFile(destinationRelative) ?? await findStorageFile(legacyRelative);
    if (!source) return;

    await copyIfExists(source, storageDestination(destinationRelative), dryRun);
}

async function main() {
    const dryRun = process.argv.includes("--dry-run");
    const resumes = await prisma.resumeVersion.findMany({
        where: {
            OR: [
                { filePath: { contains: "/resumes/" } },
                { filePath: { startsWith: "resumes/" } },
                { pdfFilePath: { contains: "/resumes/" } },
                { pdfFilePath: { startsWith: "resumes/" } },
            ],
        },
        select: {
            id: true,
            userId: true,
            filePath: true,
            pdfFilePath: true,
        },
    });
    const coverLetters = await prisma.coverLetter.findMany({
        where: {
            OR: [
                { filePath: { contains: "/resumes/" } },
                { filePath: { startsWith: "resumes/" } },
            ],
        },
        select: {
            id: true,
            userId: true,
            filePath: true,
        },
    });

    let movedResumes = 0;
    let movedCoverLetters = 0;

    for (const resume of resumes) {
        const filePath = await moveStorageFile(resume.filePath, resume.userId);
        const movedPdfFilePath = await moveStorageFile(resume.pdfFilePath, resume.userId);
        const sidecarPdfFilePath = await copyResumeSidecars(filePath, resume.userId, dryRun);
        const pdfFilePath = movedPdfFilePath ?? sidecarPdfFilePath ?? resume.pdfFilePath;

        if (filePath !== resume.filePath || pdfFilePath !== resume.pdfFilePath) {
            movedResumes++;
            if (!dryRun) {
                await prisma.resumeVersion.update({
                    where: { id: resume.id },
                    data: { filePath, pdfFilePath },
                });
            }
        }
    }

    for (const coverLetter of coverLetters) {
        const filePath = await moveStorageFile(coverLetter.filePath, coverLetter.userId);
        await copyCoverLetterSidecar(filePath, coverLetter.userId, dryRun);

        if (filePath !== coverLetter.filePath) {
            movedCoverLetters++;
            if (!dryRun) {
                await prisma.coverLetter.update({
                    where: { id: coverLetter.id },
                    data: { filePath },
                });
            }
        }
    }

    console.log(JSON.stringify({
        dryRun,
        resumes: resumes.length,
        coverLetters: coverLetters.length,
        movedResumes,
        movedCoverLetters,
    }, null, 2));
}

main()
    .catch((error) => {
        console.error(error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
