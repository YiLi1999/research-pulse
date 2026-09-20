import { config } from "../src/config/index.js";

// Deliberately exclude credentials: the Windows launcher only needs the port.
console.log(JSON.stringify({ port: config.app.port }));
