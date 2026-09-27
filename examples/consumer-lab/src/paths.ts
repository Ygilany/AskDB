/** Where the lab keeps things. */
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The lab app's root (examples/consumer-lab). */
export const LAB_ROOT = fileURLToPath(new URL("..", import.meta.url));
/** Local, gitignored state: tarballs, the install target, artifacts, scratch config. */
export const LAB_STATE = join(LAB_ROOT, ".lab");
