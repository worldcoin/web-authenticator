import { lookupRp } from "../../../lib/rp-handler";
import { parseAppEnvironment } from "../../../../config/environment";

export const GET = (request: Request) => lookupRp(request, parseAppEnvironment(process.env.APP_ENV ?? "staging"));
