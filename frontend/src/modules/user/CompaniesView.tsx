import { SectionHead } from "../../components/ui";

type CompaniesViewProps = {
  companies: any[];
};

export function CompaniesView({ companies }: CompaniesViewProps) {
  return (
    <section className="view is-active">
      <section className="surface">
        <SectionHead title="Company Priority" subtitle="Active company targets promoted by provider results." />
        <div className="company-grid">
          {companies.map((company, index) => (
            <article className="company-card" key={`${company.name}-${index}`}>
              <strong>{index + 1}. {company.name}</strong>
              <span>{company.locationHint || "Israel"} | priority {company.priority ?? "-"}</span>
              <span>{company.active ? "Active" : "Cooling down"}</span>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
