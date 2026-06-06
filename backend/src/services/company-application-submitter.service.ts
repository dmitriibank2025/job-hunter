import fs from "fs/promises";
import { Application, PrismaClient } from "@prisma/client";
import { chromium, Page } from "playwright";
import { generateApplicationPackageForJob } from "./resume-generator.service";
import { hasAppliedVacancyForJob, upsertAppliedVacancy } from "./applied-vacancy.service";
import { getWorkspaceCandidateProfile } from "./user-workspace.service";

const prisma = new PrismaClient();

type SubmitOptions = {
    userId?: string;
    autoSubmit?: boolean;
    headless?: boolean;
};

type CandidateFields = {
    fullName: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    linkedin: string;
    github: string;
    location: string;
    coverLetter: string;
};

function parsePhone(resume: string): string {
    return /Phone:\s*([^\n]+)/i.exec(resume)?.[1]?.trim() ?? "";
}

function parseLocation(resume: string): string {
    const lines = resume
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    return lines[1] ?? "";
}

function splitName(fullName: string) {
    const parts = fullName.trim().split(/\s+/);

    return {
        firstName: parts[0] ?? "",
        lastName: parts.slice(1).join(" "),
    };
}

async function getApplicationPackage(userId: string, jobId: string) {
    const existingResume = await prisma.resumeVersion.findFirst({
        where: { userId, jobId },
        orderBy: { createdAt: "desc" },
    });

    const existingCoverLetter = await prisma.coverLetter.findFirst({
        where: { userId, jobId },
        orderBy: { createdAt: "desc" },
    });

    if (existingResume && existingCoverLetter) {
        return {
            resume: existingResume,
            coverLetter: existingCoverLetter,
        };
    }

    return generateApplicationPackageForJob(jobId, { userId });
}

async function clickApplyEntry(page: Page) {
    const selectors = [
        page.getByRole("link", { name: /apply|apply now|submit application/i }).first(),
        page.getByRole("button", { name: /apply|apply now|submit application/i }).first(),
        page.locator("a,button").filter({ hasText: /apply|apply now|submit application/i }).first(),
    ];

    for (const locator of selectors) {
        try {
            if ((await locator.count()) === 0) continue;

            await locator.click({ timeout: 5000 });
            await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => undefined);
            await page.waitForTimeout(1000);
            return true;
        } catch {
            continue;
        }
    }

    return false;
}

async function fillCandidateFields(page: Page, fields: CandidateFields) {
    const elements = page.locator("input, textarea");
    const count = await elements.count();
    const filled: string[] = [];

    for (let index = 0; index < count; index += 1) {
        const element = elements.nth(index);
        const type = ((await element.getAttribute("type")) ?? "").toLowerCase();

        if (["hidden", "file", "submit", "button", "password", "checkbox", "radio"].includes(type)) {
            continue;
        }

        const text = [
            await element.getAttribute("name"),
            await element.getAttribute("id"),
            await element.getAttribute("placeholder"),
            await element.getAttribute("aria-label"),
        ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();

        const currentValue = await element.inputValue().catch(() => "");

        if (currentValue) continue;

        const fill = async (value: string, name: string) => {
            if (!value) return;

            await element.fill(value);
            filled.push(name);
        };

        if (/e-?mail|email/.test(text)) await fill(fields.email, "email");
        else if (/first\s*name|firstname|given\s*name/.test(text)) await fill(fields.firstName, "firstName");
        else if (/last\s*name|lastname|family\s*name|surname/.test(text)) await fill(fields.lastName, "lastName");
        else if (/full\s*name|fullname|name/.test(text)) await fill(fields.fullName, "fullName");
        else if (/phone|mobile|tel/.test(text)) await fill(fields.phone, "phone");
        else if (/linkedin/.test(text)) await fill(fields.linkedin, "linkedin");
        else if (/github|portfolio|website/.test(text)) await fill(fields.github, "github");
        else if (/location|city|address/.test(text)) await fill(fields.location, "location");
        else if (/cover|motivation|message|about|why/.test(text)) {
            await fill(fields.coverLetter, "coverLetter");
        }
    }

    return filled;
}

async function uploadResume(page: Page, resumePath: string) {
    await fs.access(resumePath);

    const fileInputs = page.locator("input[type='file']");
    const count = await fileInputs.count();
    const uploaded: string[] = [];

    for (let index = 0; index < count; index += 1) {
        const input = fileInputs.nth(index);

        try {
            await input.setInputFiles(resumePath);
            uploaded.push(resumePath);
        } catch {
            continue;
        }
    }

    return uploaded;
}

async function clickFinalSubmit(page: Page) {
    const selectors = [
        page.getByRole("button", { name: /submit application|submit|send application|apply now|send/i }).first(),
        page.getByRole("link", { name: /submit application|submit|send application|apply now|send/i }).first(),
        page.locator("button,input[type='submit']").filter({ hasText: /submit|send|apply/i }).first(),
    ];

    for (const locator of selectors) {
        try {
            if ((await locator.count()) === 0) continue;

            await locator.click({ timeout: 5000 });
            await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => undefined);
            await page.waitForTimeout(2000);
            return true;
        } catch {
            continue;
        }
    }

    return false;
}

