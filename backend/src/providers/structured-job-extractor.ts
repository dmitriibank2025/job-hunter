import { stripHtml, safeDate, stableExternalId } from "./ats-provider-utils";
import { JobSource, ParsedJob } from "./types";

type JsonRecord = Record<string, unknown>;

function recordsFrom(value: unknown): JsonRecord[] {
    if (!value) return [];
    if (Array.isArray(value)) return value.flatMap(recordsFrom);
    if (typeof value !== "object") return [];
    const record = value as JsonRecord;
    const graph = recordsFrom(record["@graph"]);
    return [record, ...graph];
}

function isJobPosting(record: JsonRecord): boolean {
    const raw = record["@type"];
    const types = Array.isArray(raw) ? raw : [raw];
    return types.some((type) => String(type).toLowerCase() === "jobposting");
}

export function extractJsonLdRecords(html: string): JsonRecord[] {
    const records: JsonRecord[] = [];
    const pattern = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) !== null) {
        try {
            records.push(...recordsFrom(JSON.parse(match[1].trim())));
        } catch {
            // A malformed JSON-LD block is ignored; the caller can use DOM fallback.
        }
    }
    return records;
}

function textValue(value: unknown): string | undefined {
    if (typeof value === "string") return stripHtml(value) || undefined;
    if (typeof value === "number") return String(value);
    return undefined;
}

function organizationName(value: unknown): string | undefined {
    if (typeof value === "string") return stripHtml(value) || undefined;
    if (value && typeof value === "object") return textValue((value as JsonRecord).name);
    return undefined;
}

function addressText(value: unknown): string | undefined {
    const locations = Array.isArray(value) ? value : [value];
    const parsed: string[] = [];
    for (const location of locations) {
        if (typeof location === "string") {
            const text = stripHtml(location);
            if (text) parsed.push(text);
            continue;
        }
        if (!location || typeof location !== "object") continue;
        const record = location as JsonRecord;
        const addressValue = record.address;
        if (typeof addressValue === "string") {
            const text = stripHtml(addressValue);
            if (text) parsed.push(text);
            continue;
        }
        if (!addressValue || typeof addressValue !== "object") continue;
        const address = addressValue as JsonRecord;
        const result = [
            textValue(address.addressLocality),
            textValue(address.addressRegion),
            textValue(address.addressCountry)
                ?? (address.addressCountry && typeof address.addressCountry === "object"
                    ? textValue((address.addressCountry as JsonRecord).name)
                    : undefined),
        ].filter(Boolean).join(", ");
        if (result) parsed.push(result);
    }
    return [...new Set(parsed)].join("; ") || undefined;
}

function remoteLocationText(record: JsonRecord): string | undefined {
    const kind = Array.isArray(record.jobLocationType)
        ? record.jobLocationType.map(String).join(" ")
        : String(record.jobLocationType ?? "");
    if (!/TELECOMMUTE|remote/i.test(kind)) return undefined;
    const requirements = record.applicantLocationRequirements;
    const values = Array.isArray(requirements) ? requirements : [requirements];
    const places = values.map((value) => {
        if (typeof value === "string") return stripHtml(value);
        if (!value || typeof value !== "object") return undefined;
        const place = value as JsonRecord;
        return textValue(place.name) ?? addressText(place);
    }).filter((value): value is string => Boolean(value));
    return places.length ? `Remote - ${[...new Set(places)].join("; ")}` : "Remote";
}

function identifierValue(value: unknown): string | undefined {
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (value && typeof value === "object") {
        return textValue((value as JsonRecord).value) ?? textValue((value as JsonRecord).name);
    }
    return undefined;
}

function canonicalFromHtml(html: string): string | undefined {
    return /<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i.exec(html)?.[1]
        ?? /<meta\b[^>]*property=["']og:url["'][^>]*content=["']([^"']+)["']/i.exec(html)?.[1];
}

function absoluteHttpUrl(value: string | undefined, pageUrl: string): string {
    if (!value) return pageUrl;
    try {
        const resolved = new URL(value, pageUrl);
        return ["http:", "https:"].includes(resolved.protocol) ? resolved.toString() : pageUrl;
    } catch {
        return pageUrl;
    }
}

export function extractJobPostingFromHtml(
    html: string,
    pageUrl: string,
    source: JobSource,
): ParsedJob | null {
    const record = extractJsonLdRecords(html).find(isJobPosting);
    if (!record) return null;

    const title = textValue(record.title) ?? textValue(record.name);
    const description = textValue(record.description) ?? "";
    if (!title || !description) return null;

    const canonicalUrl = absoluteHttpUrl(textValue(record.url) ?? canonicalFromHtml(html), pageUrl);
    const applicationContact = record.applicationContact;
    const applicationUrl = typeof applicationContact === "object" && applicationContact !== null
        ? textValue((applicationContact as JsonRecord).url)
        : textValue(applicationContact);
    const applyUrl = record.directApply === true || textValue(record.directApply) === "true"
        ? canonicalUrl
        : applicationUrl ? absoluteHttpUrl(applicationUrl, canonicalUrl) : undefined;
    const externalJobId = identifierValue(record.identifier) ?? stableExternalId(canonicalUrl);
    const employmentTypeValue = record.employmentType;
    const employmentType = Array.isArray(employmentTypeValue)
        ? employmentTypeValue.map(String).join(", ")
        : textValue(employmentTypeValue);
    const location = remoteLocationText(record) ?? addressText(record.jobLocation);

    return {
        title,
        company: organizationName(record.hiringOrganization),
        location,
        url: canonicalUrl,
        applyUrl,
        externalJobId,
        postedAt: safeDate(record.datePosted as string | number | null),
        employmentType,
        source,
        description,
        ingestion: {
            classification: "job_detail",
            classificationReasons: ["JOB_POSTING_JSON_LD"],
            extractionMethod: "json_ld",
            canonicalUrl,
            fieldConfidence: {
                title: 100,
                company: organizationName(record.hiringOrganization) ? 95 : 0,
                location: location ? 90 : 0,
                postedAt: record.datePosted ? 95 : 0,
                description: 100,
                employmentType: employmentType ? 90 : 0,
                applyUrl: applyUrl ? 80 : 0,
            },
        },
    };
}

export function hasJobPostingJsonLd(html: string): boolean {
    return extractJsonLdRecords(html).some(isJobPosting);
}
