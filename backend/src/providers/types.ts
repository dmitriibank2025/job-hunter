export type JobSource =
    | "LINKEDIN"
    | "ALLJOBS"
    | "DRUSHIM"
    | "JOBMASTER"
    | "SQLINK"
    | "GOTFRIENDS"
    | "GREENHOUSE"
    | "GLASSDOOR"
    | "EMAIL_LINK"
    | "CENTER_ISRAEL"
    | "MOCK";

export type ParsedJob = {
    title: string;
    company?: string;
    location?: string;
    url?: string;
    externalJobId?: string;
    postedAt?: Date;
    source: JobSource;
    description: string;
};
