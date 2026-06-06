import { downloadStorageFile } from "../../api/client";
import type { DocumentItem } from "../../types/domain";

function inferredPdfPath(filePath?: string, pdfFilePath?: string | null) {
  if (pdfFilePath) return pdfFilePath;
  if (!filePath || !/\.docx$/i.test(filePath)) return undefined;
  return filePath.replace(/\.docx$/i, ".pdf");
}

export function DocumentsList({ documents, onDownload = downloadStorageFile }: { documents: DocumentItem[]; onDownload?: (filePath?: string) => Promise<void> }) {
  if (!documents.length) return <div className="empty">No documents generated yet.</div>;
  return <div className="documents-list">{documents.map((item, index) => {
    const pdfPath = item.documentType === "Resume" ? inferredPdfPath(item.filePath, item.pdfFilePath) : undefined;
    return (
      <article className="document-row" key={`${item.id || item.filePath}-${index}`}>
        <div>
          <strong>{item.documentType}</strong>
          <span>{item.job ? `${item.job.company || "Company"} | ${item.job.title}` : item.filePath}</span>
          {item.createdAt && <small>{new Date(item.createdAt).toLocaleString()}</small>}
        </div>
        <div className="inline-actions">
          {item.filePath && <button className="btn btn-primary" type="button" onClick={() => void onDownload(item.filePath)}>{item.documentType === "Resume" ? "DOCX" : "Letter"}</button>}
          {pdfPath && <button className="btn btn-secondary" type="button" onClick={() => void onDownload(pdfPath)}>PDF</button>}
        </div>
      </article>
    );
  })}</div>;
}
