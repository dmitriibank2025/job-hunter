import { Router } from "express";
import fs from "fs";
import path from "path";
import { prisma } from "../infrastructure/prisma";
import { requireAuthUser } from "../middleware/auth.middleware";
import { getStorageRoot } from "../services/file-storage.service";
import { ensureUserDocumentForStoragePath } from "../services/user-job-repair.service";

export function createStorageRouter() {
    const router = Router();

    router.get(/^\/(.+)$/, async (req, res, next) => {
        try {
            const authUser = await requireAuthUser(req);
            const requestedPath = String(req.params[0] || "");
            const normalizedRelativePath = path.normalize(requestedPath).replace(/^(\.\.(\/|\\|$))+/, "");
            const storageRoot = path.resolve(getStorageRoot());
            const absolutePath = path.resolve(storageRoot, normalizedRelativePath);

            if (!absolutePath.startsWith(`${storageRoot}${path.sep}`)) {
                res.status(400).json({ success: false, message: "Invalid storage path." });
                return;
            }

            const candidatePaths = [absolutePath, normalizedRelativePath];
            const pairedDocxPaths = normalizedRelativePath.toLowerCase().endsWith(".pdf")
                ? [
                    absolutePath.replace(/\.pdf$/i, ".docx"),
                    normalizedRelativePath.replace(/\.pdf$/i, ".docx"),
                ]
                : [];
            const relativeSuffix = normalizedRelativePath.replace(/\\/g, "/");
            const pairedDocxSuffixes = pairedDocxPaths.map((item) => item.replace(/\\/g, "/"));
            const userFilter = authUser.role === "ADMIN" ? {} : { userId: authUser.id };
            const resumeBasePathMatch = /^users\/([^/]+)\/resume-bases\/([^/.]+)\.pdf$/i.exec(relativeSuffix);
            const [resume, coverLetter, profile, resumeBase] = await Promise.all([
                prisma.resumeVersion.findFirst({
                    where: {
                        ...userFilter,
                        OR: [
                            { filePath: { in: candidatePaths } },
                            ...(pairedDocxPaths.length ? [{ filePath: { in: pairedDocxPaths } }] : []),
                            { pdfFilePath: { in: candidatePaths } },
                            { filePath: { endsWith: relativeSuffix } },
                            { pdfFilePath: { endsWith: relativeSuffix } },
                            ...pairedDocxSuffixes.map((suffix) => ({ filePath: { endsWith: suffix } })),
                        ],
                    },
                    select: { id: true },
                }),
                prisma.coverLetter.findFirst({
                    where: {
                        ...userFilter,
                        OR: [
                            { filePath: { in: candidatePaths } },
                            { filePath: { endsWith: relativeSuffix } },
                        ],
                    },
                    select: { id: true },
                }),
                prisma.userProfile.findFirst({
                    where: {
                        ...userFilter,
                        OR: [
                            { resumeFilePath: { in: candidatePaths } },
                            { resumeFilePath: { endsWith: relativeSuffix } },
                        ],
                    },
                    select: { id: true },
                }),
                resumeBasePathMatch
                    ? prisma.userResumeBase.findFirst({
                        where: {
                            id: resumeBasePathMatch[2],
                            ...(authUser.role === "ADMIN" ? {} : { userId: authUser.id }),
                        },
                        select: { id: true },
                    })
                    : Promise.resolve(null),
            ]);

            if (!resume && !coverLetter && !profile && !resumeBase) {
                const repaired = await ensureUserDocumentForStoragePath(
                    authUser.id,
                    normalizedRelativePath,
                    absolutePath,
                );

                if (repaired) {
                    res.download(absolutePath, path.basename(absolutePath));
                    return;
                }

                res.status(403).json({ success: false, message: "You do not have access to this file." });
                return;
            }

            if (!fs.existsSync(absolutePath)) {
                res.status(404).json({ success: false, message: "File not found." });
                return;
            }

            res.download(absolutePath, path.basename(absolutePath));
        } catch (error) {
            next(error);
        }
    });

    return router;
}
