export function SectionHead({ title, subtitle }: { title: string; subtitle: string }) {
  return <div className="section-head"><div><h2>{title}</h2><p>{subtitle}</p></div></div>;
}
