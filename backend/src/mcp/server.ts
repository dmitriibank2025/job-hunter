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
import { retrieveRelevantChunks } from "../services/embedding.service";
import { scoreResumePresentation } from "../services/resume-pipeline.service";

const USER_ID = process.env.MCP_USER_ID;

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
        const payload = chunks.map((c) => ({ id: c.id, source: c.source, text: c.text, distance: c.distance }));
        return { content: [{ type: "text", text: JSON.stringify(payload) }] };
    },
);

server.registerTool(
    "score_document",
    {
        description:
            "Check resume presentation: sections, length, generic language. This does not verify facts, provenance or job fit and cannot authorize rendering.",
        inputSchema: { markdown: z.string().describe("The complete resume in markdown.") },
    },
    async ({ markdown }) => {
        const v = scoreResumePresentation(markdown);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(v),
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