export async function submitCompanyApplicationForJob(
    jobId: string,
    options: SubmitOptions = {},
): Promise<Application> {
    if (!options.userId) {
        throw new Error("userId is required for company-site submission");
    }

    const job = await prisma.job.findUnique({
        where: { id: jobId },
    });

    if (!job?.url) {
        throw new Error("Job URL is required for automated company-site submission");
    }

    if (await hasAppliedVacancyForJob(options.userId, job)) {
        throw new Error("Application skipped: this company/title already exists in applied vacancy history");
    }

    const profile = await getWorkspaceCandidateProfile(options.userId);

    if (!profile) {
        throw new Error("Candidate profile not found for this user.");
    }

    const { resume, coverLetter } = await getApplicationPackage(options.userId, jobId);

    if (!resume.filePath) {
        throw new Error("Generated resume has no filePath");
    }

    const finalSubmitAllowed = process.env.AUTO_SUBMIT_APPLICATIONS === "true";
    const shouldSubmit = options.autoSubmit === true && finalSubmitAllowed;
    const { firstName, lastName } = splitName(profile.fullName);

    const application = await prisma.application.create({
        data: {
            userId: options.userId,
            jobId,
            resumeVersionId: resume.id,
            coverLetterId: coverLetter.id,
            submitUrl: job.url,
            autoSubmit: shouldSubmit,
            status: "SUBMITTING",
        },
    });

    const browser = await chromium.launch({
        headless: options.headless ?? process.env.APPLICATION_HEADLESS !== "false",
    });

    try {
        const page = await browser.newPage();

        await page.goto(job.url, {
            waitUntil: "domcontentloaded",
            timeout: 60000,
        });

        const applyClicked = await clickApplyEntry(page);
        const filledFields = await fillCandidateFields(page, {
            fullName: profile.fullName,
            firstName,
            lastName,
            email: profile.email,
            phone: profile.phone ?? parsePhone(profile.resume),
            linkedin: profile.linkedin ?? "",
            github: profile.github ?? "",
            location: profile.location ?? parseLocation(profile.resume),
            coverLetter: coverLetter.content,
        });
        const uploadedFiles = await uploadResume(page, resume.filePath);
        const finalSubmitClicked = shouldSubmit ? await clickFinalSubmit(page) : false;
        const currentUrl = page.url();

        const status = finalSubmitClicked ? "SUBMITTED" : "NEEDS_REVIEW";

        if (finalSubmitClicked) {
            await prisma.job.update({
                where: { id: jobId },
                data: { status: "APPLIED" },
            });

            await upsertAppliedVacancy({
                userId: options.userId,
                title: job.title,
                company: job.company ?? "Unknown company",
                status: "APPLIED",
                source: "LOCAL_APPLICATION",
                jobUrl: currentUrl,
                seenAt: new Date(),
                raw: {
                    applicationId: application.id,
                    jobId,
                    finalSubmitClicked,
                },
            });
        }

        return prisma.application.update({
            where: { id: application.id },
            data: {
                status,
                submitUrl: currentUrl,
                submittedAt: finalSubmitClicked ? new Date() : null,
                formSnapshot: {
                    applyClicked,
                    filledFields,
                    uploadedFiles,
                    finalSubmitRequested: options.autoSubmit === true,
                    finalSubmitAllowed,
                    finalSubmitClicked,
                },
            },
        });
    } catch (error) {
        return prisma.application.update({
            where: { id: application.id },
            data: {
                status: "FAILED",
                error: error instanceof Error ? error.message : String(error),
            },
        });
    } finally {
        await browser.close();
    }
}
