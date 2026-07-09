import { handler } from "../netlify/functions/sync-catalog-background.js";

// @ts-expect-error - background functions don't need real event/context for local testing
const result = await handler({}, {});
console.log("Handler result:", result);
