import { fetchAps } from "../fetchers/aps/index.js";
import { writeLocalAcceptedExport } from "../fetchers/aps/localAccepted.js";
import { initializeStorage } from "../store/repository.js";
import { logger } from "../utils/logger.js";

async function main() {
  await initializeStorage();
  const result = await fetchAps({
    journals: ["prl", "pra", "prx", "prxquantum", "prapplied", "prresearch"],
    status: ["accepted"],
    days: 30
  });

  await writeLocalAcceptedExport(result.normalized);
  logger.info("Wrote local APS accepted export", { count: result.normalized.length });
}

main().catch((error) => {
  logger.error("Failed to write local APS accepted export", { error: error.message });
  process.exitCode = 1;
});
