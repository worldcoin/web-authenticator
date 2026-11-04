import { lookupRp } from "../../../lib/rp-handler";
import { AUTHENTICATOR_APP_CONFIG } from "../../../lib/config";

export const GET = (request: Request) => lookupRp(request, AUTHENTICATOR_APP_CONFIG.environment);
