function stamp() {
  return new Date().toISOString();
}

function write(level, message, extra) {
  const payload = extra ? ` ${JSON.stringify(extra)}` : "";
  console.log(`[${stamp()}] [${level}] ${message}${payload}`);
}

export const logger = {
  info(message, extra) {
    write("INFO", message, extra);
  },
  warn(message, extra) {
    write("WARN", message, extra);
  },
  error(message, extra) {
    write("ERROR", message, extra);
  }
};
