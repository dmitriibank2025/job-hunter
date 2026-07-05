/**
 * Health endpoint unit tests.
 * We test the route logic directly, mocking Prisma + storage so no DB is needed.
 */

// Mock prisma before app is imported
jest.mock("../infrastructure/prisma", () => ({
    prisma: { $queryRaw: jest.fn().mockResolvedValue([{ "?column?": 1 }]) },
}));

// Mock storage helpers
jest.mock("../infrastructure/object-storage", () => ({ isS3Enabled: () => false }));
jest.mock("../services/file-storage.service", () => ({ getStorageRoot: () => "/tmp" }));

// Suppress logger noise
jest.mock("../Logger/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import request from "supertest";
import { createApp } from "../app";

const app = createApp();

describe("GET /health", () => {
    it("returns 200 OK", async () => {
        const res = await request(app).get("/health");
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ status: "OK" });
    });
});

describe("GET /health/live", () => {
    it("returns 200 OK", async () => {
        const res = await request(app).get("/health/live");
        expect(res.status).toBe(200);
        expect(res.body.status).toBe("OK");
    });
});

describe("GET /health/ready", () => {
    it("returns 200 when DB and storage are healthy", async () => {
        const res = await request(app).get("/health/ready");
        expect(res.status).toBe(200);
        expect(res.body.status).toBe("OK");
        expect(res.body.checks.db.ok).toBe(true);
        expect(res.body.checks.storage.ok).toBe(true);
    });

    it("returns 503 when DB query fails", async () => {
        const { prisma } = require("../infrastructure/prisma");
        (prisma.$queryRaw as jest.Mock).mockRejectedValueOnce(new Error("connection refused"));

        const res = await request(app).get("/health/ready");
        expect(res.status).toBe(503);
        expect(res.body.status).toBe("DEGRADED");
        expect(res.body.checks.db.ok).toBe(false);
        expect(res.body.checks.db.detail).toMatch(/connection refused/);
    });
});
