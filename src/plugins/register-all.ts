/**
 * Central plugin registration file.
 *
 * Importing this module ensures that every diagram plugin calls
 * `registerDiagram()` so that `getAllDiagramPlugins()` returns them.
 *
 * Import this file (side-effect only) from any entry point that needs access
 * to the full plugin list — dashboard, editor, etc.
 */

import "@/plugins/sankey/sankey-plugin";
import "@/plugins/swimlane/swimlane-plugin";
