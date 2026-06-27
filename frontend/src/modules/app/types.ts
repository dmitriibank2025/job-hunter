import type { defaultSettings } from "../../config/app.config";

export type AuthMode = "login" | "register";
export type AppSettings = ReturnType<typeof defaultSettings>;

export type JobStatistics = {
  generatedResumes: number;
  sent: number;
  applied?: number;
  submitted?: number;
  tracked?: number;
  positive: number;
  negative: number;
  noResponse: number;
  pendingFeedback?: number;
  emailEvents: number;
  rejectionRecords?: number;
};

export const REJECTION_REASONS = [
  { value: "WRONG_TECH_STACK", label: "Wrong tech stack" },
  { value: "WRONG_SENIORITY", label: "Wrong seniority level" },
  { value: "OVERQUALIFIED", label: "Overqualified" },
  { value: "UNDERQUALIFIED", label: "Underqualified" },
  { value: "LOCATION_MISMATCH", label: "Location mismatch" },
  { value: "COMPANY_TYPE_MISMATCH", label: "Company type mismatch" },
  { value: "SALARY_MISMATCH", label: "Salary mismatch" },
  { value: "NO_RESPONSE", label: "No response" },
  { value: "OTHER", label: "Other / unknown" },
] as const;
