/**
 * MCP server exposing the resume agent's tools over the Model Context Protocol
 * (stdio transport). Any MCP-capable client can discover and call these:
 *   - search_experience: pgvector RAG retrieval over the candidate corpus
 *   - score_document:    the ATS/rubric evaluator
 *
 * Context (which user's corpus / which vacancy) is provided via env so the tool
 * arguments stay clean: MCP_USER_ID, MCP_JOB_ID.
 *
 * IMPORTANT: stdout is the MCP protocol channel — never console.log here.
 */
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { prisma } from "../infrastructure/prisma";
import { retrieveRelevantChunks } from "../services/embedding.service";
import { validateResumeAgainstJob } from "../services/ats-resume-validator.service";

const USER_ID = process.env.MCP_USER_ID;
const JOB_ID = process.env.MCP_JOB_ID;

const server = new McpServer({ name: "resume-tools", version: "1.0.0" });

server.registerTool(
    "search_experience",
    {
        description:
            "Vector search (pgvector RAG) over the candidate's real experience corpus. Returns the most relevant bullets for a query.",
        inputSchema: {
            query: z.string().describe("What to look for, e.g. 'event-driven AWS backend'."),
            k: z.number().int().min(1).max(10).optional().describe("How many results (default 6)."),
        },
    },
    async ({ query, k }) => {
        if (!USER_ID) throw new Error("MCP_USER_ID not set");
        const chunks = await retrieveRelevantChunks(USER_ID, query, k ?? 6);
        const payload = chunks.map((c) => ({ source: c.source, text: c.text }));
        return { content: [{ type: "text", text: JSON.stringify(payload) }] };
    },
);

server.registerTool(
    "score_document",
    {
        description:
            "Score a full resume (markdown) against the target vacancy with the ATS/rubric evaluator. Returns score 0-100 and issues.",
        inputSchema: { markdown: z.string().describe("The complete resume in markdown.") },
    },
    async ({ markdown }) => {
        if (!JOB_ID) throw new Error("MCP_JOB_ID not set");
        const job = await prisma.job.findUniqueOrThrow({ where: { id: JOB_ID } });
        const v = validateResumeAgainstJob(job, markdown);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        score: v.score,
                        qualityScore: v.qualityScore,
                        issues: v.issues,
                        missingImportantKeywords: v.missingImportantKeywords,
                    }),
                },
            ],
        };
    },
);

async function main() {
    await server.connect(new StdioServerTransport());
}

main().catch((err) => {
    process.stderr.write(`[mcp] fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
});
