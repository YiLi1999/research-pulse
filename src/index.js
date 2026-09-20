import { config } from "./config/index.js";
import { initializeStorage } from "./store/repository.js";
import { refreshAll } from "./services/refreshService.js";
import { initializeScoringConfig } from "./services/scoringService.js";
import { createServer } from "./web/server.js";
import { logger } from "./utils/logger.js";

async function main() {
  await initializeStorage();
  await initializeScoringConfig();

  if (process.argv.includes("--refresh")) {
    await refreshAll();
    logger.info("Refresh completed in CLI mode");
    return;
  }

  const app = createServer();
  app.listen(config.app.port, config.app.host, async () => {
    logger.info(`Server started at ${config.app.publicOrigin || `http://${config.app.host}:${config.app.port}`}`);
    try {
      await refreshAll();
      logger.info("Initial refresh completed");
    } catch (error) {
      logger.warn("Initial refresh failed", { error: error.message });
    }
  });
}

main().catch((error) => {
  logger.error("Application failed to start", { error: error.message });
  process.exitCode = 1;
});
