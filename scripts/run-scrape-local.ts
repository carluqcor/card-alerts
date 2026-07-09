import { handler } from "../netlify/functions/scrape-background.js";

// @ts-expect-error - scheduled functions don't need real event/context for local testing
const result = await handler({}, {});
console.log("Handler result:", result);
