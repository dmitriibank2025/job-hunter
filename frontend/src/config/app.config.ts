const configuredApiBaseUrl = (window.JOB_HUNTER_API_BASE_URL || "").replace(/\/$/, "");
const isLocalFrontend = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

export const API_BASE_URL = !configuredApiBaseUrl || configuredApiBaseUrl.includes("${")
  ? (isLocalFrontend ? "http://localhost:4000" : "")
  : configuredApiBaseUrl;

export const defaults = {
  targetRoles: "Frontend Developer, Backend Developer, Full Stack Developer",
  targetLocations: "Israel, Tel Aviv, Ramat Gan, Remote Europe",
  requiredTech: "React, TypeScript, Node.js, Express, PostgreSQL, Redis, AWS",
  excludedKeywords: "PHP, WordPress, unpaid internship, C#, .NET",
  minMatchScore: "70",
  dateRangeDays: "7",
};

export const storageKey = "jobHunterReactSettings";
export const authStorageKey = "jobHunterReactAuth";

export function defaultSettings() {
  return {
    ...defaults,
    accountEmail: "",
    accountFullName: "",
    accountPassword: "",
    accountPlan: "FREE",
    userId: "",
    selectedResumeBaseId: "",
    searchLocation: "Israel",
    ...JSON.parse(localStorage.getItem(storageKey) || "{}"),
  };
}
