import React, { useCallback, useEffect, useMemo, useState } from "react";
import { appActions, useAppDispatch, useAppSelector } from "./store";
import { api, AUTH_EXPIRED_EVENT, downloadStorageFile } from "./api/client";
import { ToastContainer, makeToast, type Toast } from "./components/Toast";
import { authStorageKey, defaultSettings, storageKey } from "./config/app.config";
import { AdminView } from "./modules/admin";
import { AppSidebar, AuthPanel, ProcessPanel, WorkspaceToolbar } from "./modules/app";
import type { AuthMode, JobStatistics } from "./modules/app";
import {
  AccountView,
  CompaniesView,
  DocumentsView,
  OverviewView,
  SearchView,
  SettingsView,
  VacanciesView,
} from "./modules/user";
import type {
  AdminUser,
  AppliedVacancy,
  AuthTokens,
  DocumentItem,
  EducationEntry,
  ExperienceEntry,
  Job,
  RejectedResumeReport,
  ResumeBase,
  Technology,
  View,
  WorkspaceUser,
} from "./types/domain";
import { fileToBase64, splitDateRange, splitLines, splitTerms } from "./utils/form";

declare global {
  interface Window {
    JOB_HUNTER_API_BASE_URL?: string;
  }
}

const emptyStatistics: JobStatistics = {
  generatedResumes: 0,
  sent: 0,
  positive: 0,
  negative: 0,
  noResponse: 0,
  emailEvents: 0,
};

type LinkedInStatus = {
  connected: boolean;
  email?: string;
  profileUrl?: string;
  connectedAt?: string;
  lastUsedAt?: string;
  connectionId?: string;
  connectionStatus?: "PENDING" | "CONNECTED" | "FAILED";
  error?: string;
};

type GmailStatus = {
  configured: boolean;
  connected: boolean;
  envFallbackConfigured?: boolean;
  account?: {
    email?: string | null;
    connectedAt?: string;
    lastUsedAt?: string | null;
    lastError?: string | null;
    isActive?: boolean;
  } | null;
};

