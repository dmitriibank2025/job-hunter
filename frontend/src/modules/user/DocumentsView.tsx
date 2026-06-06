import { SectionHead } from "../../components/ui";
import type { DocumentItem } from "../../types/domain";
import { DocumentsList } from "./DocumentsList";

type DocumentsViewProps = {
  documents: DocumentItem[];
  onDownload: (filePath?: string) => Promise<void>;
};

export function DocumentsView({ documents, onDownload }: DocumentsViewProps) {
  return (
    <section className="view is-active">
      <section className="surface">
        <SectionHead title="Generated Documents" subtitle="Resume and cover letter links." />
        <DocumentsList documents={documents} onDownload={onDownload} />
      </section>
    </section>
  );
}
