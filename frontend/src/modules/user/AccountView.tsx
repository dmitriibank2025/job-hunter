import { Field, Metric, SectionHead, TextArea } from "../../components/ui";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import type { Dispatch, SetStateAction } from "react";
import { useMemo, useState } from "react";
import type { EducationEntry, ExperienceEntry, ResumeBase, Technology, WorkspaceUser } from "../../types/domain";
import { splitTerms } from "../../utils/form";
import type { AppSettings } from "../app/types";

type ProfileDraft = {
  location: string;
  phone: string;
  linkedin: string;
  github: string;
  portfolio: string;
  languages: string;
  summary: string;
};

type BaseResumeDraft = {
  name: string;
  target: string;
  targetTitle: string;
  template: string;
};

type AccountViewProps = {
  user: WorkspaceUser | null;
  settings: AppSettings;
  selectedResumeBase?: ResumeBase;
  selectedResumeBaseId: string;
  profile: ProfileDraft;
  languageOptions: string[];
  groupedCatalog: Record<string, Technology[]>;
  selectedTech: Set<string>;
  experiences: ExperienceEntry[];
  educations: EducationEntry[];
  emptyExperience: ExperienceEntry;
  emptyEducation: EducationEntry;
  baseResume: BaseResumeDraft;
  editingResumeBaseId: string;
  resumePreview: string;
  setProfile: (profile: ProfileDraft) => void;
  setSelectedTech: (selectedTech: Set<string>) => void;
  setExperiences: Dispatch<SetStateAction<ExperienceEntry[]>>;
  setEducations: Dispatch<SetStateAction<EducationEntry[]>>;
  setBaseResume: (baseResume: BaseResumeDraft) => void;
  setEditingResumeBaseId: (id: string) => void;
  setResumePreview: (content: string) => void;
  setResumeFile: (file: File | null) => void;
  updateExperience: (index: number, patch: Partial<ExperienceEntry>) => void;
  updateEducation: (index: number, patch: Partial<EducationEntry>) => void;
  persist: (settings: AppSettings) => void;
  guardBusy: (action?: string) => boolean;
  onLogout: () => void;
  onSaveProfile: () => void;
  onSaveTechnologies: () => void;
  onSaveHistory: () => void;
  onCreateBaseResume: () => void;
  onUploadResumeFile: () => void;
  onSaveBaseResume: () => void;
  onDeleteBaseResume: () => void;
  onDownload: (filePath?: string) => Promise<void>;
};

function cleanItems(items: Array<string | undefined | null>) {
  return items.map((item) => item?.trim()).filter(Boolean) as string[];
}

function DetailGrid({ items }: { items: Array<{ label: string; value?: string | string[] }> }) {
  const visibleItems = items.filter((item) => Array.isArray(item.value) ? item.value.length : item.value?.trim());

  if (!visibleItems.length) return <div className="empty inline-empty">No information saved yet.</div>;

  return (
    <div className="detail-grid">
      {visibleItems.map((item) => (
        <div className="detail-item" key={item.label}>
          <span>{item.label}</span>
          <strong>{Array.isArray(item.value) ? item.value.join(", ") : item.value}</strong>
        </div>
      ))}
    </div>
  );
}

function SectionTools({ onEdit }: { onEdit: () => void }) {
  return (
    <button className="icon-btn" type="button" onClick={onEdit} aria-label="Edit section" title="Edit section">
      <SettingsOutlinedIcon fontSize="small" />
    </button>
  );
}

