import { JobProvider } from "./job-provider";
import { ParsedJob } from "./types";
import {
    cleanJobTitle,
    createProviderBrowser,
    extractDescription,
    filterRelevantJobs,
    getSearchLocation,
    isLikelyJobUrl,
    isRelevantJobText,
    newProviderPage,
    shouldFetchProviderDetails,
} from "./browser-provider-utils";
import { updateAutomationProgress } from "../services/job-automation-progress.service";
import {
    getPrioritizedCompanyTargets,
    recordCompanyScanResult,
} from "../services/company-priority.service";

export type CompanyTarget = {
    name: string;
    locationHint?: string;
    careerUrl?: string;
};

type JobCard = {
    title: string;
    url: string;
    location?: string;
    description?: string;
};

type CareerPageResult = {
    jobs: ParsedJob[];
    error?: string;
};

function positiveNumber(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeNumber(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

const STACK_FIT_COMPANIES = new Set([
    "Microsoft Israel R&D Center",
    "monday.com",
    "SAP Israel R&D Center",
    "Palo Alto Networks",
    "Salesforce Israel",
    "CyberArk",
    "Silverfort",
    "Panaya",
    "Intuit Israel",
    "Autodesk Israel",
    "AppsFlyer",
    "Cyera",
    "Overwolf",
    "Rubrik Israel",
    "WSC Sports",
    "Taboola",
    "Natural Intelligence",
    "Google Israel",
    "ServiceNow Israel",
    "Meta Israel",
    "Imperva",
    "Amazon Israel",
    "Akamai Technologies",
    "LSports",
    "Apple Israel",
    "mavens by Zynga",
    "Semperis",
    "Remitly Israel",
    "Lemonade",
    "Innovid",
    "Aidoc",
    "BigID",
    "eToro",
    "Varonis",
    "Riskified",
    "NICE",
    "Verint",
    "Orca Security",
    "Coralogix",
    "Optibus",
    "Glassbox",
    "Digital Turbine",
    "Optimove",
    "Check Point Software Technologies",
    "Guesty",
    "Wix",
    "Fiverr",
    "Snyk",
    "WalkMe",
    "Rapyd",
    "Melio",
    "Redis",
    "Similarweb",
    "Kaltura",
    "Gong",
    "HiBob",
    "Lusha",
    "BigPanda",
    "Chargeflow",
    "Island",
    "Cato Networks",
    "Armis",
    "Bringg",
    "Yotpo",
    "Personetics",
    "Moon Active",
    "Playtika",
    "Radware",
    "Cellebrite",
    "Tufin",
    "Fireblocks",
    "Unity Israel",
    "Oracle Israel",
    "IBM Israel",
    "Tikal",
    "Rivery",
    "JFrog",
    "Prytek",
    "Papaya Global",
    "Wiz",
    "SentinelOne",
    "Aqua Security",
    "Moonshot",
    "Next Insurance",
    "Connecteam",
    "KELA",
    "Lynx",
    "Groundcover",
    "Forter",
]);

export const CENTER_ISRAEL_COMPANY_TARGETS: CompanyTarget[] = [
    { name: "NVIDIA Israel", locationHint: "Tel Aviv" },
    { name: "Microsoft Israel R&D Center", locationHint: "Herzliya" },
    { name: "monday.com", locationHint: "Tel Aviv" },
    { name: "SAP Israel R&D Center", locationHint: "Ra'anana" },
    { name: "Palo Alto Networks", locationHint: "Tel Aviv" },
    { name: "Salesforce Israel", locationHint: "Herzliya" },
    { name: "CyberArk", locationHint: "Petah Tikva" },
    { name: "Silverfort", locationHint: "Tel Aviv" },
    { name: "Panaya", locationHint: "Ramat Gan" },
    { name: "Intuit Israel", locationHint: "Tel Aviv" },
    { name: "Autodesk Israel", locationHint: "Tel Aviv" },
    { name: "AppsFlyer", locationHint: "Herzliya" },
    { name: "Cyera", locationHint: "Tel Aviv" },
    { name: "Overwolf", locationHint: "Ra'anana" },
    { name: "Rubrik Israel", locationHint: "Tel Aviv" },
    { name: "WSC Sports", locationHint: "Ramat Gan" },
    { name: "Taboola", locationHint: "Tel Aviv" },
    { name: "Natural Intelligence", locationHint: "Tel Aviv" },
    { name: "Google Israel", locationHint: "Tel Aviv" },
    { name: "ServiceNow Israel", locationHint: "Tel Aviv" },
    { name: "Meta Israel", locationHint: "Tel Aviv" },
    { name: "Imperva", locationHint: "Tel Aviv" },
    { name: "Amazon Israel", locationHint: "Herzliya" },
    { name: "Akamai Technologies", locationHint: "Herzliya" },
    { name: "LSports", locationHint: "Tel Aviv" },
    { name: "Apple Israel", locationHint: "Herzliya" },
    { name: "mavens by Zynga", locationHint: "Tel Aviv" },
    { name: "Semperis", locationHint: "Tel Aviv" },
    { name: "Intel Israel", locationHint: "Haifa" },
    { name: "Remitly Israel", locationHint: "Tel Aviv" },
    { name: "Lemonade", locationHint: "Tel Aviv" },
    { name: "Innovid", locationHint: "Tel Aviv" },
    { name: "Aidoc", locationHint: "Tel Aviv" },
    { name: "BigID", locationHint: "Tel Aviv" },
    { name: "eToro", locationHint: "Tel Aviv" },
    { name: "Varonis", locationHint: "Tel Aviv" },
    { name: "Riskified", locationHint: "Tel Aviv" },
    { name: "NICE", locationHint: "Ra'anana" },
    { name: "Verint", locationHint: "Ra'anana" },
    { name: "Orca Security", locationHint: "Tel Aviv" },
    { name: "Pluri", locationHint: "Rehovot" },
    { name: "Coralogix", locationHint: "Tel Aviv" },
    { name: "Optibus", locationHint: "Tel Aviv" },
    { name: "Glassbox", locationHint: "Ramat Gan" },
    { name: "Digital Turbine", locationHint: "Tel Aviv" },
    { name: "Optimove", locationHint: "Tel Aviv" },
    { name: "Check Point Software Technologies", locationHint: "Tel Aviv" },
    { name: "Aeronautics", locationHint: "Yavne" },
    { name: "Priority Software", locationHint: "Rosh HaAyin" },
    { name: "Guesty", locationHint: "Tel Aviv" },
    { name: "Wix", locationHint: "Tel Aviv" },
    { name: "Fiverr", locationHint: "Tel Aviv" },
    { name: "Snyk", locationHint: "Tel Aviv" },
    { name: "WalkMe", locationHint: "Tel Aviv" },
    { name: "Rapyd", locationHint: "Tel Aviv" },
    { name: "Melio", locationHint: "Tel Aviv" },
    { name: "Redis", locationHint: "Tel Aviv" },
    { name: "Similarweb", locationHint: "Tel Aviv" },
    { name: "Kaltura", locationHint: "Ramat Gan" },
    { name: "Gong", locationHint: "Tel Aviv" },
    { name: "HiBob", locationHint: "Tel Aviv" },
    { name: "Lusha", locationHint: "Tel Aviv" },
    { name: "BigPanda", locationHint: "Tel Aviv" },
    { name: "Chargeflow", locationHint: "Tel Aviv" },
    { name: "Island", locationHint: "Tel Aviv" },
    { name: "Cato Networks", locationHint: "Tel Aviv" },
    { name: "Armis", locationHint: "Tel Aviv" },
    { name: "Bringg", locationHint: "Tel Aviv" },
    { name: "Yotpo", locationHint: "Tel Aviv" },
    { name: "Personetics", locationHint: "Tel Aviv" },
    { name: "Moon Active", locationHint: "Tel Aviv" },
    { name: "Playtika", locationHint: "Herzliya" },
    { name: "Radware", locationHint: "Ra'anana" },
    { name: "Cellebrite", locationHint: "Petah Tikva" },
    { name: "Matrix", locationHint: "Herzliya" },
    { name: "Aman Group", locationHint: "Ramat Gan" },
    { name: "Ness Technologies", locationHint: "Ramat Gan" },
    { name: "Tufin", locationHint: "Tel Aviv" },
    { name: "Fireblocks", locationHint: "Tel Aviv" },
    { name: "Unity Israel", locationHint: "Tel Aviv" },
    { name: "Oracle Israel", locationHint: "Petah Tikva" },
    { name: "IBM Israel", locationHint: "Tel Aviv" },
    { name: "Tikal", locationHint: "Tel Aviv" },
    { name: "Rivery", locationHint: "Tel Aviv" },
    { name: "JFrog", locationHint: "Tel Aviv" },
    { name: "Prytek", locationHint: "Tel Aviv" },
    { name: "Papaya Global", locationHint: "Tel Aviv" },
    { name: "Wiz", locationHint: "Tel Aviv" },
    { name: "SentinelOne", locationHint: "Tel Aviv" },
    { name: "Aqua Security", locationHint: "Tel Aviv" },
    { name: "Moonshot", locationHint: "Herzliya" },
    { name: "Next Insurance", locationHint: "Tel Aviv" },
    { name: "HiBob", locationHint: "Tel Aviv" },
    { name: "Connecteam", locationHint: "Tel Aviv" },
    { name: "KELA", locationHint: "Tel Aviv" },
    { name: "Lynx", locationHint: "Tel Aviv" },
    { name: "Groundcover", locationHint: "Tel Aviv" },
    { name: "Forter", locationHint: "Tel Aviv" },
    { name: "Elementor", locationHint: "Ramat Gan" },
    { name: "Outbrain", locationHint: "Netanya" },
    { name: "Mobileye", locationHint: "Jerusalem" },
    { name: "Tabnine", locationHint: "Tel Aviv" },
    { name: "Deel", locationHint: "Tel Aviv" },
    { name: "Fortinet Israel", locationHint: "Tel Aviv" },
    { name: "Guardio", locationHint: "Tel Aviv" },
    { name: "Lightricks", locationHint: "Jerusalem" },
    { name: "Via", locationHint: "Tel Aviv" },
    { name: "Payoneer", locationHint: "Petah Tikva" },
    { name: "Houzz", locationHint: "Tel Aviv" },
];

function normalizeLocation(value?: string | null): string {
    return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function matchesSearchLocation(company: CompanyTarget, searchLocation: string): boolean {
    const normalizedSearchLocation = normalizeLocation(searchLocation);

    if (!normalizedSearchLocation || normalizedSearchLocation === "israel") return true;

    return normalizeLocation(company.locationHint) === normalizedSearchLocation;
}

export function getCenterIsraelCompanyTargets(searchLocation = getSearchLocation()): Array<CompanyTarget & { careerUrl: string }> {
    const seen = new Set<string>();

    return CENTER_ISRAEL_COMPANY_TARGETS
        .filter((company) => matchesSearchLocation(company, searchLocation))
        .filter((company) => {
            const key = company.name.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .map((company) => ({
            ...company,
            careerUrl: resolveCareerUrl(company.name),
        }))
        .filter((company): company is CompanyTarget & { careerUrl: string } => Boolean(company.careerUrl));
}

export async function getPrioritizedCenterIsraelCompanyTargets(
    searchLocation = getSearchLocation(),
): Promise<Array<CompanyTarget & { careerUrl: string }>> {
    const baseTargets = getCenterIsraelCompanyTargets(searchLocation);
    const prioritized = await getPrioritizedCompanyTargets(baseTargets, {
        limit: positiveNumber(process.env.CENTER_ISRAEL_ACTIVE_COMPANY_LIMIT, 100),
    });

    const targets: Array<CompanyTarget & { careerUrl: string }> = [];

    for (const company of prioritized) {
        const careerUrl = company.careerUrl ?? resolveCareerUrl(company.name);
        if (!careerUrl) continue;

        targets.push({
            name: company.name,
            locationHint: company.locationHint,
            careerUrl,
        });
    }

    return targets;
}

function resolveCareerUrl(name: string): string | undefined {
    const map: Record<string, string> = {
        "Microsoft Israel R&D Center": "https://careers.microsoft.com/professionals/us/en/l-israel",
        "monday.com": "https://monday.com/careers",
        "SAP Israel R&D Center": "https://jobs.sap.com/search/?createNewAlert=false&q=&locationsearch=Israel",
        "Palo Alto Networks": "https://jobs.paloaltonetworks.com/",
        "Salesforce Israel": "https://careers.salesforce.com/en/jobs/",
        "CyberArk": "https://www.cyberark.com/careers/",
        "Intuit Israel": "https://jobs.intuit.com/",
        "Autodesk Israel": "https://www.autodesk.com/careers",
        "AppsFlyer": "https://careers.appsflyer.com/",
        "Cyera": "https://cyera.com/careers/",
        "Overwolf": "https://overwolf.com/careers/",
        "Rubrik Israel": "https://www.rubrik.com/company/careers",
        "Taboola": "https://www.taboola.com/careers",
        "Google Israel": "https://careers.google.com/jobs/results/?location=Israel",
        "Amazon Israel": "https://www.amazon.jobs/en/search?country%5B%5D=ISR",
        "Apple Israel": "https://jobs.apple.com/en-il/search",
        "Semperis": "https://www.semperis.com/careers/",
        "Innovid": "https://job-boards.greenhouse.io/innovid",
        "Aidoc": "https://www.aidoc.com/careers",
        "BigID": "https://bigid.com/company/careers/",
        "eToro": "https://www.etoro.com/careers/",
        "Varonis": "https://www.varonis.com/careers",
        "Riskified": "https://www.riskified.com/careers/",
        "NICE": "https://www.nice.com/careers",
        "Verint": "https://www.verint.com/careers",
        "Orca Security": "https://orca.security/about/careers/",
        "Coralogix": "https://coralogix.com/careers/",
        "Optibus": "https://www.optibus.com/careers/",
        "Glassbox": "https://www.glassbox.com/company/careers/",
        "Digital Turbine": "https://www.digitalturbine.com/careers/",
        "Optimove": "https://www.optimove.com/careers",
        "Check Point Software Technologies": "https://www.checkpoint.com/careers/",
        "Guesty": "https://www.guesty.com/careers/",
        "Wix": "https://www.wix.com/jobs",
        "Fiverr": "https://www.fiverr.com/jobs",
        "Snyk": "https://snyk.com/careers",
        "WalkMe": "https://www.walkme.com/careers/",
        "Rapyd": "https://www.rapyd.net/careers/",
        "Melio": "https://www.meliopayments.com/careers",
        "Redis": "https://redis.io/company/careers/",
        "Similarweb": "https://www.similarweb.com/careers/",
        "Kaltura": "https://corp.kaltura.com/careers/",
        "Gong": "https://www.gong.io/careers/",
        "HiBob": "https://www.hibob.com/careers/",
        "Lusha": "https://www.lusha.com/careers/",
        "BigPanda": "https://www.bigpanda.io/careers/",
        "Chargeflow": "https://chargeflow.io/careers/",
        "Island": "https://www.island.io/careers/",
        "Cato Networks": "https://www.catonetworks.com/careers/",
        "Armis": "https://www.armis.com/careers/",
        "Bringg": "https://www.bringg.com/careers/",
        "Yotpo": "https://www.yotpo.com/careers/",
        "Personetics": "https://www.personetics.com/careers/",
        "Moon Active": "https://www.moonactive.com/careers/",
        "Playtika": "https://www.playtika.com/careers/",
        "Radware": "https://www.radware.com/careers/",
        "Cellebrite": "https://cellebrite.com/en/about/careers/positions/",
        "Tufin": "https://www.tufin.com/careers/",
        "Fireblocks": "https://www.fireblocks.com/careers/",
        "Unity Israel": "https://careers.unity.com/",
        "IBM Israel": "https://www.ibm.com/careers/search",
        "Tikal": "https://www.tikalk.com/careers/",
        "Rivery": "https://rivery.io/careers/",
        "JFrog": "https://jfrog.com/careers/",
        "Papaya Global": "https://www.papayaglobal.com/careers/",
        "Wiz": "https://www.wiz.io/careers",
        "SentinelOne": "https://www.sentinelone.com/careers/",
        "Aqua Security": "https://www.aquasec.com/careers/",
        "Next Insurance": "https://www.nextinsurance.com/careers/",
        "Connecteam": "https://connecteam.com/careers/",
        "KELA": "https://www.kelacyber.com/careers/",
        "Groundcover": "https://www.groundcover.com/careers/",
        "Forter": "https://www.forter.com/careers/",
        "NVIDIA Israel": "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite",
        "LSports": "https://www.lsports.eu/careers/",
        "mavens by Zynga": "https://www.take2games.com/careers/",
        "Remitly Israel": "https://www.remitly.com/careers",
        "WSC Sports": "https://www.wsc-sports.com/careers/",
        "Natural Intelligence": "https://www.naturalint.com/careers/",
        "Akamai Technologies": "https://www.akamai.com/careers",
        "Imperva": "https://www.imperva.com/company/careers/",
        "Oracle Israel": "https://careers.oracle.com/",
        "Moonshot": "https://www.moonshot.com/careers/",
        "Aman Group": "https://www.amangroup.co.il/careers/",
        "Matrix": "https://www.matrix.co.il/careers/",
        "Ness Technologies": "https://www.ness-tech.co.il/careers/",
        "Priority Software": "https://www.priority-software.com/careers/",
        "Aeronautics": "https://aeronautics-sys.com/careers/",
        "Pluri": "https://pluristems.com/careers/",
        "Elementor": "https://elementor.com/careers/",
        "Outbrain": "https://www.outbrain.com/careers/",
        "Mobileye": "https://careers.mobileye.com/",
        "Tabnine": "https://www.tabnine.com/careers/",
        "Deel": "https://www.deel.com/careers/",
        "Fortinet Israel": "https://www.fortinet.com/corporate/careers",
        "Guardio": "https://guard.io/careers",
        "Lightricks": "https://www.lightricks.com/careers/",
        "Via": "https://ridewithvia.com/careers/",
        "Payoneer": "https://www.payoneer.com/careers/",
        "Houzz": "https://www.houzz.com/jobs",
    };

    return map[name];
}

function uniqueCards(cards: JobCard[]): JobCard[] {
    const seen = new Set<string>();
    const unique: JobCard[] = [];

    for (const card of cards) {
        const title = cleanJobTitle(normalizeCardTitle(card.title, card.url));
        const key = `${card.url}|${title}`.toLowerCase();

        if (!title || !card.url || seen.has(key)) continue;

        seen.add(key);
        unique.push({
            ...card,
            title,
            location: card.location?.replace(/\s+/g, " ").trim() || undefined,
            description: card.description?.replace(/\s+/g, " ").trim() || undefined,
        });
    }

    return unique;
}

function titleFromJobUrl(url?: string | null): string | undefined {
    if (!url) return undefined;

    try {
        const parsed = new URL(url);
        const ignored = new Set([
            "about",
            "career",
            "careers",
            "en",
            "en-us",
            "en-gb",
            "jobs",
            "job",
            "positions",
            "position",
            "search",
            "results",
            "openings",
            "opening",
            "israel",
        ]);
        const parts = parsed.pathname
            .split("/")
            .map((part) => decodeURIComponent(part).replace(/\.[a-z0-9]+$/i, "").trim())
            .filter((part) => part && !ignored.has(part.toLowerCase()) && !/^\d+$/.test(part));
        const slug = parts.find((part) => /[a-z][-_][a-z]/i.test(part));

        if (!slug) return undefined;

        return slug
            .replace(/[-_]+/g, " ")
            .replace(/\b\w/g, (letter) => letter.toUpperCase())
            .replace(/\bAi\b/g, "AI")
            .replace(/\bBe\b/g, "BE")
            .replace(/\bQa\b/g, "QA")
            .replace(/\bUi\b/g, "UI")
            .replace(/\bUx\b/g, "UX");
    } catch {
        return undefined;
    }
}

function normalizeCardTitle(title: string, url?: string | null): string {
    const cleaned = cleanJobTitle(
        title
            .replace(/\b(view|see|open|apply)\s+(position|job|role)\b/gi, "")
            .replace(/\b(position|job|role)\s+(view|details)\b/gi, "")
            .trim(),
    );
    const urlTitle = titleFromJobUrl(url);

    if (!urlTitle) return cleaned;
    if (!cleaned || /^(view|apply|open|learn more|details|job|position)$/i.test(cleaned)) return urlTitle;
    if (cleaned.length < 8) return urlTitle;

    const normalizedUrlTitle = urlTitle.toLowerCase();
    const normalizedCleaned = cleaned.toLowerCase();

    if (!normalizedUrlTitle.includes(normalizedCleaned) && !normalizedCleaned.includes(normalizedUrlTitle)) {
        return urlTitle;
    }

    return cleaned;
}

function hasJobUrlHint(url?: string | null): boolean {
    return Boolean(url && /(job|jobs|career|careers|position|opening|requisition|req|greenhouse|lever|workday|ashby|comeet|smartrecruiters)/i.test(url));
}

function isLikelyCareerJobCard(card: JobCard): boolean {
    const haystack = [card.title, card.location ?? "", card.description ?? "", card.url].join(" ");

    if (!isLikelyJobUrl(card.url)) return false;
    if (!hasJobUrlHint(card.url) && !isRelevantJobText(haystack)) return false;

    return isRelevantJobText(haystack) || /engineer|developer|software|platform|cloud|web|full.?stack|backend|frontend/i.test(haystack);
}

async function extractCardsFromPage(
    page: Awaited<ReturnType<typeof newProviderPage>>,
    company: CompanyTarget,
): Promise<JobCard[]> {
    const cards = await page.evaluate(new Function("companyLocationHint", `
        const cards = [];
        const textOf = (node) => (node && node.textContent ? node.textContent : "").replace(/\\s+/g, " ").trim();

        for (const link of Array.from(document.querySelectorAll("a[href]"))) {
            const container = link.closest("article, li, section, div");
            const titleNode = container && container.querySelector("h1,h2,h3,h4,[class*='title'],[class*='role'],[class*='position'],[data-testid*='title']");
            const title = (textOf(titleNode) || link.getAttribute("aria-label") || textOf(link)).replace(/\\s+/g, " ").trim();
            const locationNode = container && container.querySelector("[class*='location'],[class*='office'],[data-testid*='location']");
            const location = textOf(locationNode) || companyLocationHint || undefined;
            const description = container ? textOf(container).slice(0, 800) : undefined;

            if (title && link.href) {
                cards.push({
                    title,
                    url: link.href,
                    location,
                    description,
                });
            }
        }

        const pushJob = (value) => {
            if (!value || typeof value !== "object") return;

            const record = value;
            const typeValue = record["@type"];
            const types = Array.isArray(typeValue) ? typeValue : [typeValue];
            const looksLikeJob = types.some((type) => String(type).toLowerCase() === "jobposting") ||
                Boolean(record.title && (record.hiringOrganization || record.jobLocation || record.employmentType));

            if (!looksLikeJob) return;

            const locationValue = Array.isArray(record.jobLocation) ? record.jobLocation[0] : record.jobLocation;
            const address = locationValue?.address;
            const location = [
                address?.addressLocality,
                address?.addressRegion,
                address?.addressCountry,
            ].filter(Boolean).join(", ") || companyLocationHint;

            cards.push({
                title: String(record.title || "").trim(),
                url: String(record.url || globalThis.location.href),
                location,
                description: String(record.description || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
            });
        };

        const visit = (value) => {
            if (!value) return;
            if (Array.isArray(value)) {
                value.forEach(visit);
                return;
            }
            if (typeof value !== "object") return;

            pushJob(value);
            for (const child of Object.values(value)) {
                if (child && (Array.isArray(child) || typeof child === "object")) visit(child);
            }
        };

        for (const script of Array.from(document.querySelectorAll("script[type='application/ld+json']"))) {
            try {
                visit(JSON.parse(script.textContent || ""));
            } catch {
                // Ignore malformed vendor JSON-LD.
            }
        }

        return cards;
    `) as (companyLocationHint?: string) => Array<{ title: string; url: string; location?: string; description?: string }>, company.locationHint);

    const maxCards = positiveNumber(process.env.CENTER_ISRAEL_MAX_CARDS_PER_COMPANY, 20);

    return uniqueCards(cards).filter(isLikelyCareerJobCard).slice(0, maxCards);
}

function normalizePageTitle(value?: string | null): string {
    return cleanJobTitle((value ?? "").replace(/\s*[|•·-].*$/, "").trim());
}

async function inspectJobPage(
    browser: Awaited<ReturnType<typeof createProviderBrowser>>,
    company: CompanyTarget,
    card: JobCard,
): Promise<ParsedJob | null> {
    let page: Awaited<ReturnType<typeof newProviderPage>> | undefined;
    const jobTimeoutMs = Number(process.env.CENTER_ISRAEL_JOB_TIMEOUT_MS ?? 12000);

    try {
        page = await newProviderPage(browser);
        const jobData = await Promise.race([
            (async () => {
                await page.goto(card.url, {
                    waitUntil: "domcontentloaded",
                    timeout: Math.max(5000, jobTimeoutMs),
                });

                await page.waitForTimeout(800);

                const resolvedUrl = page.url();
                const title =
                    normalizePageTitle(
                        (await page
                            .locator("h1, [data-testid*='job-title'], [class*='job-title'], [class*='title']")
                            .first()
                            .textContent({ timeout: 2500 })
                            .catch(() => null)) ??
                            (await page.locator("meta[property='og:title']").first().getAttribute("content", { timeout: 2500 }).catch(() => null)) ??
                            (await page.title().catch(() => null)),
                    ) ||
                    normalizePageTitle(await page.title().catch(() => null));

                const companyName =
                    (await page
                        .locator("[data-testid*='company'], [class*='company'], a[href*='/company/'], a[href*='/companies/']")
                        .first()
                        .textContent({ timeout: 2500 })
                        .catch(() => null)) ??
                    company.name;

                const location =
                    (await page
                        .locator("[data-testid*='location'], [class*='location'], time + span")
                        .first()
                        .textContent({ timeout: 2500 })
                        .catch(() => null)) ??
                card.location ??
                company.locationHint;

                const description =
                    (await extractDescription(page, [
                        "[data-testid*='description']",
                        ".job-description",
                        ".jobDescription",
                        "[class*='description']",
                        "main",
                    ])) ??
                    (await page.locator("body").textContent({ timeout: 4000 }).catch(() => null))?.trim();

                const postedAtText = await page
                    .locator("time, [data-testid*='posted'], [class*='posted']")
                    .first()
                    .textContent({ timeout: 2500 })
                    .catch(() => null);

                const job: ParsedJob = {
                    title: title || card.title || company.name,
                    company: cleanCompanyName(companyName) || company.name,
                    location: location?.trim() || company.locationHint,
                    url: resolvedUrl || card.url,
                    postedAt: postedAtText ? new Date(postedAtText) : undefined,
                    source: "CENTER_ISRAEL",
                    description: description || card.description || `${card.title} ${company.name} ${card.location ?? ""}`.trim(),
                };

                const relevant = filterRelevantJobs([job]);
                return relevant[0] ?? null;
            })(),
            new Promise<null>((resolve) => {
                const timer = setTimeout(() => resolve(null), jobTimeoutMs);
                timer.unref?.();
            }),
        ]);

        return jobData;
    } catch (error) {
        console.warn(`[Center Israel] Failed to inspect job page for ${company.name}: ${(error as Error).message}`);
        return null;
    } finally {
        await page?.close().catch(() => undefined);
    }
}

function cleanCompanyName(value?: string | null): string {
    return (value ?? "").replace(/\s+/g, " ").trim();
}

function jobFromCard(company: CompanyTarget, card: JobCard): ParsedJob {
    return {
        title: card.title,
        company: company.name,
        location: card.location || company.locationHint,
        url: card.url,
        source: "CENTER_ISRAEL",
        description: card.description || `${card.title} ${company.name} ${card.location ?? ""}`.trim(),
    };
}

function isLikelySingleJobPage(url: string, title: string, text: string): boolean {
    const normalizedTitle = cleanJobTitle(title);

    if (!isLikelyJobUrl(url)) return false;
    if (!isRelevantJobText(normalizedTitle)) return false;
    if (/^(careers?|jobs?|open positions?|join us)$/i.test(normalizedTitle)) return false;

    return isRelevantJobText(text);
}

async function inspectCareerPage(
    browser: Awaited<ReturnType<typeof createProviderBrowser>>,
    company: CompanyTarget,
    url: string,
): Promise<CareerPageResult> {
    let page: Awaited<ReturnType<typeof newProviderPage>> | undefined;
    try {
        page = await newProviderPage(browser);
        await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 30000,
        });

        await page.waitForTimeout(1200);

        const cards = await extractCardsFromPage(page, company);
        const cardJobs = filterRelevantJobs(cards.map((card) => jobFromCard(company, card)));
        const jobs: ParsedJob[] = [];
        const maxDetailPages = nonNegativeNumber(
            process.env.CENTER_ISRAEL_MAX_DETAIL_PAGES,
            shouldFetchProviderDetails() ? 8 : 0,
        );

        if (maxDetailPages <= 0) {
            return { jobs: cardJobs };
        }

        for (const card of cards.slice(0, maxDetailPages)) {
            if (!isLikelyJobUrl(card.url)) continue;

            const job = await inspectJobPage(browser, company, card);
            if (job) jobs.push(job);
        }

        const mergedJobs = filterRelevantJobs([...jobs, ...cardJobs]);

        if (mergedJobs.length > 0) {
            return { jobs: mergedJobs };
        }

        const title = await page.title().catch(() => "");
        const body = await page.locator("body").textContent({ timeout: 5000 }).catch(() => "");
        const text = `${title} ${body ?? ""}`.replace(/\s+/g, " ").trim();

        if (!isLikelySingleJobPage(url, title, text)) {
            return { jobs: [] };
        }

        return {
            jobs: [{
                title: cleanJobTitle(title || company.name),
                company: company.name,
                location: company.locationHint,
                url,
                source: "CENTER_ISRAEL",
                description: text.slice(0, 1200),
            }],
        };
    } catch (error) {
        const message = (error as Error).message || "Unknown career page error";
        console.warn(`[Center Israel] Failed to scan ${company.name} (${url}): ${message}`);
        return { jobs: [], error: message };
    } finally {
        await page?.close().catch(() => undefined);
    }
}

async function inspectCareerPageWithTimeout(
    browser: Awaited<ReturnType<typeof createProviderBrowser>>,
    company: CompanyTarget & { careerUrl: string },
): Promise<CareerPageResult> {
    const timeoutMs = positiveNumber(process.env.CENTER_ISRAEL_COMPANY_TIMEOUT_MS, 45000);

    return Promise.race([
        inspectCareerPage(browser, company, company.careerUrl),
        new Promise<CareerPageResult>((resolve) => {
            const timer = setTimeout(
                () => resolve({ jobs: [], error: `Company scan timed out after ${timeoutMs}ms` }),
                timeoutMs,
            );
            timer.unref?.();
        }),
    ]);
}

export class CenterIsraelCompaniesProvider implements JobProvider {
    source = "CENTER_ISRAEL";

    async search(): Promise<ParsedJob[]> {
        const browser = await createProviderBrowser({
            timeoutMs: Number(process.env.CENTER_ISRAEL_BROWSER_TIMEOUT_MS ?? 900000),
        });
        const jobs: ParsedJob[] = [];
        const targets = await getPrioritizedCenterIsraelCompanyTargets();
        let companiesScanned = 0;
        let careerPagesFound = 0;
        let matchedJobs = 0;
        let completedTargets = 0;
        const concurrency = Math.max(1, Math.min(Number(process.env.CENTER_ISRAEL_CONCURRENCY ?? 3) || 3, 6));
        let nextIndex = 0;

        try {
            const worker = async () => {
                while (true) {
                    const index = nextIndex++;
                    if (index >= targets.length) return;

                    const company = targets[index];
                    companiesScanned = Math.max(companiesScanned, index + 1);
                    updateAutomationProgress({
                        stage: "Center Israel",
                        message: `Scanning company ${index + 1}/${targets.length}: ${company.name}`,
                        percent: Math.round((completedTargets / Math.max(targets.length, 1)) * 100),
                        currentStep: 1,
                        currentTarget: company.name,
                        completedTargets,
                        totalTargets: targets.length,
                        companiesScanned,
                        careerPagesFound,
                        matchedJobs,
                    });

                    careerPagesFound += 1;
                    const result = await inspectCareerPageWithTimeout(browser, company);
                    const companyJobs = result.jobs;
                    jobs.push(...companyJobs);
                    matchedJobs += companyJobs.length;
                    completedTargets += 1;
                    await recordCompanyScanResult({
                        name: company.name,
                        locationHint: company.locationHint,
                        careerUrl: company.careerUrl,
                        jobsFound: companyJobs.length,
                        source: this.source,
                        error: result.error,
                    });

                    updateAutomationProgress({
                        stage: "Center Israel",
                        message: result.error
                            ? `Failed to scan ${company.name}: ${result.error.slice(0, 120)}`
                            : companyJobs.length > 0
                            ? `Found ${companyJobs.length} matching jobs at ${company.name}.`
                            : `Scanned career page for ${company.name}.`,
                        percent: Math.round((completedTargets / Math.max(targets.length, 1)) * 100),
                        currentStep: 1,
                        currentTarget: company.name,
                        completedTargets,
                        totalTargets: targets.length,
                        companiesScanned,
                        careerPagesFound,
                        matchedJobs,
                    });
                }
            };

            await Promise.all(Array.from({ length: concurrency }, () => worker()));

            updateAutomationProgress({
                stage: "Center Israel",
                message: `Finished scanning ${targets.length} companies.`,
                percent: 100,
                currentStep: 1,
                currentTarget: null,
                completedTargets: targets.length,
                totalTargets: targets.length,
                companiesScanned,
                careerPagesFound,
                matchedJobs,
            });
        } finally {
            await browser.close();
        }

        return filterRelevantJobs(jobs);
    }
}