export function App() {
  const dispatch = useAppDispatch();
  const status = useAppSelector((state) => state.app.status);
  const user = useAppSelector((state) => state.app.user) as WorkspaceUser | null;
  const catalog = useAppSelector((state) => state.app.catalog) as Technology[];
  const languageOptions = useAppSelector((state) => state.app.languageOptions);
  const jobs = useAppSelector((state) => state.app.jobs) as Job[];
  const documents = useAppSelector((state) => state.app.documents) as DocumentItem[];
  const companies = useAppSelector((state) => state.app.companies);
  const adminUsers = useAppSelector((state) => state.app.adminUsers) as AdminUser[];
  const storedSettings = useAppSelector((state) => state.app.settings) as Partial<ReturnType<typeof defaultSettings>>;
  const settings = { ...defaultSettings(), ...storedSettings };
  const [view, setView] = useState<View>("overview");
  const [profile, setProfile] = useState({
    location: "",
    phone: "",
    linkedin: "",
    github: "",
    portfolio: "",
    languages: "",
    summary: "",
  });
  const emptyExperience: ExperienceEntry = {
    company: "",
    title: "",
    location: "",
    dates: "2024-Present",
    project: "",
    description: "",
    bullets: "",
    technologies: "",
  };
  const emptyEducation: EducationEntry = {
    institution: "",
    program: "",
    location: "",
    dates: "",
    details: "",
  };
  const [experiences, setExperiences] = useState<ExperienceEntry[]>([emptyExperience]);
  const [educations, setEducations] = useState<EducationEntry[]>([emptyEducation]);
  const [selectedTech, setSelectedTech] = useState<Set<string>>(new Set());
  const [baseResume, setBaseResume] = useState({ name: "", target: "FULLSTACK", targetTitle: "", template: "ATS" });
  const [editingResumeBaseId, setEditingResumeBaseId] = useState("");
  const [resumePreview, setResumePreview] = useState("");
  const [linkedinStatus, setLinkedinStatus] = useState<LinkedInStatus>({ connected: false });
  const [gmailStatus, setGmailStatus] = useState<GmailStatus>({ configured: false, connected: false });
  const [linkedinConnectionId, setLinkedinConnectionId] = useState("");
  const [manualJob, setManualJob] = useState({ url: "", title: "", company: "", location: "", description: "" });
  const [selectedJobId, setSelectedJobId] = useState("");
  const [vacancyFilters, setVacancyFilters] = useState({ title: "", minScore: "0", status: "ALL" });
  const [statistics, setStatistics] = useState<JobStatistics | null>(null);
  const [appliedVacancies, setAppliedVacancies] = useState<AppliedVacancy[]>([]);
  const [rejectedResumeReport, setRejectedResumeReport] = useState<RejectedResumeReport | null>(null);
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [operation, setOperation] = useState<{ label: string; startedAt: string } | null>(null);
  const [progress, setProgress] = useState<any | null>(null);
  const [operationSteps, setOperationSteps] = useState<string[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [authPanelOpen, setAuthPanelOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const isBusy = Boolean(operation);
  const setStatus = (value: string) => dispatch(appActions.setStatus(value));
  const setUser = (value: WorkspaceUser | null) => dispatch(appActions.setUser(value));
  const setCatalog = (value: Technology[]) => dispatch(appActions.setCatalog(value));
  const setLanguageOptions = (value: string[]) => dispatch(appActions.setLanguageOptions(value));
  const setJobs = (value: Job[]) => dispatch(appActions.setJobs(value));
  const setDocuments = (value: DocumentItem[]) => dispatch(appActions.setDocuments(value));
  const setCompanies = (value: any[]) => dispatch(appActions.setCompanies(value));
  const setAdminUsers = (value: AdminUser[]) => dispatch(appActions.setAdminUsers(value));
  const setSettings = (value: ReturnType<typeof defaultSettings>) => dispatch(appActions.setSettings(value));

  useEffect(() => {
    dispatch(appActions.setSettings(defaultSettings()));
    const storedTokens = JSON.parse(localStorage.getItem(authStorageKey) || "null");
    if (storedTokens) dispatch(appActions.setAuthTokens(storedTokens));
  }, [dispatch]);

  const groupedCatalog = useMemo(() => catalog.reduce<Record<string, Technology[]>>((acc, item) => {
    (acc[item.category] ||= []).push(item);
    return acc;
  }, {}), [catalog]);

  const generatedCount = documents.filter((item) => item.documentType === "Resume").length;
  const isAdmin = user?.role === "ADMIN";
  const availableViews = useMemo(
      () => (["overview", "search", "vacancies", "companies", "documents", "settings", ...(isAdmin ? ["admin"] : [])] as View[]),
      [isAdmin],
  );
  const selectedResumeBaseId = settings.selectedResumeBaseId || user?.resumeBases?.find((item) => item.isDefault)?.id || user?.resumeBases?.[0]?.id || "";
  const selectedResumeBase = user?.resumeBases?.find((item) => item.id === selectedResumeBaseId);
  const selectedResumeBaseIds = useMemo(() => ({
    FULLSTACK: settings.selectedFullstackResumeBaseId || undefined,
    BACKEND: settings.selectedBackendResumeBaseId || undefined,
    FRONTEND: settings.selectedFrontendResumeBaseId || undefined,
  }), [settings.selectedFullstackResumeBaseId, settings.selectedBackendResumeBaseId, settings.selectedFrontendResumeBaseId]);

  useEffect(() => {
    if (view === "admin" && !isAdmin) setView("overview");
  }, [isAdmin, view]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  function addToast(kind: Toast["kind"], title: string, message?: string, autoDismiss?: boolean) {
    setToasts((prev) => [...prev.slice(-9), makeToast(kind, title, message, autoDismiss)]);
  }

  function addStep(step: string) {
    setOperationSteps((prev) => [...prev, step]);
    setStatus(step);
  }

  function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error || "Unexpected error.");
  }

  // Context-aware error: tries to give the user a helpful hint based on the message.
  function handleError(error: unknown, context?: string) {
    const raw = errorMessage(error);
    const title = context ? `${context} failed` : "Something went wrong";
    let hint: string | undefined;

    if (/session expired|log in again/i.test(raw)) {
      hint = "Your session has expired. Please log in again.";
    } else if (/network|fetch|failed to fetch|ERR_NETWORK/i.test(raw)) {
      hint = "Cannot reach the server. Check your connection or wait a moment and retry.";
    } else if (/token|unauthorized|401/i.test(raw)) {
      hint = "Authentication error. Try logging out and back in.";
    } else if (/too short|description/i.test(raw)) {
      hint = "The job description is too short. Paste the full vacancy text or use a direct URL.";
    } else if (/timeout|timed out/i.test(raw)) {
      hint = "The operation timed out. The server may be busy — try again in a moment.";
    } else if (/openai|api key|quota/i.test(raw.toLowerCase())) {
      hint = "OpenAI API error. Check your API key or usage quota.";
    } else if (/playwright|browser/i.test(raw.toLowerCase())) {
      hint = "Browser automation failed. The page may have blocked scraping — paste the text manually.";
    }

    addToast("error", title, hint ?? raw);
    setStatus(`${title}: ${raw}`);
  }

  function guardBusy(action = "start another action") {
    if (!isBusy) return true;
    window.alert(`${operation?.label || "A background process"} is still running. Wait for it to finish before you ${action}.`);
    return false;
  }

  async function refreshJobsAndDocuments(userId = settings.userId) {
    if (!userId) {
      setJobs([]);
      setDocuments([]);
      setStatistics(null);
      return [];
    }
    const [jobsResult, statisticsResult] = await Promise.allSettled([
      api<Job[]>(`/jobs?userId=${userId}`),
      api<JobStatistics>(`/jobs/statistics?userId=${userId}`),
    ]);
    if (jobsResult.status === "rejected") throw jobsResult.reason;

    const nextJobs = jobsResult.value;
    const nextStatistics = statisticsResult.status === "fulfilled" ? statisticsResult.value : emptyStatistics;
    setJobs(nextJobs);
    setDocuments(extractDocuments(nextJobs));
    setStatistics(nextStatistics);
    return nextJobs;
  }

  function startOperation(label: string) {
    setProgress(null);
    setOperationSteps([]);
    setOperation({ label, startedAt: new Date().toISOString() });
    setStatus(label);
  }

  function finishOperation(successMessage?: string) {
    setOperation(null);
    if (successMessage) {
      addToast("success", successMessage);
      setStatus(successMessage);
    }
  }

  useEffect(() => {
    if (!operation) return undefined;

    let cancelled = false;
    const loadProgress = async () => {
      try {
        const data = await api<{ progress: any }>("/jobs/automation/status");
        if (!cancelled) setProgress(data.progress);
      } catch (error) {
        if (!cancelled) setProgress((current: any) => current || { message: errorMessage(error), error: errorMessage(error) });
      }
    };

    void loadProgress();
    const interval = window.setInterval(() => void loadProgress(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [operation]);

  function persist(next: typeof settings) {
    const { accountPassword: _accountPassword, ...storedSettings } = next;
    setSettings(next);
    localStorage.setItem(storageKey, JSON.stringify(storedSettings));
  }

  function requireUserId() {
    if (!settings.userId) throw new Error("Create or load a user first.");
    return settings.userId;
  }

  function updateExperience(index: number, patch: Partial<ExperienceEntry>) {
    setExperiences((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  function updateEducation(index: number, patch: Partial<EducationEntry>) {
    setEducations((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  function applyUser(nextUser: WorkspaceUser) {
    const defaultResume = nextUser.resumeBases?.find((item) => item.isDefault) ?? nextUser.resumeBases?.[0];
    const selectedForUser = nextUser.resumeBases?.some((item) => item.id === settings.selectedResumeBaseId)
        ? settings.selectedResumeBaseId
        : defaultResume?.id || "";
    setUser(nextUser);
    persist({
      ...settings,
      userId: nextUser.id,
      accountEmail: nextUser.email,
      accountFullName: nextUser.profile?.fullName || settings.accountFullName,
      accountPlan: nextUser.plan,
      selectedResumeBaseId: selectedForUser,
      selectedFullstackResumeBaseId: nextUser.dailyAutomationFullstackResumeBaseId || settings.selectedFullstackResumeBaseId,
      selectedBackendResumeBaseId: nextUser.dailyAutomationBackendResumeBaseId || settings.selectedBackendResumeBaseId,
      selectedFrontendResumeBaseId: nextUser.dailyAutomationFrontendResumeBaseId || settings.selectedFrontendResumeBaseId,
    });
    setProfile({
      location: nextUser.profile?.location || "",
      phone: nextUser.profile?.phone || "",
      linkedin: nextUser.profile?.linkedin || "",
      github: nextUser.profile?.github || "",
      portfolio: nextUser.profile?.portfolio || "",
      languages: (nextUser.profile?.languages || []).join(", "),
      summary: nextUser.profile?.summary || "",
    });
    setSelectedTech(new Set((nextUser.technologies || []).map((item) => item.name)));
    const loadedExperiences: ExperienceEntry[] = (nextUser.experiences || []).map((item: any) => ({
      company: item.company || "",
      title: item.title || "",
      location: item.location || "",
      dates: [item.startDate, item.endDate].filter(Boolean).join("-") || "2024-Present",
      project: item.project || "",
      description: item.description || "",
      bullets: (item.bullets || []).join("\n"),
      technologies: (item.technologies || []).join(", "),
    }));
    setExperiences(loadedExperiences.length ? loadedExperiences : [emptyExperience]);
    const loadedEducations: EducationEntry[] = (nextUser.educations || []).map((item: any) => ({
      institution: item.institution || "",
      program: item.program || "",
      location: item.location || "",
      dates: [item.startDate, item.endDate].filter(Boolean).join("-"),
      details: (item.details || []).join("\n"),
    }));
    setEducations(loadedEducations.length ? loadedEducations : [emptyEducation]);
    const linkedin = nextUser.linkedinAccounts?.[0];
    setLinkedinStatus({
      connected: Boolean(linkedin?.isActive),
      email: linkedin?.email || undefined,
      profileUrl: linkedin?.profileUrl || undefined,
      connectedAt: linkedin?.connectedAt,
      lastUsedAt: linkedin?.lastUsedAt,
    });
    if (defaultResume) {
      setEditingResumeBaseId(defaultResume.id);
      setBaseResume({
        name: defaultResume.name,
        target: defaultResume.target,
        targetTitle: defaultResume.targetTitle || "",
        template: "ATS",
      });
      setResumePreview(defaultResume.content);
    } else {
      setEditingResumeBaseId("");
      setBaseResume({ name: "", target: "FULLSTACK", targetTitle: "", template: "ATS" });
      setResumePreview("");
    }
    setStatus(`Loaded ${nextUser.email}.`);
  }

  async function loadWorkspaceAfterAuth(authUser: WorkspaceUser, tokens?: AuthTokens) {
    if (tokens) {
      localStorage.setItem(authStorageKey, JSON.stringify(tokens));
      dispatch(appActions.setAuthTokens(tokens));
    }

    const loaded = await api<{ user: WorkspaceUser }>(`/users/${authUser.id}`);
    applyUser(loaded.user);
    await refreshJobsAndDocuments(loaded.user.id);
  }

  async function loadInitial() {
    const storedTokens = JSON.parse(localStorage.getItem(authStorageKey) || "null") as AuthTokens | null;
    let activeUserId = "";
    if (storedTokens?.accessToken) {
      try {
        // api() will auto-refresh if the token is expired/expiring soon.
        const me = await api<{ user: WorkspaceUser }>("/auth/me");
        activeUserId = me.user.id;
        const loaded = await api<{ user: WorkspaceUser }>(`/users/${activeUserId}`);
        applyUser(loaded.user);
      } catch {
        // If auto-refresh also failed, AUTH_EXPIRED_EVENT is dispatched by api() and
        // the listener below will open the login panel. Just reset local state here.
        dispatch(appActions.setAuthTokens(null));
        persist({ ...settings, userId: "" });
      }
    }
    const [techResponse, jobsResponse, statsResponse, companiesResponse] = await Promise.allSettled([
      api<{ technologies: Technology[]; languages: string[] }>("/technologies/catalog"),
      activeUserId ? api<Job[]>(`/jobs?userId=${activeUserId}`) : Promise.resolve([]),
      activeUserId ? api<JobStatistics>(`/jobs/statistics?userId=${activeUserId}`) : Promise.resolve(null),
      api<{ companies: any[] }>("/jobs/center-israel/companies?active=true&limit=100"),
    ]);
    if (techResponse.status === "fulfilled") {
      setCatalog(techResponse.value.technologies || []);
      setLanguageOptions(techResponse.value.languages || []);
    }
    if (jobsResponse.status === "fulfilled") {
      setJobs(jobsResponse.value);
      setDocuments(extractDocuments(jobsResponse.value));
    }
    if (statsResponse.status === "fulfilled") setStatistics(statsResponse.value);
    if (companiesResponse.status === "fulfilled") setCompanies(companiesResponse.value.companies || []);
  }

  useEffect(() => {
    void loadInitial().catch(handleError);
  }, []);

  // When api() detects a fully-expired session (refresh also failed), open login panel.
  useEffect(() => {
    function onAuthExpired() {
      setUser(null);
      setJobs([]);
      setDocuments([]);
      setStatistics(null);
      setAuthMode("login");
      setAuthPanelOpen(true);
      setStatus("Session expired. Please log in again.");
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, onAuthExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onAuthExpired);
  }, []);

  function extractDocuments(sourceJobs: Job[]) {
    return sourceJobs.flatMap((job) => [
      ...(job.resumeVersions || []).map((item) => ({ ...item, job, documentType: "Resume" })),
      ...(job.coverLetters || []).map((item) => ({ ...item, job, documentType: "Cover Letter" })),
    ]).filter((item) => item.filePath);
  }

  async function createOrLoadUser() {
    if (!settings.accountPassword) throw new Error("Password is required for authenticated registration.");
    const data = await api<{ user: WorkspaceUser; tokens?: AuthTokens }>("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: settings.accountEmail,
        password: settings.accountPassword,
        fullName: settings.accountFullName || undefined,
        plan: settings.accountPlan,
      }),
    });
    await loadWorkspaceAfterAuth(data.user, data.tokens);
  }

  async function loginUser() {
    const data = await api<{ user: WorkspaceUser; tokens: AuthTokens }>("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: settings.accountEmail,
        password: settings.accountPassword,
      }),
    });
    await loadWorkspaceAfterAuth(data.user, data.tokens);
  }

  function logoutUser() {
    localStorage.removeItem(authStorageKey);
    dispatch(appActions.setAuthTokens(null));
    setUser(null);
    persist({ ...settings, userId: "", selectedResumeBaseId: "", accountPassword: "" });
    setJobs([]);
    setDocuments([]);
    setStatistics(null);
    if (view === "account" || view === "admin") setView("overview");
    setStatus("Logged out.");
  }

  async function saveProfile() {
    const userId = requireUserId();
    await api(`/users/${userId}/profile`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: settings.accountFullName,
        email: settings.accountEmail,
        ...profile,
        languages: splitTerms(profile.languages),
      }),
    });
    const loaded = await api<{ user: WorkspaceUser }>(`/users/${userId}`);
    applyUser(loaded.user);
  }

  async function saveTechnologies() {
    const userId = requireUserId();
    const technologies = Array.from(selectedTech).map((name) => {
      const item = catalog.find((tech) => tech.name === name);
      return { name, category: item?.category };
    });
    await api(`/users/${userId}/technologies`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ technologies }),
    });
    setStatus("Technologies saved.");
  }

  async function saveHistory() {
    const userId = requireUserId();
    await Promise.all([
      api(`/users/${userId}/experiences`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          experiences: experiences
              .filter((item) => item.company && item.title)
              .map((item, sortOrder) => {
                const dates = splitDateRange(item.dates || "");
                return {
                  company: item.company,
                  title: item.title,
                  location: item.location || undefined,
                  startDate: dates.startDate || "Present",
                  endDate: dates.endDate,
                  project: item.project || undefined,
                  description: item.description || undefined,
                  bullets: splitLines(item.bullets || ""),
                  technologies: splitTerms(item.technologies || ""),
                  sortOrder,
                };
              }),
        }),
      }),
      api(`/users/${userId}/educations`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          educations: educations
              .filter((item) => item.institution && item.program)
              .map((item, sortOrder) => {
                const dates = splitDateRange(item.dates || "");
                return {
                  institution: item.institution,
                  program: item.program,
                  location: item.location || undefined,
                  startDate: dates.startDate,
                  endDate: dates.endDate,
                  details: splitLines(item.details || ""),
                  sortOrder,
                };
              }),
        }),
      }),
    ]);
    setStatus("Experience and education saved.");
  }

  async function uploadResumeFile() {
    const userId = requireUserId();
    if (!resumeFile) throw new Error("Choose a PDF or DOCX file first.");
    const base64Content = await fileToBase64(resumeFile);
    const data = await api<{ resumeBase: ResumeBase }>(`/users/${userId}/resume-file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: resumeFile.name,
        base64Content,
      }),
    });
    setResumePreview(data.resumeBase.content);
    persist({ ...settings, selectedResumeBaseId: data.resumeBase.id });
    const loaded = await api<{ user: WorkspaceUser }>(`/users/${userId}`);
    applyUser(loaded.user);
    setStatus("Resume file uploaded and parsed.");
  }

  async function createBaseResume() {
    const userId = requireUserId();
    const data = await api<{ resumeBase: ResumeBase }>(`/users/${userId}/resume-bases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: baseResume.name,
        target: baseResume.target,
        targetTitle: baseResume.targetTitle || undefined,
        template: baseResume.template,
        isDefault: true,
      }),
    });
    setResumePreview(data.resumeBase.content);
    setEditingResumeBaseId(data.resumeBase.id);
    persist({ ...settings, selectedResumeBaseId: data.resumeBase.id });
    const loaded = await api<{ user: WorkspaceUser }>(`/users/${userId}`);
    applyUser(loaded.user);
    setStatus(data.resumeBase.pdfFilePath ? "Base resume PDF created." : "Base resume created.");
  }

  async function saveBaseResume() {
    const userId = requireUserId();
    if (!editingResumeBaseId) throw new Error("Select a base resume first.");
    const data = await api<{ resumeBase: ResumeBase }>(`/users/${userId}/resume-bases/${editingResumeBaseId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: baseResume.name,
        target: baseResume.target,
        targetTitle: baseResume.targetTitle || null,
        content: resumePreview,
        template: baseResume.template,
        isDefault: true,
      }),
    });
    const loaded = await api<{ user: WorkspaceUser }>(`/users/${userId}`);
    applyUser(loaded.user);
    setEditingResumeBaseId(data.resumeBase.id);
    persist({ ...settings, selectedResumeBaseId: data.resumeBase.id });
    setStatus("Base resume saved.");
  }

  async function deleteBaseResume() {
    const userId = requireUserId();
    if (!editingResumeBaseId) throw new Error("Select a base resume first.");
    await api(`/users/${userId}/resume-bases/${editingResumeBaseId}`, { method: "DELETE" });
    setEditingResumeBaseId("");
    setBaseResume({ name: "", target: "FULLSTACK", targetTitle: "", template: "ATS" });
    setResumePreview("");
    persist({ ...settings, selectedResumeBaseId: "" });
    const loaded = await api<{ user: WorkspaceUser }>(`/users/${userId}`);
    applyUser(loaded.user);
    setStatus("Base resume deleted.");
  }

  async function runSearch(sourceMode = "PROVIDERS") {
    if (!guardBusy("start a new search")) return;
    const userId = requireUserId();
    if (!selectedResumeBaseId) throw new Error("Select or create a base resume before searching.");
    const label = sourceMode === "PROVIDERS" ? "Provider vacancy search" : `${sourceMode} vacancy search`;
    startOperation(label);
    addStep(sourceMode === "EMAIL" ? "Scanning Gmail application history..." : "Connecting to job providers...");
    try {
      const data = await api<any>("/jobs/automation/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          resumeBaseId: selectedResumeBaseId || undefined,
          resumeBaseIds: selectedResumeBaseIds,
          searchLocation: settings.searchLocation,
          sourceMode,
          preferences: {
            targetRoles: splitTerms(settings.targetRoles),
            targetLocations: splitTerms(settings.targetLocations),
            requiredTech: splitTerms(settings.requiredTech),
            excludedKeywords: splitTerms(settings.excludedKeywords),
            dateRangeDays: Number(settings.dateRangeDays),
            minMatchScore: Number(settings.minMatchScore),
          },
        }),
      });
      await refreshJobsAndDocuments(userId);
      const summary = `Collected ${data.newJobsCount ?? 0} new · Analyzed ${data.analyzedJobsCount ?? 0} · Resumes ${data.generatedResumesCount ?? 0} · Letters ${data.generatedCoverLettersCount ?? 0}`;
      finishOperation(summary);
      addToast("success", "Search complete", summary);
    } catch (err) {
      handleError(err, "Vacancy search");
      finishOperation();
    }
  }

  async function createManualVacancy() {
    if (!guardBusy("create a manual vacancy")) return;
    const userId = requireUserId();
    if (!selectedResumeBaseId) throw new Error("Select or create a base resume before generating documents.");
    if (!manualJob.url.trim() && manualJob.description.trim().length < 50) {
      throw new Error("Paste at least 50 characters of vacancy text, or provide a URL.");
    }
    startOperation("Manual vacancy");
    try {
      if (manualJob.url.trim() && !manualJob.description.trim()) {
        addStep("Extracting vacancy text from URL...");
      }
      addStep("Sending to server for processing...");
      const data = await api<any>("/jobs/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          resumeBaseId: selectedResumeBaseId || undefined,
          resumeBaseIds: selectedResumeBaseIds,
          ...manualJob,
        }),
      });
      addStep("Analyzing job fit with AI...");
      addStep("Generating tailored resume and cover letter...");
      await refreshJobsAndDocuments(userId);
      const msg = data.message || "Manual vacancy processed.";
      finishOperation(msg);
      addToast("success", "Application package ready", msg);
      // Reset form only on success.
      setManualJob({ url: "", title: "", company: "", location: "", description: "" });
    } catch (err) {
      handleError(err, "Manual vacancy");
      finishOperation();
    }
  }

  async function extractManualVacancy() {
    if (!guardBusy("extract a vacancy from URL")) return;
    if (!manualJob.url.trim()) throw new Error("Paste a vacancy URL first.");
    startOperation("Extract from URL");
    addStep("Opening browser and loading page...");
    try {
      const data = await api<{ vacancy?: Partial<typeof manualJob> }>("/jobs/manual/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: manualJob.url }),
      });
      const filled = [data.vacancy?.title, data.vacancy?.company, data.vacancy?.description?.slice(0, 50)]
        .filter(Boolean).join(" · ");
      setManualJob({
        url: manualJob.url,
        title: data.vacancy?.title || manualJob.title,
        company: data.vacancy?.company || manualJob.company,
        location: data.vacancy?.location || manualJob.location,
        description: data.vacancy?.description || manualJob.description,
      });
      const msg = filled ? `Extracted: ${filled}…` : "Extraction returned limited data — paste description manually.";
      finishOperation(msg);
      addToast(filled ? "success" : "warning", "URL extraction done", msg);
    } catch (err) {
      handleError(err, "URL extraction");
      finishOperation();
    }
  }

  async function generateJobDocument(jobId: string, type: "resume" | "letter" | "package") {
    if (!guardBusy("generate documents")) return;
    const userId = requireUserId();
    if (!selectedResumeBaseId) throw new Error("Select or create a base resume before generating documents.");
    const endpoint = type === "resume"
      ? "generate-resume"
      : type === "letter"
        ? "generate-cover-letter"
        : "generate-application-package";
    const label = type === "package" ? "Generate application package" : type === "resume" ? "Generate tailored resume" : "Generate cover letter";
    startOperation(label);
    addStep("Selecting the best base resume for this role...");
    addStep("Building resume prompt with job requirements...");
    try {
      await api(`/jobs/${jobId}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, resumeBaseId: selectedResumeBaseId, resumeBaseIds: selectedResumeBaseIds }),
      });
      await refreshJobsAndDocuments(userId);
      const successMsg = type === "package" ? "Application package ready." : type === "resume" ? "Tailored resume generated." : "Cover letter generated.";
      finishOperation(successMsg);
      addToast("success", successMsg);
    } catch (err) {
      handleError(err, label);
      finishOperation();
    }
  }

  async function generateMissingResumesForVisibleJobs() {
    if (!guardBusy("generate missing resumes")) return;
    const userId = requireUserId();
    if (!selectedResumeBaseId) throw new Error("Select or create a base resume before generating documents.");

    const candidates = visibleJobs.filter((job) => !job.resumeVersions?.length);
    if (!candidates.length) {
      addToast("info", "Nothing to generate", "All visible vacancies already have resumes.");
      setStatus("No visible vacancies without resumes match the current filters.");
      return;
    }

    startOperation(`Generate missing resumes (${candidates.length})`);
    const errors: string[] = [];
    const generated: Array<{ job: Job; resume: { filePath?: string | null; pdfFilePath?: string | null } }> = [];
    try {
      for (let index = 0; index < candidates.length; index += 1) {
        const job = candidates[index];
        addStep(`[${index + 1}/${candidates.length}] Generating: ${job.title} @ ${job.company || "?"}`);
        try {
          const resume = await api<{ filePath?: string | null; pdfFilePath?: string | null }>(`/jobs/${job.id}/generate-resume`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId, resumeBaseId: selectedResumeBaseId, resumeBaseIds: selectedResumeBaseIds }),
          });
          generated.push({ job, resume });
        } catch (error) {
          errors.push(`${job.title}: ${errorMessage(error)}`);
        }
      }

      await refreshJobsAndDocuments(userId);
      const generatedCount = candidates.length - errors.length;
      let telegramStatus = "";
      try {
        const notification = await api<{ telegramSent: boolean }>("/jobs/notifications/telegram", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId,
            message: [
              "📋 JOB HUNTER RESUME GENERATION REPORT",
              `⏰ Time: ${new Date().toLocaleString()}`,
              "",
              "════════════════════════════════════",
              "📊 SUMMARY",
              `├─ Matching Vacancies Without Resume: ${candidates.length}`,
              `├─ Resumes Generated: ${generatedCount}`,
              `├─ Failed Resumes: ${errors.length}`,
              "",
              generated.length ? `✅ RESUMES GENERATED (${generated.length})` : "",
              generated.length ? "" : "",
              ...generated.flatMap(({ job, resume }, index) => {
                const score = job.userMatch?.matchScore ?? job.matchScore;
                return [
                  `${index + 1}. ${job.title} @ ${job.company || "Unknown company"}`,
                  `   📍 Score: ${score == null ? "Not analyzed" : `${score}/100`}`,
                  `   🔗 Job: ${job.url || "No URL"}`,
                  `   📄 Resume: ${resume.filePath || "Generated"}`,
                  `   💼 DOCX: ${resume.filePath || "Generated"}`,
                  resume.pdfFilePath ? `   🧾 PDF: ${resume.pdfFilePath}` : "",
                  "",
                ];
              }),
              errors.length ? "" : "",
              errors.length ? `❌ Failed resume details are available in the app status/logs.` : "",
            ].filter(Boolean).join("\n"),
          }),
        });
        telegramStatus = notification.telegramSent ? " Telegram notification sent." : " Telegram notification skipped: not configured.";
      } catch (error) {
        telegramStatus = ` Telegram notification failed: ${errorMessage(error)}`;
      }

      const summary = errors.length
        ? `Generated ${generatedCount}/${candidates.length} resumes. ${errors.length} failed.${telegramStatus}`
        : `Generated ${generatedCount} resumes.${telegramStatus}`;
      finishOperation(summary);
      if (errors.length) {
        addToast("warning", `${generatedCount} resumes generated, ${errors.length} failed`,
          errors.slice(0, 3).join(" · ") + (errors.length > 3 ? ` …+${errors.length - 3} more` : ""));
      } else {
        addToast("success", summary);
      }
    } catch (err) {
      handleError(err, "Batch resume generation");
      finishOperation();
    }
  }

  async function loadLinkedInStatus(connectionId = linkedinConnectionId) {
    requireUserId();
    const query = connectionId ? `?connectionId=${encodeURIComponent(connectionId)}` : "";
    const data = await api<LinkedInStatus>(`/linkedin/status${query}`);
    setLinkedinStatus(data);
    if (data.connectionStatus === "CONNECTED") {
      setLinkedinConnectionId("");
      setStatus("LinkedIn connected.");
    } else if (data.connectionStatus === "FAILED") {
      setStatus(data.error ? `LinkedIn connection failed: ${data.error}` : "LinkedIn connection failed.");
    }
    return data;
  }

  async function connectLinkedIn() {
    requireUserId();
    const data = await api<{ success: boolean; connectionId: string }>("/linkedin/connect", {
      method: "POST",
    });
    setLinkedinConnectionId(data.connectionId);
    setLinkedinStatus((current) => ({
      ...current,
      connectionId: data.connectionId,
      connectionStatus: "PENDING",
      error: undefined,
    }));
    setStatus("LinkedIn login browser opened. Complete login to finish connecting.");
  }

  async function disconnectLinkedIn() {
    requireUserId();
    await api("/linkedin/disconnect", { method: "DELETE" });
    setLinkedinConnectionId("");
    setLinkedinStatus({ connected: false });
    setStatus("LinkedIn disconnected.");
  }

  useEffect(() => {
    if (!user || !linkedinConnectionId) return;

    const timer = window.setInterval(() => {
      void loadLinkedInStatus(linkedinConnectionId).catch(handleError);
    }, 3_000);

    return () => window.clearInterval(timer);
  }, [user, linkedinConnectionId]);

  useEffect(() => {
    if (!user?.id) return;
    void loadGmailStatus(user.id).catch(() => undefined);
  }, [user?.id]);

  async function markJob(jobId: string, patch: { applied?: boolean; ignored?: boolean; status?: "REJECTED"; notes?: string; rejectionReason?: string }) {
    const userId = requireUserId();
    await api(`/jobs/${jobId}/user-match`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, ...patch }),
    });
    await refreshJobsAndDocuments(userId);
    setStatus(patch.status === "REJECTED" ? "Rejection recorded for prompt learning." : patch.applied ? "Vacancy marked as applied." : "Vacancy status updated.");
  }

  async function loadAppliedVacancies() {
    const userId = requireUserId();
    const data = await api<{ applications: AppliedVacancy[]; count: number }>(`/email/applications?userId=${userId}&limit=100`);
    setAppliedVacancies(data.applications || []);
    setStatus(`${data.count} application history items loaded.`);
  }

  async function loadGmailStatus(userId = requireUserId()) {
    const status = await api<GmailStatus>(`/email/gmail/status?userId=${userId}`);
    setGmailStatus(status);
    return status;
  }

  async function connectGmail() {
    const userId = requireUserId();
    const data = await api<{ authUrl: string }>("/email/gmail/auth-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    window.open(data.authUrl, "_blank", "noopener,noreferrer");
    setStatus("Gmail OAuth opened. After approving access, return here and click Sync Gmail Responses.");
  }

  async function syncEmailApplications() {
    const userId = requireUserId();
    const data = await api<{ syncedCount?: number; newEventsCount?: number; appliedHistoryFromEmails?: number; appliedHistoryFromLocalApplications?: number; message?: string }>("/email/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    await loadGmailStatus(userId).catch(() => undefined);
    await loadAppliedVacancies();
    setStatus(data.message?.startsWith("Gmail sync skipped")
      ? data.message.split("\n")[0]
      : `Email synced. ${data.newEventsCount ?? 0} new events, ${data.appliedHistoryFromEmails ?? 0} email applications matched.`);
  }

  async function loadRejectedResumeReport() {
    const userId = requireUserId();
    const report = await api<RejectedResumeReport>(`/jobs/rejections/resume-report?userId=${userId}`);
    setRejectedResumeReport(report);
    setStatus(`${report.totalRejections} rejections analyzed. ${report.highScoreRejected} high-score rejected matches found.`);
  }

  async function improvePromptRules() {
    const userId = requireUserId();
    const data = await api<{ success: boolean; rulesGenerated: number }>("/jobs/rejections/refine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    await loadRejectedResumeReport();
    setStatus(`Prompt rules improved. ${data.rulesGenerated} rules generated or refreshed.`);
  }

  async function runDailyReport() {
    const userId = requireUserId();
    startOperation("Daily report");
    addStep("Syncing Gmail, updating vacancy history...");
    try {
      const data = await api<{ newJobsCount: number; emailEventsCount: number; emailSyncedCount: number }>("/jobs/daily-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const msg = `Daily report done. ${data.newJobsCount} new jobs · ${data.emailSyncedCount} emails synced · ${data.emailEventsCount} events.`;
      finishOperation(msg);
      addToast("success", "Daily report complete", msg);
    } catch (err) {
      handleError(err, "Daily report");
      finishOperation();
    }
  }

  async function repairUserMatches() {
    const userId = requireUserId();
    addStep("Scanning for jobs without user links...");
    try {
      const data = await api<{ created: number; skipped: number }>("/jobs/user-matches/repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      await refreshJobsAndDocuments(userId);
      const msg = `Repair done. ${data.created} links created, ${data.skipped} already linked.`;
      addToast("success", "Job links repaired", msg);
      setStatus(msg);
    } catch (err) {
      handleError(err, "Repair job links");
    }
  }

  async function saveDailyAutomation(settings: { enabled: boolean; time: string; timezone: string }) {
    const userId = requireUserId();
    await api(`/users/${userId}/daily-automation`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...settings, resumeBaseIds: selectedResumeBaseIds }),
    });
    const loaded = await api<{ user: WorkspaceUser }>(`/users/${userId}`);
    applyUser(loaded.user);
    setStatus(settings.enabled ? `Daily automation enabled at ${settings.time} ${settings.timezone}.` : "Daily automation disabled.");
  }

  async function analyzeMissingJobs() {
    if (!guardBusy("analyze missing vacancies")) return;
    const userId = requireUserId();
    if (!selectedResumeBaseId) throw new Error("Select or create a base resume before analyzing vacancies.");
    startOperation("Analyze missing vacancy matches");
    setStatus("Analyzing user vacancies without match scores...");
    try {
      const data = await api<{ analyzed: number }>("/jobs/analyze-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, resumeBaseId: selectedResumeBaseId, resumeBaseIds: selectedResumeBaseIds }),
      });
      await refreshJobsAndDocuments(userId);
      setStatus(`Analyzed ${data.analyzed} user vacancies.`);
    } finally {
      finishOperation();
    }
  }

  async function loadAdminUsers() {
    const data = await api<{ users: AdminUser[]; count: number }>("/admin/users");
    setAdminUsers(data.users || []);
    setStatus(`${data.count} users loaded.`);
  }

  async function handleDownload(filePath?: string) {
    try {
      await downloadStorageFile(filePath);
    } catch (error) {
      handleError(error);
    }
  }

  const visibleJobs = useMemo(() => {
    const titleQuery = vacancyFilters.title.trim().toLowerCase();
    const minScore = Number(vacancyFilters.minScore || 0);
    const statusFilter = vacancyFilters.status || "ALL";

    return jobs.filter((job) => {
      const score = job.userMatch?.matchScore ?? job.matchScore ?? 0;
      const titleMatch = !titleQuery || `${job.title} ${job.company || ""}`.toLowerCase().includes(titleQuery);
      const isApplied = Boolean(job.userMatch?.appliedAt) || job.userMatch?.status === "APPLIED";
      const isRejected = job.userMatch?.status === "REJECTED";
      const isIgnored = Boolean(job.userMatch?.ignoredAt) || job.userMatch?.status === "IGNORED";
      const statusMatch =
        statusFilter === "ALL" ||
        (statusFilter === "APPLIED" && isApplied) ||
        (statusFilter === "REJECTED" && isRejected) ||
        (statusFilter === "IGNORED" && isIgnored) ||
        (statusFilter === "ACTIVE" && !isApplied && !isRejected && !isIgnored);

      return titleMatch && score >= minScore && statusMatch;
    });
  }, [jobs, vacancyFilters]);

  const selectedJob = useMemo(() => {
    if (selectedJobId) return jobs.find((job) => job.id === selectedJobId) || visibleJobs[0];
    return visibleJobs[0];
  }, [jobs, selectedJobId, visibleJobs]);

  const lowMatchMissingSkills = useMemo(() => {
    const counts = new Map<string, number>();
    for (const job of jobs) {
      const score = job.userMatch?.matchScore ?? job.matchScore;
      if (score === undefined || score >= 70) continue;
      const missingSkills = job.userMatch?.analysis?.missingSkills || job.analysis?.missingSkills || [];
      for (const skill of missingSkills) {
        const key = skill.trim();
        if (key) counts.set(key, (counts.get(key) || 0) + 1);
      }
    }

    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 12);
  }, [jobs]);

  return (
    <>
      <main className="app">
        <AppSidebar
            availableViews={availableViews}
            currentView={view}
            user={user}
            guardBusy={guardBusy}
            onViewChange={setView}
            onAuthClick={() => {
              setAuthMode("login");
              setAuthPanelOpen((value) => !value);
            }}
        />

        <section className="workspace">
          {/*<header className="topbar">*/}
          {/*  <div><p className="eyebrow">Candidate workspace</p><h1>{view[0].toUpperCase() + view.slice(1)}</h1></div>*/}
          {/*  <div className="top-actions">*/}

          {/*    <select value={settings.searchLocation} onChange={(event) => persist({ ...settings, searchLocation: event.target.value })}>*/}
          {/*      {["Israel", "Tel Aviv", "Herzliya", "Ramat Gan", "Ra'anana", "Remote Europe", "Remote US"].map((item) => <option key={item}>{item}</option>)}*/}
          {/*    </select>*/}
          {/*    <button className="btn btn-secondary" type="button" onClick={() => {*/}
          {/*      if (!guardBusy("refresh data")) return;*/}
          {/*      void loadInitial().catch(handleError);*/}
          {/*    }}>Refresh</button>*/}
          {/*    <button className="btn btn-primary" type="button" onClick={() => void runSearch().catch(handleError)}>Run Search</button>*/}
          {/*  </div>*/}
          {/*</header>*/}

          {authPanelOpen && !user && (
              <AuthPanel
                  authMode={authMode}
                  settings={settings}
                  setAuthMode={setAuthMode}
                  setSettings={setSettings}
                  persist={persist}
                  onClose={() => setAuthPanelOpen(false)}
                  onLogin={() => void loginUser().then(() => setAuthPanelOpen(false)).catch(handleError)}
                  onRegister={() => void createOrLoadUser().then(() => setAuthPanelOpen(false)).catch(handleError)}
              />
          )}

          {user && (
              <WorkspaceToolbar
                  user={user}
                  settings={settings}
                  selectedResumeBaseId={selectedResumeBaseId}
                  selectedResumeBase={selectedResumeBase}
                  persist={persist}
                  onCreateBaseResume={() => setView("account")}
              />
          )}

          <ProcessPanel operation={operation} progress={progress} steps={operationSteps} status={status} />

          {view === "overview" && (
              <OverviewView
                  user={user}
                  jobs={jobs}
                  generatedCount={generatedCount}
                  companiesCount={companies.length}
                  settings={settings}
                  statistics={statistics}
                  lowMatchMissingSkills={lowMatchMissingSkills}
                  status={status}
                  onMark={markJob}
                  onDownload={handleDownload}
                  onNavigate={setView}
                  onRunSearch={() => void runSearch().catch(handleError)}
                  onAnalyzeMissing={() => void analyzeMissingJobs().catch(handleError)}
                  onLoginClick={() => {
                    setAuthMode("login");
                    setAuthPanelOpen(true);
                  }}
              />
          )}

          {view === "account" && (
              <AccountView
                  user={user}
                  settings={settings}
                  selectedResumeBase={selectedResumeBase}
                  selectedResumeBaseId={selectedResumeBaseId}
                  profile={profile}
                  languageOptions={languageOptions}
                  groupedCatalog={groupedCatalog}
                  selectedTech={selectedTech}
                  experiences={experiences}
                  educations={educations}
                  emptyExperience={emptyExperience}
                  emptyEducation={emptyEducation}
                  baseResume={baseResume}
                  editingResumeBaseId={editingResumeBaseId}
                  resumePreview={resumePreview}
                  setProfile={setProfile}
                  setSelectedTech={setSelectedTech}
                  setExperiences={setExperiences}
                  setEducations={setEducations}
                  setBaseResume={setBaseResume}
                  setEditingResumeBaseId={setEditingResumeBaseId}
                  setResumePreview={setResumePreview}
                  setResumeFile={setResumeFile}
                  updateExperience={updateExperience}
                  updateEducation={updateEducation}
                  persist={persist}
                  guardBusy={guardBusy}
                  onLogout={logoutUser}
                  onSaveProfile={() => void saveProfile().catch(handleError)}
                  onSaveTechnologies={() => void saveTechnologies().catch(handleError)}
                  onSaveHistory={() => void saveHistory().catch(handleError)}
                  onCreateBaseResume={() => void createBaseResume().catch(handleError)}
                  onUploadResumeFile={() => void uploadResumeFile().catch(handleError)}
                  onSaveBaseResume={() => void saveBaseResume().catch(handleError)}
                  onDeleteBaseResume={() => void deleteBaseResume().catch(handleError)}
                  onDownload={handleDownload}
              />
          )}

          {view === "search" && (
              <SearchView
                  settings={settings}
                  selectedResumeBaseId={selectedResumeBaseId}
                  resumeBases={user?.resumeBases || []}
                  catalog={catalog}
                  linkedinStatus={linkedinStatus}
                  manualJob={manualJob}
                  persist={persist}
                  setManualJob={setManualJob}
                  onConnectLinkedIn={() => void connectLinkedIn().catch(handleError)}
                  onRefreshLinkedIn={() => void loadLinkedInStatus().catch(handleError)}
                  onRunSearch={(sourceMode) => void runSearch(sourceMode).catch(handleError)}
                  onExtractManualVacancy={() => void extractManualVacancy().catch(handleError)}
                  onCreateManualVacancy={() => void createManualVacancy().catch(handleError)}
              />
          )}

          {view === "vacancies" && (
              <VacanciesView
                  jobs={jobs}
                  visibleJobs={visibleJobs}
                  selectedJob={selectedJob}
                  selectedResumeBase={selectedResumeBase}
                  vacancyFilters={vacancyFilters}
                  setVacancyFilters={setVacancyFilters}
                  onSelectJob={(jobId) => setSelectedJobId(jobId)}
                  onMark={markJob}
                  onDownload={handleDownload}
                  onAnalyzeMissing={() => void analyzeMissingJobs().catch(handleError)}
                  onGenerateMissingResumes={() => void generateMissingResumesForVisibleJobs().catch(handleError)}
                  onGenerateResume={(jobId) => void generateJobDocument(jobId, "resume").catch(handleError)}
                  onGenerateCoverLetter={(jobId) => void generateJobDocument(jobId, "letter").catch(handleError)}
                  onGeneratePackage={(jobId) => void generateJobDocument(jobId, "package").catch(handleError)}
              />
          )}
          {view === "companies" && <CompaniesView companies={companies} />}
          {view === "documents" && <DocumentsView documents={documents} onDownload={handleDownload} />}
          {view === "settings" && (
              <SettingsView
                  linkedinStatus={linkedinStatus}
                  gmailStatus={gmailStatus}
                  appliedVacancies={appliedVacancies}
                  rejectedResumeReport={rejectedResumeReport}
                  onRefreshLinkedIn={() => void loadLinkedInStatus().catch(handleError)}
                  onConnectLinkedIn={() => void connectLinkedIn().catch(handleError)}
                  onDisconnectLinkedIn={() => void disconnectLinkedIn().catch(handleError)}
                  onRefreshGmail={() => void loadGmailStatus().catch(handleError)}
                  onConnectGmail={() => void connectGmail().catch(handleError)}
                  onLoadApplications={() => void loadAppliedVacancies().catch(handleError)}
                  onSyncEmailApplications={() => void syncEmailApplications().catch(handleError)}
                  onLoadRejectedResumeReport={() => void loadRejectedResumeReport().catch(handleError)}
                  onImprovePromptRules={() => void improvePromptRules().catch(handleError)}
                  onRepairUserMatches={() => void repairUserMatches().catch(handleError)}
                  onRunDailyReport={() => void runDailyReport().catch(handleError)}
                  user={user}
                  onSaveDailyAutomation={(dailySettings) => void saveDailyAutomation(dailySettings).catch(handleError)}
              />
          )}
          {view === "admin" && <AdminView adminUsers={adminUsers} onLoadUsers={() => void loadAdminUsers().catch(handleError)} />}
        </section>
      </main>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
