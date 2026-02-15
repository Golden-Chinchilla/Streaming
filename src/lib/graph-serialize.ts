import { DataFormat } from "@/lib/types";
import { linksToCanonicalCsv, linksToCanonicalJson } from "@/lib/source-import";

export type EditableLink = {
  source: string;
  target: string;
  value: number;
};

export function serializeLinksByFormat(links: EditableLink[], format: DataFormat) {
  if (format === "csv") {
    return linksToCanonicalCsv(links);
  }
  return linksToCanonicalJson(links);
}

