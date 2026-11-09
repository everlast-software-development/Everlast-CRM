import type { DocPage } from "./model";
import { agentGuidePages } from "./pages/agentGuide";
import { supervisorGuidePages } from "./pages/supervisorGuide";
import { startPages } from "./pages/start";
import { inboxPages } from "./pages/inbox";
import { contactPages } from "./pages/contacts";
import { campaignPages } from "./pages/campaigns";
import { templatePages } from "./pages/templates";
import { oversightPages } from "./pages/oversight";
import { adminPages } from "./pages/admin";
import { technicalPages } from "./pages/technical";
import { helpPages } from "./pages/help";

/** Every documentation page, in reading order. Each page says who sees it. */
export const DOC_PAGES: DocPage[] = [
  ...agentGuidePages,
  ...supervisorGuidePages,
  ...startPages,
  ...inboxPages,
  ...contactPages,
  ...campaignPages,
  ...templatePages,
  ...oversightPages,
  ...adminPages,
  ...technicalPages,
  ...helpPages,
];
