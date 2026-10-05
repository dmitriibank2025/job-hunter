import fs from "fs/promises";
import os from "os";
import path from "path";
import JSZip from "jszip";
import { createStyledResumeDocx } from "../services/docx.service";

const headline = "Full Stack Engineer | Node.js | TypeScript | React | AI/LLM | AWS";
describe("Word header from the current source format", () => {
  let directory: string;
  beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), "job-hunter-header-test-")); });
  afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });
  async function paragraphs(content: string) {
    const file = path.join(directory, "resume.docx");
    await createStyledResumeDocx(content, file);
    const zip = await JSZip.loadAsync(await fs.readFile(file));
    const xml = await zip.file("word/document.xml")!.async("string");
    return { zip, rows: [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map(m => m[0]) };
  }
  test("keeps stack, two contact rows and independent URLs", async () => {
    const { zip, rows } = await paragraphs(`DMITRII BANK\n${headline}\nRishon LeZion, Israel | +972-53-500-21-68 | dmitrii.bank.dev@gmail.com\nlinkedin.com/in/dmitrii-bank | github.com/DmitriiBank | Hebrew · English · Russian\n## Summary\nVerified summary.`);
    expect(rows[0]).toContain("DMITRII BANK");
    expect(rows[0]).not.toContain("Rishon");
    expect(rows[1]).toContain(headline);
    for (const row of rows.slice(0, 4)) expect(row).toContain('w:val="center"');
    expect(rows[3]).toContain("Hebrew · English · Russian");
    const rels = await zip.file("word/_rels/document.xml.rels")!.async("string");
    expect(rels).toContain('Target="https://linkedin.com/in/dmitrii-bank"');
    expect(rels).toContain('Target="https://github.com/DmitriiBank"');
  });
  test("legacy name and city separated by tabs never share the name field", async () => {
    const { rows } = await paragraphs(`# DMITRII BANK\t\tRishon LeZion, Israel\n\n${headline}\nEmail: dmitrii.bank.dev@gmail.com\n## Summary\nVerified summary.`);
    expect(rows[0]).not.toContain("Rishon");
    expect(rows[1]).toContain(headline);
    expect(rows[2]).toContain("Rishon LeZion, Israel");
  });
});
