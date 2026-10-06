# Evidence-based resume generation

`generateResumeForJob`, `regenerateResumeVersion`, and `runResumeAgent` now use:

Job Analyzer → Query Planner → search_experience retrieval → Evidence Mapper → Resume Generator → deterministic validation → Critic → bounded Repair → deterministic revalidation → Markdown → DOCX/PDF.

The production process calls the same user-scoped pgvector retrieval implementation exposed by MCP `search_experience`, in process (no additional stdio subprocess). The existing cosine/HNSW migration is unchanged. The tool now returns database IDs as well as source, text and distance. Trace records preserve the requirement, query, raw search result IDs and admitted verified evidence IDs.

## Contracts

- Zod checks all stage outputs. Unknown references, malformed responses, retrieval errors, exhausted factual repairs and unresolved qualitative issues stop generation before any CV is saved/rendered. There is no fallback to unvalidated Markdown.
- Requirement IDs are deterministic hashes of the exact term and category, independent of ordering. Source quotations must occur in the vacancy. Duplicate conflicting classifications are rejected.
- Live structured-output contracts constrain source quotations to original vacancy spans and map assessments to required requirement-ID keys, preventing rewritten citations and duplicate/omitted mappings. Alternative stacks are kept as alternatives.
- A deterministic metadata reconciliation removes absent keywords and unverified requirement links before validation. It never changes claim text, evidence IDs, employment identity or dates; all substantive factual failures remain blocking. The trace records these annotation corrections.
- Every displayed claim has `evidenceIds`, `requirementIds`, `keywords`, and `evidenceStatus`. Employer/project headers bind dates and identity to an entity. Personal evidence cannot become commercial evidence.
- `valid` is independent of `score.total`. Unsupported claims, unknown employers/projects, changed dates, fake education and invalid provenance cause FAIL. Penalties include unsupported skill/technology −20, invented numeric statement −30, seniority upgrade −15, personal→commercial −30. Missing vacancy skills reduce fit but do not force invention or invalidate an honest resume.
- Score weights: must-have 35%, evidence 20%, responsibility 15%, keyword 10%, architecture/domain 10%, consistency 5%, structure 5%. Exact requirement coverage needs an admitted claim linked to a SUPPORTED mapping; partial support is not exact coverage.
- Critic always runs, including after deterministic PASS. Repairs are revalidated and critiqued. `ATS_RESUME_REPAIR_ATTEMPTS` controls the budget, capped at three. `ATS_RESUME_ENFORCE` cannot disable the factual gate.
- Critic distinguishes candidate fit gaps from editable document defects; it must not request unsupported experience or new facts as a repair.
- MCP `score_document` checks presentation only. Historical `validateResumeAgainstJob(job, markdown)` remains compatible but returns `valid: null`: Markdown alone cannot establish factual validity. Its optional evidence context returns independent factual validation and the new score.
- Each successful generation stores `*.evidence.json` next to the CV, including schema version, verified facts, retrieval trace, structured resume, mappings, validation and critic attempts. Treat it as private candidate data under the same storage/access policy as the resume.

## Deliberately conservative evidence admission

The current `ExperienceChunk` table lacks typed employer/project ownership and verification metadata. A retrieved legacy chunk is admitted only when it matches a current base fact and its source identity. Search similarity alone never admits a new fact. The mapper also receives the complete current verified base so a top-k miss does not erase known experience. Expanding evidence beyond the current base requires a verified structured fact-ingestion workflow; no model is allowed to manufacture that authority.

The generator selects and orders **complete exact verified statements**. It cannot freely paraphrase facts. A valid evidence ID cannot prove that a newly worded sentence preserves negation, metrics or attribution. This restriction makes deterministic factual checks enforceable. Improvements in wording require updating the verified fact source. Unsupported base formats stop with a diagnostic rather than silently inventing a parsed profile. The parser supports the repository's dated pipe-separated employment/project headers, Markdown bullets and plain paragraphs extracted from DOCX.

The current Dmitrii Bank source supersedes historical education instructions: the uploaded 2026 resume contains D.M.D., Dental Medicine at MSUMD, not a Master's degree. Education must be extracted from that source, never injected from a prompt. Optimadevs 2024–Present, VTA Center 2022–2024, 4+ commercial years and personal AI work remain unchanged. AVSD+/Tel-Ran are excluded by the existing candidate policy. Dates conflicting with that policy stop generation. AI policy still forbids MCP Resources/Prompts, measured HNSW latency claims, model training/fine-tuning and human evaluation claims. Role variants reorder source skills without changing the verified fact set; the activation script keeps old bases and a rollback snapshot.

The existing styled DOCX renderer consumes the final checked content. Positional template replacement is bypassed on this path because it can retain unmatched old paragraphs or drop additional content. No post-validation LLM rewrite, skeleton merge, sanitizer or deduplication changes the approved text. PDF conversion/fallback remains unchanged. Presentation checks on Markdown cannot detect physical page overflow; rendered-file inspection remains a separate concern.

## Verification

Run `pnpm run typecheck` and `pnpm --dir backend test --runInBand`. Tests cover source policy, stable IDs, unsupported claims with real evidence IDs, wrong entity attribution, partial support, validity versus fit, critic-after-PASS, repair regression/exhaustion, malformed output, retrieval failure, and production persistence/render gates. Tests use mocked model/database calls; they do not certify live OpenAI responses, deployed pgvector availability or actual PDF pagination.
