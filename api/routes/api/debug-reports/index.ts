import { AUTHENTICATOR_APP_CONFIG } from "../../../lib/config";
import { uploadDebugReport } from "../../../lib/debug-report-upload";

export const POST = (request: Request) => uploadDebugReport(request, AUTHENTICATOR_APP_CONFIG.environment,
  AUTHENTICATOR_APP_CONFIG.aiBackendBaseUrl, task => { void task.catch(() => {
    // eslint-disable-next-line no-console -- Unexpected detached task failure.
    console.error("debug_report_task_failed");
  }); });