function buildLocalResumePreview(input: {
  fullName: string;
  email: string;
  profile: ProfileDraft;
  selectedTech: Set<string>;
  experiences: ExperienceEntry[];
  educations: EducationEntry[];
  targetTitle: string;
}) {
  const languages = splitTerms(input.profile.languages);
  const contacts = cleanItems([
    input.profile.location,
    input.profile.phone,
    input.email,
    input.profile.linkedin,
    input.profile.github,
    input.profile.portfolio,
  ]).join(" | ");
  const experience = input.experiences
    .filter((item) => item.company.trim() || item.title.trim())
    .map((item) => cleanItems([
      `### ${cleanItems([item.title, item.company, item.location]).join(" | ")}`,
      item.dates,
      item.project ? `Project: ${item.project}` : "",
      item.description,
      ...splitTerms(item.bullets || "").map((bullet) => `- ${bullet}`),
      splitTerms(item.technologies || "").length ? `Technologies: ${splitTerms(item.technologies || "").join(", ")}` : "",
    ]).join("\n"));
  const education = input.educations
    .filter((item) => item.institution.trim() || item.program.trim())
    .map((item) => cleanItems([
      `### ${cleanItems([item.program, item.institution, item.location]).join(" | ")}`,
      item.dates,
      ...splitTerms(item.details || "").map((detail) => `- ${detail}`),
    ]).join("\n"));

  return cleanItems([
    `# ${input.fullName || "Candidate"}`,
    input.targetTitle ? `## ${input.targetTitle}` : "",
    contacts,
    languages.length ? `Languages: ${languages.join(", ")}` : "",
    input.profile.summary ? `## Professional Summary\n${input.profile.summary}` : "",
    input.selectedTech.size ? `## Skills\n${Array.from(input.selectedTech).sort().join(", ")}` : "",
    experience.length ? `## Experience\n${experience.join("\n\n")}` : "",
    education.length ? `## Education\n${education.join("\n\n")}` : "",
  ]).join("\n\n");
}

function normalizeForMatch(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9+#.\s-]/g, " ");
}

function buildResumeInsights(content: string, input: {
  profile: ProfileDraft;
  targetTitle: string;
  targetRoles: string;
  requiredTech: string;
  selectedTech: Set<string>;
  experiences: ExperienceEntry[];
  educations: EducationEntry[];
}) {
  const resumeText = normalizeForMatch(content);
  const keywords = Array.from(new Set([
    ...splitTerms(input.targetRoles),
    ...splitTerms(input.requiredTech),
    input.targetTitle,
    ...Array.from(input.selectedTech).slice(0, 12),
  ].map((item) => item.trim()).filter(Boolean)));
  const matchedKeywords = keywords.filter((keyword) => resumeText.includes(normalizeForMatch(keyword).trim()));
  const missingKeywords = keywords.filter((keyword) => !matchedKeywords.includes(keyword)).slice(0, 12);
  const checks = [
    { label: "Contact details", done: Boolean(input.profile.phone || input.profile.linkedin || input.profile.github || input.profile.portfolio) },
    { label: "Target title", done: Boolean(input.targetTitle.trim()) },
    { label: "Professional summary", done: Boolean(input.profile.summary.trim()) },
    { label: "Skills section", done: input.selectedTech.size >= 5 || /## skills/i.test(content) },
    { label: "Experience", done: input.experiences.some((item) => item.company.trim() && item.title.trim()) },
    { label: "Education", done: input.educations.some((item) => item.institution.trim() || item.program.trim()) },
    { label: "Keyword coverage", done: keywords.length ? matchedKeywords.length / keywords.length >= 0.6 : true },
  ];
  const completed = checks.filter((check) => check.done).length;
  const score = Math.round((completed / checks.length) * 100);

  return {
    score,
    checks,
    keywords,
    matchedKeywords,
    missingKeywords,
    coverage: keywords.length ? Math.round((matchedKeywords.length / keywords.length) * 100) : 100,
  };
}

function ResumeVisualPreview({ content }: { content: string }) {
  const lines = content.split(/\r?\n/);

  return (
    <div className="resume-paper" aria-label="Resume preview">
      {lines.map((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) return <div className="resume-preview-gap" key={index} />;
        if (trimmed.startsWith("# ")) return <h1 key={index}>{trimmed.slice(2)}</h1>;
        if (trimmed.startsWith("## ")) return <h2 key={index}>{trimmed.slice(3)}</h2>;
        if (trimmed.startsWith("### ")) return <h3 key={index}>{trimmed.slice(4)}</h3>;
        if (/^[-*]\s+/.test(trimmed)) return <p className="resume-bullet" key={index}>{trimmed.replace(/^[-*]\s+/, "")}</p>;
        return <p key={index}>{trimmed}</p>;
      })}
    </div>
  );
}

