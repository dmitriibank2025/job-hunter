export function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error || new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}

export function splitTerms(value: string) {
  return value.split(/[\n,;]/).map((item) => item.trim()).filter(Boolean);
}

export function splitLines(value: string) {
  return value.split(/\n/).map((item) => item.trim().replace(/^[-*]\s*/, "")).filter(Boolean);
}

export function splitDateRange(value: string) {
  const [startDate, endDate] = value.split(/\s*(?:-|–|—|to)\s*/i).map((item) => item.trim()).filter(Boolean);
  return { startDate: startDate || "", endDate };
}

export function shortText(value = "", limit = 240) {
  return value.length > limit ? `${value.slice(0, limit).trim()}...` : value;
}
