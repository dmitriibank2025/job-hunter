const configuredApiBaseUrl = (window.JOB_HUNTER_API_BASE_URL || "").replace(/\/$/, "");
const isLocalFrontend = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

export const API_BASE_URL = !configuredApiBaseUrl || configuredApiBaseUrl.includes("${")
  ? (isLocalFrontend ? "http://localhost:4000" : "")
  : configuredApiBaseUrl;

export const defaults = {
  targetRoles: "Full Stack Engineer, Backend Engineer, Software Engineer, AI Engineer, AI Software Engineer, Applied AI Engineer, LLM Engineer",
  targetLocations: "Israel, Tel Aviv, Ramat Gan, Remote Europe",
  searchProviders: "LINKEDIN, GREENHOUSE, LEVER, ASHBY, COMEET, WORKABLE, DEVJOBS, ALLJOBS, DRUSHIM, JOBMASTER, GOTFRIENDS, SQLINK, ETHOSIA, NISHA, JOBIFY, EMPLOYBL",
  requiredTech: "Node.js, TypeScript, JavaScript, React, Next.js, NestJS, Express, Python, AWS, PostgreSQL, MongoDB, Redis, Docker, Kubernetes, microservices, distributed systems, event-driven architecture, Kafka, RabbitMQ, SQS, LLM, RAG, AI Agents, MCP",
  excludedKeywords: "PHP, WordPress, unpaid internship, C#, .NET",
  minMatchScore: "70",
  dateRangeDays: "7",
  gmailScanDays: "7",
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
    selectedFullstackResumeBaseId: "",
    selectedBackendResumeBaseId: "",
    selectedFrontendResumeBaseId: "",
    searchLocation: "Israel",
    ...JSON.parse(localStorage.getItem(storageKey) || "{}"),
  };
}
