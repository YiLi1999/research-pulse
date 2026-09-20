import { fetchNatureRecentPhysics } from "../fetchers/natureRecent.js";
import { writeJson } from "../utils/fs.js";
import { logger } from "../utils/logger.js";

const OUTPUT_PATH = "data/nature_recent_physics.json";

async function main() {
  const items = await fetchNatureRecentPhysics(7);
  await writeJson(OUTPUT_PATH, items);

  logger.info("Saved Nature recent physics items", {
    output: OUTPUT_PATH,
    count: items.length
  });
}

main().catch((error) => {
  logger.error("Nature fetch job failed", { error: error.message });
  process.exitCode = 1;
});
