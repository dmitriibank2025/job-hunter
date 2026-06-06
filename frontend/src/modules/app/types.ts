import type { defaultSettings } from "../../config/app.config";

export type AuthMode = "login" | "register";
export type AppSettings = ReturnType<typeof defaultSettings>;

export type JobStatistics = {
  generatedResumes: number;
  sent: number;
  positive: number;
  negative: number;
  noResponse: number;
  emailEvents: number;
};