export function AccountView({
  user,
  settings,
  selectedResumeBase,
  selectedResumeBaseId,
  profile,
  languageOptions,
  groupedCatalog,
  selectedTech,
  experiences,
  educations,
  emptyExperience,
  emptyEducation,
  baseResume,
  editingResumeBaseId,
  resumePreview,
  setProfile,
  setSelectedTech,
  setExperiences,
  setEducations,
  setBaseResume,
  setEditingResumeBaseId,
  setResumePreview,
  setResumeFile,
  updateExperience,
  updateEducation,
  persist,
  guardBusy,
  onLogout,
  onSaveProfile,
  onSaveTechnologies,
  onSaveHistory,
  onCreateBaseResume,
  onUploadResumeFile,
  onSaveBaseResume,
  onDeleteBaseResume,
  onDownload,
}: AccountViewProps) {
  const [editingContact, setEditingContact] = useState(false);
  const [editingTechnologies, setEditingTechnologies] = useState(false);
  const [editingHistory, setEditingHistory] = useState(false);
  const resumeDraftPreview = useMemo(() => buildLocalResumePreview({
    fullName: user?.profile?.fullName || settings.accountFullName,
    email: user?.email || settings.accountEmail,
    profile,
    selectedTech,
    experiences,
    educations,
    targetTitle: baseResume.targetTitle,
  }), [baseResume.targetTitle, educations, experiences, profile, selectedTech, settings.accountEmail, settings.accountFullName, user?.email, user?.profile?.fullName]);
  const activeResumePreview = resumePreview || resumeDraftPreview;
  const resumeInsights = useMemo(() => buildResumeInsights(activeResumePreview, {
    profile,
    targetTitle: baseResume.targetTitle,
    targetRoles: settings.targetRoles,
    requiredTech: settings.requiredTech,
    selectedTech,
    experiences,
    educations,
  }), [activeResumePreview, baseResume.targetTitle, educations, experiences, profile, selectedTech, settings.requiredTech, settings.targetRoles]);

  return (
    <section className="view is-active">
      <section className="profile-hero">
        <div className="profile-avatar">{(user?.profile?.fullName || user?.email || "U").slice(0, 1).toUpperCase()}</div>
        <div className="profile-identity">
          <p className="eyebrow">Account</p>
          <h2>{user?.profile?.fullName || settings.accountFullName || "Candidate profile"}</h2>
          <span>{user?.email || settings.accountEmail || "Sign in to manage your profile"}</span>
          <div className="profile-tags">
            <span>{user?.role || "USER"}</span>
            <span>{user?.plan || settings.accountPlan}</span>
            <span>{selectedResumeBase?.name || "No base resume selected"}</span>
          </div>
        </div>
        <button className="btn btn-secondary" type="button" onClick={() => {
          if (!guardBusy("log out")) return;
          onLogout();
        }}>Logout</button>
        {user?.limits && <div className="profile-limits">
          <Metric label="Vacancies/day" value={user.limits.vacanciesPerDay} />
          <Metric label="Resumes/month" value={user.limits.generatedResumesPerMonth} />
          <Metric label="Base resumes" value={user.limits.baseResumes} />
          <Metric label="Searches/day" value={user.limits.searchRunsPerDay} />
        </div>}
      </section>

      <section className="surface">
        <div className="section-head with-tools"><div><h2>Contact Profile</h2><p>Saved contact details, links, languages, and summary.</p></div><SectionTools onEdit={() => setEditingContact((value) => !value)} /></div>
        {!editingContact ? (
          <div className="account-card-content">
            <DetailGrid items={[
              { label: "Location", value: profile.location },
              { label: "Phone", value: profile.phone },
              { label: "LinkedIn", value: profile.linkedin },
              { label: "GitHub", value: profile.github },
              { label: "Portfolio", value: profile.portfolio },
              { label: "Languages", value: splitTerms(profile.languages) },
            ]} />
            {profile.summary.trim() && <p className="profile-summary">{profile.summary}</p>}
          </div>
        ) : (
          <>
            <div className="form-grid">
              <Field label="Location" value={profile.location} onChange={(value) => setProfile({ ...profile, location: value })} />
              <Field label="Phone" value={profile.phone} onChange={(value) => setProfile({ ...profile, phone: value })} />
              <Field label="LinkedIn" value={profile.linkedin} onChange={(value) => setProfile({ ...profile, linkedin: value })} />
              <Field label="GitHub" value={profile.github} onChange={(value) => setProfile({ ...profile, github: value })} />
              <Field label="Portfolio" value={profile.portfolio} onChange={(value) => setProfile({ ...profile, portfolio: value })} />
            </div>
            <div className="technology-catalog compact">{languageOptions.map((language) => {
              const selected = splitTerms(profile.languages).includes(language);
              return (
                <label className="tech-chip" key={language}>
                  <input type="checkbox" checked={selected} onChange={(event) => {
                    const next = new Set(splitTerms(profile.languages));
                    if (event.target.checked) next.add(language);
                    else next.delete(language);
                    setProfile({ ...profile, languages: Array.from(next).join(", ") });
                  }} />
                  {language}
                </label>
              );
            })}</div>
            <TextArea label="Professional Summary" rows={4} value={profile.summary} onChange={(value) => setProfile({ ...profile, summary: value })} />
            <button className="btn btn-primary" type="button" onClick={() => {
              onSaveProfile();
              setEditingContact(false);
            }}>Save Profile</button>
          </>
        )}
      </section>

      <section className="surface">
        <div className="section-head with-tools"><div><h2>Technology Catalog</h2><p>Technologies saved on the candidate profile.</p></div><SectionTools onEdit={() => setEditingTechnologies((value) => !value)} /></div>
        {!editingTechnologies ? (
          selectedTech.size ? <div className="readonly-tags">{Array.from(selectedTech).sort().map((name) => <span key={name}>{name}</span>)}</div> : <div className="empty inline-empty">No technologies saved yet.</div>
        ) : (
          <>
            <div className="technology-catalog">{Object.entries(groupedCatalog).map(([category, items]) => (
              <div className="tech-group" key={category}><strong>{category}</strong><div>{items.map((item) => (
                <label className="tech-chip" key={item.name}>
                  <input type="checkbox" checked={selectedTech.has(item.name)} onChange={(event) => {
                    const next = new Set(selectedTech);
                    if (event.target.checked) next.add(item.name);
                    else next.delete(item.name);
                    setSelectedTech(next);
                  }} />
                  {item.name}
                </label>
              ))}</div></div>
            ))}</div>
            <button className="btn btn-primary" type="button" onClick={() => {
              onSaveTechnologies();
              setEditingTechnologies(false);
            }}>Save Technologies</button>
          </>
        )}
      </section>

      <section className="surface">
        <div className="section-head with-tools"><div><h2>Experience & Education</h2><p>Saved history used to create user base resumes.</p></div><SectionTools onEdit={() => setEditingHistory((value) => !value)} /></div>
        {!editingHistory ? (
          <div className="two-column account-readonly-columns">
            <div className="nested-panel"><h3>Experience</h3>{experiences.filter((item) => item.company.trim() || item.title.trim()).length ? experiences.filter((item) => item.company.trim() || item.title.trim()).map((experience, index) => (
              <div className="readonly-entry" key={`${experience.company}-${index}`}>
                <strong>{cleanItems([experience.title, experience.company]).join(" | ")}</strong>
                <span>{cleanItems([experience.location, experience.dates]).join(" | ")}</span>
                {experience.project?.trim() && <p>{experience.project}</p>}
                {experience.technologies?.trim() && <small>{experience.technologies}</small>}
              </div>
            )) : <div className="empty inline-empty">No experience saved yet.</div>}</div>
            <div className="nested-panel"><h3>Education</h3>{educations.filter((item) => item.institution.trim() || item.program.trim()).length ? educations.filter((item) => item.institution.trim() || item.program.trim()).map((education, index) => (
              <div className="readonly-entry" key={`${education.institution}-${index}`}>
                <strong>{cleanItems([education.program, education.institution]).join(" | ")}</strong>
                <span>{cleanItems([education.location, education.dates]).join(" | ")}</span>
                {education.details?.trim() && <p>{education.details}</p>}
              </div>
            )) : <div className="empty inline-empty">No education saved yet.</div>}</div>
          </div>
        ) : (
          <>
            <div className="two-column">
              <div className="nested-panel"><h3>Experience</h3>
                {experiences.map((experience, index) => (
                  <div className="stacked-form" key={index}>
                    <Field label="Company" value={experience.company} onChange={(value) => updateExperience(index, { company: value })} />
                    <Field label="Title" value={experience.title} onChange={(value) => updateExperience(index, { title: value })} />
                    <Field label="Location" value={experience.location || ""} onChange={(value) => updateExperience(index, { location: value })} />
                    <Field label="Dates" value={experience.dates} onChange={(value) => updateExperience(index, { dates: value })} />
                    <Field label="Project" value={experience.project || ""} onChange={(value) => updateExperience(index, { project: value })} />
                    <TextArea label="Description" rows={3} value={experience.description || ""} onChange={(value) => updateExperience(index, { description: value })} />
                    <TextArea label="Bullets" rows={5} value={experience.bullets || ""} onChange={(value) => updateExperience(index, { bullets: value })} />
                    <Field label="Technologies" value={experience.technologies || ""} onChange={(value) => updateExperience(index, { technologies: value })} />
                    {experiences.length > 1 && <button className="btn btn-secondary" type="button" onClick={() => setExperiences((items) => items.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>}
                  </div>
                ))}
                <button className="btn btn-secondary" type="button" onClick={() => setExperiences((items) => [...items, { ...emptyExperience }])}>Add Experience</button>
              </div>
              <div className="nested-panel"><h3>Education</h3>
                {educations.map((education, index) => (
                  <div className="stacked-form" key={index}>
                    <Field label="Institution" value={education.institution} onChange={(value) => updateEducation(index, { institution: value })} />
                    <Field label="Program" value={education.program} onChange={(value) => updateEducation(index, { program: value })} />
                    <Field label="Location" value={education.location || ""} onChange={(value) => updateEducation(index, { location: value })} />
                    <Field label="Dates" value={education.dates || ""} onChange={(value) => updateEducation(index, { dates: value })} />
                    <TextArea label="Details" rows={7} value={education.details || ""} onChange={(value) => updateEducation(index, { details: value })} />
                    {educations.length > 1 && <button className="btn btn-secondary" type="button" onClick={() => setEducations((items) => items.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>}
                  </div>
                ))}
                <button className="btn btn-secondary" type="button" onClick={() => setEducations((items) => [...items, { ...emptyEducation }])}>Add Education</button>
              </div>
            </div>
            <button className="btn btn-primary" type="button" onClick={() => {
              onSaveHistory();
              setEditingHistory(false);
            }}>Save Experience & Education</button>
          </>
        )}
      </section>

      <section className="surface">
        <SectionHead title="Base Resume Builder" subtitle="Create base resumes for frontend, backend, full stack, or custom vacancies." />
        <div className="resume-builder-layout">
          <div className="resume-builder-main">
            <div className="form-grid">
              <Field label="Name" value={baseResume.name} onChange={(value) => setBaseResume({ ...baseResume, name: value })} />
              <label className="field"><span>Target</span><select value={baseResume.target} onChange={(event) => setBaseResume({ ...baseResume, target: event.target.value })}><option value="FULLSTACK">Full Stack</option><option value="FRONTEND">Frontend</option><option value="BACKEND">Backend</option><option value="CUSTOM">Custom</option></select></label>
              <Field label="Target Title" value={baseResume.targetTitle} onChange={(value) => setBaseResume({ ...baseResume, targetTitle: value })} />
              <label className="field"><span>PDF Template</span><select value={baseResume.template} onChange={(event) => setBaseResume({ ...baseResume, template: event.target.value })}><option value="ATS">ATS Compact</option><option value="MODERN">Modern</option><option value="COMPACT">Dense One Page</option></select></label>
            </div>
            <div className="inline-actions">
              <button className="btn btn-primary" type="button" onClick={onCreateBaseResume}>Create Base Resume PDF</button>
              {editingResumeBaseId && <button className="btn btn-secondary" type="button" onClick={onSaveBaseResume}>Save Selected Resume</button>}
              {editingResumeBaseId && <button className="btn btn-secondary" type="button" onClick={onDeleteBaseResume}>Delete Selected Resume</button>}
            </div>
            <div className="file-upload">
              <label className="field"><span>Upload PDF/DOCX Resume</span><input type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => setResumeFile(event.target.files?.[0] || null)} /></label>
              <button className="btn btn-secondary" type="button" onClick={onUploadResumeFile}>Upload Resume File</button>
            </div>
            <div className="resume-base-grid">{(user?.resumeBases || []).map((resume) => (
              <div
                className={`resume-base-card ${editingResumeBaseId === resume.id ? "is-editing" : ""} ${selectedResumeBaseId === resume.id ? "is-selected" : ""}`}
                key={resume.id}
                role="button"
                tabIndex={0}
                onClick={() => {
                  setEditingResumeBaseId(resume.id);
                  persist({ ...settings, selectedResumeBaseId: resume.id });
                  setBaseResume({
                    name: resume.name,
                    target: resume.target,
                    targetTitle: resume.targetTitle || "",
                    template: baseResume.template,
                  });
                  setResumePreview(resume.content);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  setEditingResumeBaseId(resume.id);
                  persist({ ...settings, selectedResumeBaseId: resume.id });
                  setBaseResume({
                    name: resume.name,
                    target: resume.target,
                    targetTitle: resume.targetTitle || "",
                    template: baseResume.template,
                  });
                  setResumePreview(resume.content);
                }}
              >
                <div>
                  <strong>{resume.name}</strong>
                  <span>{resume.target} | {resume.targetTitle || "No target title"}</span>
                </div>
                <div className="resume-base-badges">
                  {resume.isDefault && <span>Default</span>}
                  {selectedResumeBaseId === resume.id && <span>Selected</span>}
                </div>
                {resume.pdfFilePath && <button className="btn btn-secondary btn-compact" type="button" onClick={(event) => {
                  event.stopPropagation();
                  void onDownload(resume.pdfFilePath || undefined);
                }}>PDF</button>}
              </div>
            ))}</div>
            {activeResumePreview && <TextArea label="Base Resume Content" rows={16} value={activeResumePreview} onChange={setResumePreview} />}
          </div>

          <aside className="resume-advisor">
            <div className="resume-score-card">
              <span>Resume Score</span>
              <strong>{resumeInsights.score}</strong>
              <small>{resumeInsights.coverage}% keyword coverage</small>
            </div>
            <div className="resume-checklist">
              {resumeInsights.checks.map((check) => (
                <div className={check.done ? "is-done" : ""} key={check.label}>
                  <span>{check.done ? "OK" : "Fix"}</span>
                  <strong>{check.label}</strong>
                </div>
              ))}
            </div>
            <div className="keyword-panel">
              <strong>Matched Keywords</strong>
              <div>{resumeInsights.matchedKeywords.length ? resumeInsights.matchedKeywords.map((keyword) => <span className="keyword-chip is-matched" key={keyword}>{keyword}</span>) : <small>No search keywords configured.</small>}</div>
            </div>
            <div className="keyword-panel">
              <strong>Keyword Gaps</strong>
              <div>{resumeInsights.missingKeywords.length ? resumeInsights.missingKeywords.map((keyword) => <span className="keyword-chip" key={keyword}>{keyword}</span>) : <small>No keyword gaps found.</small>}</div>
            </div>
          </aside>
        </div>
        {activeResumePreview && <ResumeVisualPreview content={activeResumePreview} />}
      </section>
    </section>
  );
}
