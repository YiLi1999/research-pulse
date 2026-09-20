import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { promises as fs } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

test("Windows background launcher lifecycle", { skip: process.platform !== "win32", timeout: 360000 }, async (t) => {
  // Exercise spaces, apostrophes and wildcard-like characters without real data or network fetches.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "research-pulse-中文 [test]' "));
  const script = path.join(root, "scripts/windows-service.ps1");
  const stateFile = path.join(root, ".runtime/service.json");
  await fs.mkdir(path.join(root, "scripts"));
  await fs.mkdir(path.join(root, "src"));
  await fs.copyFile(new URL("./windows-service.ps1", import.meta.url), script);
  await fs.copyFile(new URL("./windows-service-launcher.vbs", import.meta.url), path.join(root, "scripts/windows-service-launcher.vbs"));
  // Instrument only the isolated fixture to verify that the login helper's
  // console stays invisible and its process exits after starting Node.
  await fs.appendFile(script, `
if ($Action -eq 'Run') {
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class StartupWindowProbe {
    [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
}
'@
    @{ pid = $PID; consoleVisible = [StartupWindowProbe]::IsWindowVisible([StartupWindowProbe]::GetConsoleWindow()) } |
        ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimeDir 'startup-window.json') -Encoding UTF8
}
`);
  await fs.writeFile(path.join(root, "scripts/service-config.js"),
    'console.log(JSON.stringify({port:Number(require("node:fs").readFileSync("test-port.txt", "utf8"))}));');
  await fs.writeFile(path.join(root, "src/index.js"), `
    const http = require('node:http');
    require('node:fs').writeFileSync('working-directory.txt', process.cwd());
    http.createServer((_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ok:true, service:'arxiv-quant-tracker', pid:process.pid}));
    }).listen(Number(require('node:fs').readFileSync('test-port.txt', 'utf8')), '127.0.0.1');
  `);

  const probe = http.createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  await fs.writeFile(path.join(root, "test-port.txt"), String(port));
  const run = async (action) => {
    const args = [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", script, "-Action", action, "-NodePath", process.execPath
    ];
    const stdout = await new Promise((resolve, reject) => {
      const child = spawn("powershell.exe", args, {
        cwd: os.tmpdir(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"]
      });
      let output = "", errors = "";
      child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
      child.stderr.setEncoding("utf8").on("data", (chunk) => { errors += chunk; });
      const timeout = setTimeout(() => { child.kill(); reject(new Error(`Launcher ${action} timed out`)); }, 120000);
      child.once("error", (error) => { clearTimeout(timeout); reject(error); });
      child.once("exit", (code) => {
        clearTimeout(timeout);
        // Windows background children can inherit otherwise unused pipe
        // handles. Test the launcher's exit, not EOF from its long-lived child.
        setTimeout(() => {
          child.stdout.destroy();
          child.stderr.destroy();
          if (code === 0) resolve(output);
          else reject(new Error(`Launcher ${action} failed: ${errors || output}`));
        }, 100);
      });
    });
    return stdout.trim();
  };
  const status = async () => JSON.parse(await run("Status"));
  const waitForTaskExit = async () => {
    const deadline = Date.now() + 30000;
    do {
      const current = await status();
      if (current.taskState === "Ready") return current;
      await delay(250);
    } while (Date.now() < deadline);
    assert.fail("The startup task should exit rather than supervise Node indefinitely");
  };
  const readState = async () => JSON.parse((await fs.readFile(stateFile, "utf8")).replace(/^\uFEFF/, ""));
  t.after(async () => {
    await run("Uninstall");
    // Only delete this test's resolved child of the OS temporary directory.
    const relative = path.relative(os.tmpdir(), root);
    assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
    await fs.rm(root, { recursive: true, force: true });
  });

  await t.test("starts detached with the project working directory and accepts repeated starts", async () => {
    assert.match(await run("Start"), /Running in background/);
    const first = await status();
    assert.equal(first.healthy, true);
    assert.equal(first.managed, true);
    assert.equal(await fs.readFile(path.join(root, "working-directory.txt"), "utf8"), root);
    assert.match(await run("Start"), /Already running/);
    assert.equal((await status()).pid, first.pid);
    assert.equal((await readState()).pid, first.pid);
  });

  await t.test("stops only the recorded service and permits repeated stops", async () => {
    assert.match(await run("Stop"), /Stopped managed process/);
    assert.equal((await status()).healthy, false);
    assert.match(await run("Stop"), /No managed process/);
  });

  await t.test("login starts silently once, exits while Node stays alive, and allows manual restart", async () => {
    await run("Install");
    const installed = await waitForTaskExit();
    assert.equal(installed.autoStartInstalled, true);
    assert.equal(installed.autoStartMethod, "Task Scheduler");
    assert.equal(installed.autoStartEnabled, true);
    assert.equal(installed.taskState, "Ready");
    assert.equal(installed.lastTaskResult, 0);
    assert.equal(installed.healthy, true);
    assert.deepEqual(installed.autoStartTriggers, ["LogonTrigger"]);
    assert.deepEqual(installed.repetitionIntervals, []);
    assert.equal(installed.restartCount, 0);
    assert.match(installed.launcher, /wscript\.exe$/i);
    const windowProbe = JSON.parse((await fs.readFile(path.join(root, ".runtime/startup-window.json"), "utf8")).replace(/^\uFEFF/, ""));
    assert.equal(windowProbe.consoleVisible, false);
    assert.throws(() => process.kill(windowProbe.pid, 0), { code: "ESRCH" });
    await run("Start");
    const repeated = await status();
    assert.equal(repeated.pid, installed.pid);
    assert.equal(repeated.lastTaskRun, installed.lastTaskRun, "Start should not rerun the task when the server is healthy");

    // This is only the server in our isolated temporary fixture. The real
    // Research Pulse process is never targeted by the manual restart test.
    const beforeCrash = await readState();
    assert.equal(beforeCrash.entryPath, path.join(root, "src/index.js"));
    assert.equal(beforeCrash.pid, installed.pid);
    process.kill(beforeCrash.pid);
    const stopped = await status();
    assert.equal(stopped.healthy, false);
    assert.equal(stopped.taskState, "Ready");
    assert.equal(stopped.lastTaskRun, installed.lastTaskRun);
    await run("Start");
    const restarted = await waitForTaskExit();
    assert.equal(restarted.healthy, true);
    assert.notEqual(restarted.pid, installed.pid);

    await run("Stop");
    const paused = await status();
    assert.equal(paused.taskState, "Disabled");
    assert.equal(paused.autoStartEnabled, false);
    assert.equal(paused.healthy, false);
    await run("Start");
    assert.equal((await status()).healthy, true);
    await run("Uninstall");
    const removed = await status();
    assert.equal(removed.autoStartInstalled, false);
    assert.equal(removed.managed, false);
    assert.equal(removed.healthy, false);
    await fs.access(path.join(root, "src/index.js"));
  });

  await t.test("does not stop an unrelated process when a stale PID is recorded", async () => {
    const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { windowsHide: true, stdio: "ignore" });
    try {
      await fs.writeFile(stateFile, JSON.stringify({
        pid: unrelated.pid, startTicks: "0", nodePath: process.execPath,
        entryPath: path.join(root, "src/index.js")
      }));
      assert.match(await run("Stop"), /No managed process/);
      assert.equal(unrelated.exitCode, null);
      assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
    } finally {
      const exited = once(unrelated, "exit");
      unrelated.kill();
      await exited;
    }
  });

  await t.test("recovers when a reboot leaves an incomplete process record", async () => {
    await fs.writeFile(stateFile, '{"pid":');
    assert.match(await run("Start"), /Running in background/);
    assert.equal((await status()).healthy, true);
    await run("Stop");
  });

  await t.test("refuses an occupied port without stopping its owner", async () => {
    const occupied = http.createServer((_req, res) => res.end("another app"));
    occupied.listen(port, "127.0.0.1");
    await once(occupied, "listening");
    try {
      await assert.rejects(run("Start"), /occupied\s+by\s+another\s+process/);
      assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), "another app");
    } finally {
      await new Promise((resolve) => occupied.close(resolve));
    }
  });

  await t.test("cleans up a server that exits before becoming ready", async () => {
    await fs.writeFile(path.join(root, "src/index.js"), "process.exit(17);");
    await assert.rejects(run("Start"));
    assert.equal((await status()).managed, false);
    await assert.rejects(fs.access(stateFile));
  });
});
