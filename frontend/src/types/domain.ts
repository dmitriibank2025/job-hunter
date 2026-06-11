export type View = "overview" | "account" | "search" | "vacancies" | "companies" | "documents" | "settings" | "admin";

export type PlanLimits = {
  vacanciesPerDay: number;
  generatedResumesPerMonth: number;
  baseResumes: number;
  searchRunsPerDay: number;
  tokenBudgetPerMonth: number;
  statistics: string;
};

export type WorkspaceUser = {
  id: string;
  email: string;
  role?: "USER" | "ADMIN";
  plan: "FREE" | "PRO";
  dailyAutomationEnabled?: boolean;
  dailyAutomationTime?: string;
  dailyAutomationTimezone?: string;
  limits?: PlanLimits;
  profile?: {
    fullName: string;
    email: string;
    location?: string;
    phone?: string;
    linkedin?: string;
    github?: string;
    portfolio?: string;
    languages?: string[];
    summary?: string;
  };
  technologies?: Array<{ name: string; category: string }>;
  experiences?: ExperienceEntry[];
  educations?: EducationEntry[];
  resumeBases?: ResumeBase[];
  linkedinAccounts?: Array<{
    email?: string;
    profileUrl?: string;
    storageStatePath?: string;
    connectedAt?: string;
    lastUsedAt?: string;
    isActive?: boolean;
  }>;
};

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresAt: string;
};

export type ExperienceEntry = {
  company: string;
  title: string;
  location?: string;
  dates: string;
  project?: string;
  description?: string;
  bullets?: string;
  technologies?: string;
};

export type EducationEntry = {
  institution: string;
  program: string;
  location?: string;
  dates?: string;
  details?: string;
};

export type ResumeBase = {
  id: string;
  name: string;
  target: string;
  targetTitle?: string;
  content: string;
  pdfFilePath?: string | null;
  isDefault?: boolean;
};

export type Job = {
  id: string;
  title: string;
  company?: string;
  location?: string;
  source?: string;
  url?: string;
  description?: string;
  matchScore?: number;
  analysis?: { recommendation?: string; reason?: string; matchedSkills?: string[]; missingSkills?: string[] };
  resumeVersions?: Array<{ id?: string; filePath?: string; pdfFilePath?: string | null; format?: string; createdAt?: string }>;
  coverLetters?: Array<{ id?: string; filePath?: string; createdAt?: string }>;
  userMatch?: {
    status?: "NEW" | "ANALYZED" | "SAVED" | "REJECTED" | "APPLIED" | "IGNORED";
    matchScore?: number;
    analysis?: { recommendation?: string; reason?: string; matchedSkills?: string[]; missingSkills?: string[] };
    appliedAt?: string;
    ignoredAt?: string;
    notes?: string;
  };
};

export type AppliedVacancy = {
  id: string;
  title: string;
  company: string;
  status: "ATTEMPTED" | "APPLIED" | "APPLICATION_RECEIVED" | "APPLICATION_VIEWED" | "RECRUITER_MESSAGE" | "ACTION_REQUIRED" | "REJECTION" | "POSITIVE_RESPONSE";
  source: string;
  jobUrl?: string | null;
  emailSubject?: string | null;
  emailFrom?: string | null;
  lastSeenAt: string;
};

export type DocumentItem = {
  id?: string;
  documentType: string;
  filePath?: string;
  pdfFilePath?: string | null;
  createdAt?: string;
  job?: Job;
};

export type Technology = {
  name: string;
  category: string;
};

export type AdminUser = {
  id: string;
  email: string;
  plan: string;
  profile?: { fullName?: string };
  _count?: { resumeBases?: number };
  usage?: Record<string, number>;
  tokensUsed?: number;
};
