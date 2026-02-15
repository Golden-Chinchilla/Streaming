import { DataFormat } from "@/lib/types";
import { linksToCanonicalCsv, linksToCanonicalJson } from "@/lib/source-import";
import { EditableLink } from "./sankey-types";

export function serializeLinksByFormat(links: EditableLink[], format: DataFormat) {
    if (format === "csv") {
        return linksToCanonicalCsv(links);
    }
    return linksToCanonicalJson(links);
}
