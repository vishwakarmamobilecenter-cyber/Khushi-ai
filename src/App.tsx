/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from "react";
import { GoogleGenAI, Modality, Type } from "@google/genai";
import { Mic, Send, Volume2, VolumeX, Loader2, User, Bot, Sparkles, Settings, Smartphone, AppWindow, ShieldCheck, Code, Download, Trash2, MessageSquare } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

// Initialize Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface Project {
  id: string;
  name: string;
  code: string;
  timestamp: string;
}

export default function App() {
  const [message, setMessage] = useState("");
  const [chat, setChat] = useState<Message[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPermissions, setShowPermissions] = useState(false);
  const [fullAccessGranted, setFullAccessGranted] = useState(false);
  const [isAutoListen, setIsAutoListen] = useState(true);
  const [quotaExhaustedUntil, setQuotaExhaustedUntil] = useState<number>(0);
  const [systemLogs, setSystemLogs] = useState<string[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallBtn, setShowInstallBtn] = useState(false);
  const [activeTab, setActiveTab] = useState<"chat" | "projects">("chat");
  
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstallBtn(true);
    });

    window.addEventListener('appinstalled', () => {
      setShowInstallBtn(false);
      setDeferredPrompt(null);
      addLog("System: App installed successfully!");
    });
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      addLog("System: Installing app...");
    }
    setDeferredPrompt(null);
    setShowInstallBtn(false);
  };
  const recognitionRef = useRef<any>(null);
  const isSpeakingRef = useRef(false);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat, activeTab]);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      recognitionRef.current.lang = "hi-IN";

      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setMessage(transcript);
        setIsListening(false);
        handleSendMessage(transcript);
      };

      recognitionRef.current.onerror = (event: any) => {
        if (event.error !== 'aborted') {
          console.error("Speech recognition error:", event.error);
        }
        setIsListening(false);
        if (isAutoListen && event.error !== 'not-allowed' && event.error !== 'aborted') {
          setTimeout(() => startListening(), 1000);
        }
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
        if (isAutoListen && !isSpeakingRef.current && !isProcessing) {
          // Add a small delay to prevent rapid restart issues
          setTimeout(() => startListening(), 500);
        }
      };
    }
  }, [isAutoListen, isProcessing]);

  useEffect(() => {
    if (isAutoListen) {
      startListening();
    }
  }, []);

  const addLog = (log: string) => {
    setSystemLogs(prev => [log, ...prev].slice(0, 5));
  };

  const downloadProject = (project: Project) => {
    const blob = new Blob([project.code], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.name.replace(/\s+/g, '_')}_source.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    addLog(`Downloaded: ${project.name}`);
  };

  const deleteProject = (id: string) => {
    setProjects(prev => prev.filter(p => p.id !== id));
    addLog("Project Deleted");
  };

  const startListening = () => {
    if (recognitionRef.current && !isListening && !isSpeakingRef.current) {
      setError(null);
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch (e) {
        console.log("Recognition already started or error:", e);
      }
    }
  };

  const speakFallback = (text: string) => {
    if (!('speechSynthesis' in window)) {
      setIsSpeaking(false);
      isSpeakingRef.current = false;
      if (isAutoListen) startListening();
      return;
    }
    // Cancel any ongoing speech
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    
    // Try to find a Hindi voice
    const voices = window.speechSynthesis.getVoices();
    const hindiVoice = voices.find(v => v.lang.includes('hi') || v.lang.includes('HI'));
    if (hindiVoice) {
      utterance.voice = hindiVoice;
    }
    
    utterance.lang = "hi-IN";
    utterance.rate = 0.9; // Slightly slower for better clarity in Hindi
    
    utterance.onend = () => {
      setIsSpeaking(false);
      isSpeakingRef.current = false;
      if (isAutoListen) startListening();
    };
    utterance.onerror = () => {
      setIsSpeaking(false);
      isSpeakingRef.current = false;
      if (isAutoListen) startListening();
    };
    window.speechSynthesis.speak(utterance);
  };

  const speak = async (text: string) => {
    // If we know the quota is exhausted, go straight to fallback
    if (Date.now() < quotaExhaustedUntil) {
      addLog("TTS: Using fallback (Quota Mode)");
      speakFallback(text);
      return;
    }

    try {
      isSpeakingRef.current = true;
      setIsSpeaking(true);
      if (recognitionRef.current) recognitionRef.current.stop();

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: `Say in a friendly, helpful tone: ${text}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        const binary = atob(base64Audio);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        playRawPcm(bytes);
      } else {
        addLog("TTS: No audio data, using fallback");
        speakFallback(text);
      }
    } catch (err: any) {
      // Check for quota error (429)
      const isQuotaError = err?.message?.includes("429") || err?.status === 429 || JSON.stringify(err).includes("429");
      
      if (isQuotaError) {
        addLog("TTS: Quota hit, switching to fallback for 5 mins");
        // Set quota exhausted for 5 minutes
        setQuotaExhaustedUntil(Date.now() + 5 * 60 * 1000);
      } else {
        console.error("TTS Error:", err);
        addLog("TTS Error, using fallback");
      }
      
      speakFallback(text);
    }
  };

  const playRawPcm = (bytes: Uint8Array) => {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    const buffer = audioContext.createBuffer(1, bytes.length / 2, 24000);
    const channelData = buffer.getChannelData(0);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < channelData.length; i++) {
      channelData[i] = view.getInt16(i * 2, true) / 32768.0;
    }
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.onended = () => {
      setIsSpeaking(false);
      isSpeakingRef.current = false;
      if (isAutoListen) startListening();
    };
    source.start();
  };

  const handleSendMessage = async (textOverride?: string) => {
    const textToSend = textOverride || message;
    if (!textToSend.trim() || isProcessing) return;

    const lowerText = textToSend.toLowerCase();
    
    if (fullAccessGranted) {
      if (lowerText.includes("facebook")) {
        addLog("Executing: Open Facebook");
        setChat(prev => [...prev, { role: "user", content: textToSend }, { role: "assistant", content: "Opening Facebook for you..." }]);
        speak("Opening Facebook for you...");
        setTimeout(() => window.location.href = "fb://", 1500);
        return;
      }
      if (lowerText.includes("whatsapp")) {
        addLog("Executing: Open WhatsApp");
        setChat(prev => [...prev, { role: "user", content: textToSend }, { role: "assistant", content: "Opening WhatsApp..." }]);
        speak("Opening WhatsApp...");
        setTimeout(() => window.location.href = "whatsapp://", 1500);
        return;
      }
      if (lowerText.includes("setting")) {
        addLog("Executing: Open Settings");
        setChat(prev => [...prev, { role: "user", content: textToSend }, { role: "assistant", content: "Opening System Settings..." }]);
        speak("Opening System Settings...");
        setTimeout(() => window.location.href = "intent://#Intent;action=android.settings.SETTINGS;end", 1500);
        return;
      }
    }

    setError(null);
    const newChat: Message[] = [...chat, { role: "user", content: textToSend }];
    setChat(newChat);
    setMessage("");
    setIsProcessing(true);
    
    if (recognitionRef.current) recognitionRef.current.stop();

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: newChat.map(m => ({
          role: m.role === "user" ? "user" : "model",
          parts: [{ text: m.content }]
        })),
        config: {
          systemInstruction: `You are Khushi AI, a friendly and helpful assistant. You speak Hindi and English. 
          
          CURRENT STATUS: 
          - Full System Access: ${fullAccessGranted ? 'ENABLED' : 'DISABLED'}.
          - Auto Listening Mode: ${isAutoListen ? 'ACTIVE' : 'INACTIVE'}.
          
          NEW CAPABILITY: AI App Builder.
          - If the user asks to "make an app", "create an app", or "app banao", you should generate the full HTML/CSS/JS code for that app.
          - Tell the user you are designing the app and it will appear in the "Projects" tab.
          - DO NOT just give code in chat; tell them to check the Projects tab.
          - Use the function tool 'create_app_project' to save the project.
          
          CRITICAL INSTRUCTION: 
          1. If Full Access is DISABLED and the user asks to control their mobile, respond in Hindi explaining that they need to grant "System Permissions" in the app menu first.
          2. If Full Access is ENABLED and the user asks to open an app (Facebook, WhatsApp, etc.), confirm that you are executing the command.
          3. Since Auto Listening is ${isAutoListen ? 'ACTIVE' : 'INACTIVE'}, you should keep your responses concise to facilitate a smooth voice conversation.
          
          Hindi Disclaimer (if access is disabled):
          "अगर आप चाहते हैं कि मैं आपका मोबाइल कंट्रोल करूँ, तो मुझे System Permissions और API Integration की ज़रूरत होगी। इसका मतलब है कि मुझे आपके ऐप्स, सेटिंग्स और फाइल्स का एक्सेस मिलना चाहिए। कृपया ऊपर दिए गए 'Permissions' बटन पर क्लिक करके एक्सेस ग्रांट करें।"`,
          tools: [{
            functionDeclarations: [{
              name: "create_app_project",
              description: "Creates a new app project with code.",
              parameters: {
                type: Type.OBJECT,
                description: "Parameters for creating an app project.",
                properties: {
                  name: { type: Type.STRING, description: "Name of the app" },
                  code: { type: Type.STRING, description: "Full HTML/CSS/JS code for the app" }
                },
                required: ["name", "code"]
              }
            }]
          }]
        }
      });

      const functionCalls = response.functionCalls;
      if (functionCalls) {
        for (const call of functionCalls) {
          if (call.name === "create_app_project") {
            const { name, code } = call.args as any;
            const newProject: Project = {
              id: Math.random().toString(36).substr(2, 9),
              name,
              code,
              timestamp: new Date().toLocaleString()
            };
            setProjects(prev => [newProject, ...prev]);
            addLog(`Project Created: ${name}`);
            const reply = `मैंने आपके लिए '${name}' ऐप तैयार कर दिया है! आप इसे 'Projects' टैब में देख सकते हैं और डाउनलोड भी कर सकते हैं।`;
            setChat(prev => [...prev, { role: "assistant", content: reply }]);
            speak(reply);
            setActiveTab("projects");
          }
        }
      } else {
        const reply = response.text || "I'm sorry, I couldn't process that.";
        setChat(prev => [...prev, { role: "assistant", content: reply }]);
        speak(reply);
      }
    } catch (err) {
      console.error("Gemini Error:", err);
      setError("Something went wrong. Please try again.");
    } finally {
      setIsProcessing(false);
      // If auto-listen is on and we're not speaking, restart listening
      if (isAutoListen && !isSpeakingRef.current) {
        setTimeout(() => startListening(), 500);
      }
    }
  };

  return (
    <div className="min-h-screen bg-[#0c0c0e] text-white flex flex-col items-center p-4 md:p-8 font-sans overflow-hidden">
      {/* Header */}
      <header className="w-full max-w-4xl flex justify-between items-center mb-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-[#ff6b6b] to-[#ff9f43] flex items-center justify-center shadow-lg shadow-[#ff6b6b33] rotate-3">
            <Sparkles className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-display font-bold tracking-tight">Khushi AI</h1>
            <p className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">Advanced Mobile Assistant</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setIsAutoListen(!isAutoListen)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl border transition-all text-xs font-medium ${
              isAutoListen 
                ? 'bg-blue-500/10 border-blue-500/20 text-blue-400' 
                : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'
            }`}
          >
            <Mic className={`w-4 h-4 ${isAutoListen ? 'animate-pulse' : ''}`} />
            {isAutoListen ? 'Auto Listening' : 'Manual Mode'}
          </button>
          <button 
            onClick={() => setShowPermissions(true)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl border transition-all text-xs font-medium ${
              fullAccessGranted 
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' 
                : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'
            }`}
          >
            {fullAccessGranted ? <ShieldCheck className="w-4 h-4" /> : <Settings className="w-4 h-4" />}
            {fullAccessGranted ? 'Access Active' : 'Permissions'}
          </button>

          {showInstallBtn && (
            <button 
              onClick={handleInstallClick}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#ff6b6b] text-white text-xs font-bold hover:bg-[#ff5252] transition-all shadow-lg shadow-[#ff6b6b33] animate-bounce"
            >
              <Smartphone className="w-4 h-4" />
              Install App
            </button>
          )}
        </div>
      </header>

      <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
        {/* Left Panel: System Status */}
        <aside className="hidden lg:flex flex-col gap-6">
          <div className="glass-card p-6 rounded-3xl border border-white/10">
            <h3 className="text-sm font-display font-bold mb-4 flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-[#ff6b6b]" />
              Device Status
            </h3>
            <div className="space-y-3">
              {[
                { label: "OS Version", value: "Android 14 (Simulated)", color: "text-gray-400" },
                { label: "AI Core", value: "Gemini 3.1 Pro", color: "text-emerald-400" },
                { label: "App Builder", value: "READY", color: "text-emerald-400" },
                { label: "System Access", value: fullAccessGranted ? "GRANTED" : "RESTRICTED", color: fullAccessGranted ? "text-emerald-400" : "text-amber-400" },
              ].map((item, i) => (
                <div key={i} className="flex justify-between items-center text-[11px] font-mono">
                  <span className="text-gray-500">{item.label}</span>
                  <span className={item.color}>{item.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="glass-card p-6 rounded-3xl border border-white/10 flex-1 min-h-0 flex flex-col">
            <h3 className="text-sm font-display font-bold mb-4 flex items-center gap-2">
              <AppWindow className="w-4 h-4 text-[#ff6b6b]" />
              Activity Log
            </h3>
            <div className="flex-1 overflow-y-auto space-y-3 font-mono text-[10px]">
              {systemLogs.length === 0 && <p className="text-gray-600 italic">No recent activity...</p>}
              {systemLogs.map((log, i) => (
                <div key={i} className="p-2 bg-white/5 rounded-lg border border-white/5 text-gray-400 animate-in fade-in slide-in-from-left-2">
                  <span className="text-[#ff6b6b] mr-2">[{new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}]</span>
                  {log}
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* Center: Main Content Area */}
        <main className="lg:col-span-2 flex flex-col min-h-0">
          <div className="flex-1 glass-card rounded-3xl overflow-hidden flex flex-col shadow-2xl relative border border-white/10">
            {/* Tabs */}
            <div className="flex border-b border-white/5">
              <button 
                onClick={() => setActiveTab("chat")}
                className={`flex-1 py-4 flex items-center justify-center gap-2 text-xs font-bold transition-all ${activeTab === "chat" ? "bg-white/5 text-white" : "text-gray-500 hover:text-gray-300"}`}
              >
                <MessageSquare className="w-4 h-4" />
                Assistant Chat
              </button>
              <button 
                onClick={() => setActiveTab("projects")}
                className={`flex-1 py-4 flex items-center justify-center gap-2 text-xs font-bold transition-all relative ${activeTab === "projects" ? "bg-white/5 text-white" : "text-gray-500 hover:text-gray-300"}`}
              >
                <Code className="w-4 h-4" />
                AI Projects
                {projects.length > 0 && (
                  <span className="absolute top-3 right-1/4 w-2 h-2 bg-[#ff6b6b] rounded-full animate-pulse" />
                )}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-hide">
              {activeTab === "chat" ? (
                <>
                  {chat.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-50 py-20">
                      <div className="w-20 h-20 rounded-full bg-white/5 flex items-center justify-center mb-2">
                        <Bot className="w-10 h-10 text-[#ff6b6b]" />
                      </div>
                      <p className="text-xl font-display font-bold">Namaste! I'm Khushi.</p>
                      <p className="text-sm max-w-xs text-gray-400">I can build apps for you. Just say "Calculator app banao" or "Tic Tac Toe app".</p>
                      <div className="flex flex-wrap justify-center gap-2 mt-4">
                        {["Calculator app banao", "Tic Tac Toe app", "Open Facebook"].map((hint, i) => (
                          <button 
                            key={i}
                            onClick={() => handleSendMessage(hint)}
                            className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full text-[10px] font-mono transition-all"
                          >
                            {hint}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  <AnimatePresence initial={false}>
                    {chat.map((msg, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                      >
                        <div className={`flex gap-3 max-w-[85%] ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                          <div className={`w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center shadow-lg ${msg.role === "user" ? "bg-gray-800" : "bg-gradient-to-tr from-[#ff6b6b] to-[#ff9f43]"}`}>
                            {msg.role === "user" ? <User className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
                          </div>
                          <div className={`p-4 rounded-2xl text-sm leading-relaxed shadow-sm ${
                            msg.role === "user" 
                              ? "bg-white/10 text-white rounded-tr-none border border-white/10" 
                              : "bg-white/5 text-gray-200 rounded-tl-none border border-white/5"
                          }`}>
                            {msg.content}
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </>
              ) : (
                <div className="space-y-4">
                  {projects.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-50 py-20">
                      <Code className="w-12 h-12 text-gray-600" />
                      <p className="text-lg font-display font-bold">No Projects Yet</p>
                      <p className="text-xs text-gray-500">Ask Khushi to "make an app" to see it here.</p>
                    </div>
                  ) : (
                    projects.map((project) => (
                      <motion.div 
                        key={project.id}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="p-5 bg-white/5 rounded-3xl border border-white/10 flex items-center justify-between group hover:bg-white/10 transition-all"
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 rounded-2xl bg-[#ff6b6b]/10 flex items-center justify-center">
                            <Code className="w-6 h-6 text-[#ff6b6b]" />
                          </div>
                          <div>
                            <h4 className="font-bold text-sm">{project.name}</h4>
                            <p className="text-[10px] text-gray-500 font-mono">{project.timestamp}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => downloadProject(project)}
                            className="p-3 bg-white/5 hover:bg-white/10 rounded-xl text-emerald-400 transition-all"
                            title="Download Source"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => deleteProject(project.id)}
                            className="p-3 bg-white/5 hover:bg-red-500/20 rounded-xl text-red-500 transition-all"
                            title="Delete Project"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </motion.div>
                    ))
                  )}
                </div>
              )}
              
              {isProcessing && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
                  <div className="flex gap-3 items-center text-gray-500 text-xs font-mono ml-14">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Khushi is working...
                  </div>
                </motion.div>
              )}
              <div ref={chatEndRef} />
            </div>

            {error && (
              <div className="px-6 py-2 bg-red-500/10 text-red-400 text-xs text-center border-t border-red-500/20">
                {error}
              </div>
            )}

            {/* Input Area */}
            <div className="p-6 bg-white/5 border-t border-white/5">
              <div className="relative flex items-center gap-3">
                <input
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
                  className="flex-1 bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-sm focus:outline-none focus:border-[#ff6b6b/50] transition-colors placeholder:text-gray-600"
                  placeholder={activeTab === "chat" ? "Type or speak to Khushi..." : "Switch to Chat to build apps..."}
                  disabled={activeTab === "projects"}
                />
                
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleSendMessage()}
                    disabled={!message.trim() || isProcessing || activeTab === "projects"}
                    className="p-4 bg-white text-black rounded-2xl hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg"
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* Voice Button Floating */}
      <div className="mt-8 flex flex-col items-center gap-4">
        <div className="relative">
          {isListening && (
            <div className="absolute inset-0 rounded-full bg-[#ff6b6b] pulse-ring" />
          )}
          <button
            onClick={startListening}
            disabled={isListening || isProcessing}
            className={`relative z-10 w-24 h-24 rounded-full flex items-center justify-center transition-all shadow-2xl ${
              isListening 
                ? 'bg-[#ff6b6b] scale-110' 
                : 'bg-white text-black hover:scale-105 active:scale-95'
            } disabled:opacity-50`}
          >
            {isListening ? <Loader2 className="w-10 h-10 animate-spin text-white" /> : <Mic className="w-10 h-10" />}
          </button>
        </div>
        <p className="text-[10px] font-mono text-gray-500 uppercase tracking-[0.3em] font-bold">
          {isListening ? 'Listening...' : 'Tap to Speak'}
        </p>
      </div>

      {/* Permissions Modal */}
      <AnimatePresence>
        {showPermissions && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md"
            onClick={() => setShowPermissions(false)}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="glass-card max-w-md w-full p-8 rounded-[40px] border border-white/10 shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="w-16 h-16 rounded-2xl bg-[#ff6b6b]/10 flex items-center justify-center mb-6">
                <ShieldCheck className="w-8 h-8 text-[#ff6b6b]" />
              </div>
              <h2 className="text-2xl font-display font-bold mb-4">System Permissions</h2>
              <p className="text-sm text-gray-400 mb-8 leading-relaxed">
                अगर आप चाहते हैं कि मैं आपका मोबाइल कंट्रोल करूँ, तो मुझे System Permissions और API Integration की ज़रूरत होगी। इसका मतलब है कि मुझे आपके ऐप्स, सेटिंग्स और फाइल्स का एक्सेस मिलना चाहिए।
              </p>
              
              <div className="space-y-4 mb-8">
                {[
                  { icon: <Mic className="w-4 h-4" />, label: "Microphone", status: "Granted", color: "text-emerald-400" },
                  { icon: <Send className="w-4 h-4" />, label: "Messages & Calls", status: fullAccessGranted ? "Granted" : "Restricted", color: fullAccessGranted ? "text-emerald-400" : "text-amber-400" },
                  { icon: <Bot className="w-4 h-4" />, label: "App Control", status: fullAccessGranted ? "Granted" : "Restricted", color: fullAccessGranted ? "text-emerald-400" : "text-amber-400" },
                ].map((item, i) => (
                  <div key={i} className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5">
                    <div className="flex items-center gap-3">
                      <div className="text-gray-400">{item.icon}</div>
                      <span className="text-sm font-medium">{item.label}</span>
                    </div>
                    <span className={`text-[10px] font-mono uppercase tracking-widest font-bold ${item.color}`}>{item.status}</span>
                  </div>
                ))}
              </div>
              
              {!fullAccessGranted ? (
                <button
                  onClick={() => {
                    setFullAccessGranted(true);
                    addLog("System: Full Access Granted");
                    speak("System access granted. I can now control your apps.");
                  }}
                  className="w-full py-5 bg-[#ff6b6b] text-white rounded-3xl font-bold text-sm hover:bg-[#ff5252] transition-all shadow-xl shadow-[#ff6b6b33] mb-3"
                >
                  Grant Full Access
                </button>
              ) : (
                <div className="py-5 bg-emerald-500/10 border border-emerald-500/20 rounded-3xl text-center mb-3">
                  <p className="text-xs text-emerald-400 font-mono uppercase tracking-widest font-bold">System Control Active</p>
                </div>
              )}

              <button
                onClick={() => setShowPermissions(false)}
                className="w-full py-5 bg-white/5 text-white rounded-3xl font-bold text-sm hover:bg-white/10 transition-all"
              >
                Close
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <footer className="mt-auto py-6 text-[9px] font-mono text-gray-700 uppercase tracking-[0.4em]">
        Khushi AI v2.0 • Gemini Intelligence
      </footer>
    </div>
  );
}
