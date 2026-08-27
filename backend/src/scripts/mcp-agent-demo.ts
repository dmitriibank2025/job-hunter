/**
 * MCP-backed resume agent demo.
 *
 * Spawns the MCP server (src/mcp/server.ts) over stdio, DISCOVERS its tools via
 * the MCP protocol (listTools), bridges them into an OpenAI function-calling
 * loop, and lets the model plan → call tools over MCP → revise. Proves a real
 * MCP client/server + tool-use agent, not just a Skills-line keyword.
 *
 * Usage: tsx src/scripts/mcp-agent-demo.ts --email=user@example.com --job=<jobId>
 */
import "dotenv/config";
import path from "path";
import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { prisma } from "../infrastructure/prisma";
import { inferResumeTargetForJob } from "../services/resume-base-selector.service";

const MODEL = process.env.RESUME_AGENT_MODEL ?? "gpt-4.1-mini";
const arg = (f: string) => process.argv.find((a) => a.startsWith(`--${f}=`))?.split("=").slice(1).join("=").trim();

function cleanEnv(extra: Record<string, string>): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (typeof v === "string") env[k] = v;
    return { ...env, ...extra };
}

async function main() {
    const jobId = arg("job");
    if (!jobId) throw new Error("Pass --job=<jobId>");
    const email = arg("email");
    const user = email
        ? await prisma.appUser.findUniqueOrThrow({ where: { email }, select: { id: true } })
        : (await prisma.appUser.findMany({ select: { id: true } }))[0];
    const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    const target = inferResumeTargetForJob(job);
    const base =
        (await prisma.userResumeBase.findFirst({ where: { userId: user.id, target } })) ??
        (await prisma.userResumeBase.findFirst({ where: { userId: user.id, isDefault: true } }));
    if (!base) throw new Error("No base resume");

    // 1) Connect to the MCP server (spawns it over stdio) and discover tools.
    const serverPath = path.join(__dirname, "..", "mcp", "server.ts");
    const transport = new StdioClientTransport({
        command: "npx",
        args: ["tsx", serverPath],
        env: cleanEnv({ MCP_USER_ID: user.id, MCP_JOB_ID: jobId }),
    });
    const client = new Client({ name: "resume-agent", version: "1.0.0" });
    await client.connect(transport);
    const { tools: mcpTools } = await client.listTools();
    console.log("MCP tools discovered:", mcpTools.map((t) => t.name).join(", "));

    // 2) Bridge MCP tool schemas into OpenAI function-calling tool defs.
    const tools: ChatCompletionTool[] = mcpTools.map((t) => ({
        type: "function",
        function: {
            name: t.name,
            description: t.description ?? "",
            parameters: (t.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
        },
    }));

    const baseTitleLine = base.content.split("\n").map((l) => l.trim()).find((l) => l.includes(" | ")) ?? "";
    const baseRoleLabel = baseTitleLine.split("|")[0].trim();
    const messages: ChatCompletionMessageParam[] = [
        {
            role: "system",
            content: [
                "You are a resume-tailoring agent. Ground every statement in the base resume or search_experience results; never invent facts.",
                `Keep the exact title line "${baseTitleLine}" and start the Summary with "${baseRoleLabel}"; never upgrade seniority.`,
                "Workflow: call search_experience to gather evidence, draft a tailored resume, call score_document, revise, then return ONLY the final markdown.",
            ].join("\n"),
        },
        {
            role: "user",
            content: `TARGET VACANCY\nTitle: ${job.title}\nCompany: ${job.company ?? "n/a"}\n\n${job.description.slice(0, 5000)}\n\n=== BASE RESUME ===\n${base.content}`,
        },
    ];

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    let searchCalls = 0;
    let scoreCalls = 0;
    const scoreTrace: number[] = [];

    for (let round = 0; round < 8; round += 1) {
        const resp = await openai.chat.completions.create({ model: MODEL, temperature: 0.2, messages, tools, tool_choice: "auto" });
        const msg = resp.choices[0].message;
        messages.push(msg);
        if (!msg.tool_calls?.length) {
            console.log(`\nrounds=${round + 1} search=${searchCalls} score=${scoreCalls} scoreTrace=${scoreTrace.join("→") || "none"}`);
            console.log("\n--- first 500 chars ---\n" + (msg.content ?? "").slice(0, 500));
            break;
        }
        for (const call of msg.tool_calls) {
            if (call.type !== "function") continue;
            const args = JSON.parse(call.function.arguments || "{}");
            // 3) Execute the tool OVER MCP.
            const res = await client.callTool({ name: call.function.name, arguments: args });
            const text = Array.isArray(res.content) && res.content[0]?.type === "text" ? res.content[0].text : JSON.stringify(res.content);
            if (call.function.name === "search_experience") searchCalls += 1;
            if (call.function.name === "score_document") {
                scoreCalls += 1;
                try { scoreTrace.push(JSON.parse(text).score); } catch { /* ignore */ }
            }
            messages.push({ role: "tool", tool_call_id: call.id, content: text });
        }
    }

    await client.close();
}

main()
    .catch((e) => {
        console.error(e instanceof Error ? e.message : e);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
