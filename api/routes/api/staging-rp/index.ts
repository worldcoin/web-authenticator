import { lookupRp } from "../../../lib/rp-handler";

export const GET = (request: Request) => lookupRp(request, "staging");
