import { lookupRp } from "../../../lib/rp-handler";
import { protocolEnvironmentForOrigin } from "../../../../packages/contracts/src/deployment";

export const GET = (request: Request) => lookupRp(request, protocolEnvironmentForOrigin(new URL(request.url).origin));
