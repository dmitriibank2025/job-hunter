import fs from "fs/promises";
import path from "path";
import { chromium } from "playwright";

export type BasicResumePdfTemplate = "ATS" | "MODERN" | "COMPACT";

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function markdownToBasicHtml(content: string): string {
    return content
        .split(/\r?\n/)
        .map((line) => {
            const trimmed = line.trim();

            if (!trimmed) return `<div class="spacer"></div>`;
            if (trimmed.startsWith("# ")) return `<h1>${escapeHtml(trimmed.slice(2))}</h1>`;
            if (trimmed.startsWith("## ")) return `<h2>${escapeHtml(trimmed.slice(3))}</h2>`;
            if (trimmed.startsWith("### ")) return `<h3>${escapeHtml(trimmed.slice(4))}</h3>`;
            if (/^[-*•]\s+/.test(trimmed)) {
                return `<li>${escapeHtml(trimmed.replace(/^[-*•]\s+/, ""))}</li>`;
            }

            return `<p>${escapeHtml(trimmed)}</p>`;
        })
        .join("\n");
}

function buildBasicResumeHtml(content: string, template: BasicResumePdfTemplate): string {
    const theme = {
        ATS: {
            page: "A4",
            margin: "18mm",
            font: "Arial, Helvetica, sans-serif",
            bodySize: "10.6pt",
            lineHeight: "1.38",
            h1: "21pt",
            h2: "12.5pt",
            h3: "10.8pt",
            accent: "#151515",
            background: "#fff",
            border: "#d5d5d5",
        },
        MODERN: {
            page: "A4",
            margin: "17mm",
            font: "Arial, Helvetica, sans-serif",
            bodySize: "10.5pt",
            lineHeight: "1.42",
            h1: "23pt",
            h2: "12.8pt",
            h3: "11pt",
            accent: "#1d5f72",
            background: "#fbfbf8",
            border: "#bfd2d8",
        },
        COMPACT: {
            page: "A4",
            margin: "13mm",
            font: "Arial, Helvetica, sans-serif",
            bodySize: "9.8pt",
            lineHeight: "1.26",
            h1: "18pt",
            h2: "11.2pt",
            h3: "10.2pt",
            accent: "#111",
            background: "#fff",
            border: "#cfcfcf",
        },
    }[template];

    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    @page { size: ${theme.page}; margin: ${theme.margin}; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #151515;
      background: ${theme.background};
      font-family: ${theme.font};
      font-size: ${theme.bodySize};
      line-height: ${theme.lineHeight};
    }
    h1 {
      margin: 0 0 6px;
      color: ${theme.accent};
      font-size: ${theme.h1};
      line-height: 1.1;
      letter-spacing: 0;
    }
    h2 {
      margin: 13px 0 5px;
      padding-bottom: 2px;
      border-bottom: 1px solid ${theme.border};
      color: ${theme.accent};
      font-size: ${theme.h2};
      line-height: 1.15;
    }
    h3 {
      margin: 8px 0 3px;
      font-size: ${theme.h3};
      line-height: 1.2;
    }
    p {
      margin: 2px 0;
      white-space: pre-wrap;
    }
    li {
      margin: 2px 0 2px 16px;
      padding-left: 2px;
    }
    .spacer { height: 6px; }
  </style>
</head>
<body>${markdownToBasicHtml(content)}</body>
</html>`;
}

export async function createBasicResumePdf(
    content: string,
    outputPath: string,
    template: BasicResumePdfTemplate = "ATS",
) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    const browser = await chromium.launch({
        headless: process.env.PROVIDER_HEADLESS !== "false",
    });

    try {
        const page = await browser.newPage();
        await page.setContent(buildBasicResumeHtml(content, template), { waitUntil: "load" });
        await page.pdf({
            path: outputPath,
            format: "A4",
            printBackground: true,
            preferCSSPageSize: true,
        });
    } finally {
        await browser.close().catch(() => undefined);
    }

    return outputPath;
}
