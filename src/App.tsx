/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from "react";
import { GoogleGenAI, Modality } from "@google/genai";
import { Mic, Send, Volume2, VolumeX, Loader2, User, Bot, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

// Initialize Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

interface Message {
  role: "user" | "assistant";
  content: string;
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
  
  const chatEndRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    // Scroll to bottom when chat updates
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat]);

  useEffect(() => {
    // Initialize Speech Recognition
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      recognitionRef.current.lang = "hi-IN"; // Default to Hindi as per user request

      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setMessage(transcript);
        setIsListening(false);
        // Automatically send if transcript is received
        handleSendMessage(transcript);
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error("Speech recognition error", event.error);
        setIsListening(false);
        setError("Could not hear you. Please try again.");
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };
    }
  }, []);

  const startListening = () => {
    if (recognitionRef.current) {
      setError(null);
      setIsListening(true);
      recognitionRef.current.start();
    } else {
      setError("Speech recognition is not supported in this browser.");
    }
  };

  const stopSpeaking = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      setIsSpeaking(false);
    }
  };

  const speak = async (text: string) => {
    try {
      setIsSpeaking(true);
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: `Say in a friendly, helpful tone: ${text}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' }, // Friendly female voice
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
      }
    } catch (err) {
      console.error("TTS Error:", err);
      setIsSpeaking(false);
    }
  };

  const playRawPcm = (bytes: Uint8Array) => {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    const buffer = audioContext.createBuffer(1, bytes.length / 2, 24000);
    const channelData = buffer.getChannelData(0);
    
    // Convert 16-bit PCM to float
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < channelData.length; i++) {
      channelData[i] = view.getInt16(i * 2, true) / 32768.0;
    }
    
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.onended = () => setIsSpeaking(false);
    source.start();
  };

  const handleSendMessage = async (textOverride?: string) => {
    const textToSend = textOverride || message;
    if (!textToSend.trim() || isProcessing) return;

    // Handle Deep Linking Commands locally for faster response
    const lowerText = textToSend.toLowerCase();
    if (fullAccessGranted) {
      if (lowerText.includes("facebook")) {
        setChat(prev => [...prev, { role: "user", content: textToSend }, { role: "assistant", content: "Opening Facebook for you..." }]);
        speak("Opening Facebook for you...");
        setTimeout(() => window.location.href = "fb://", 1500);
        return;
      }
      if (lowerText.includes("whatsapp")) {
        setChat(prev => [...prev, { role: "user", content: textToSend }, { role: "assistant", content: "Opening WhatsApp..." }]);
        speak("Opening WhatsApp...");
        setTimeout(() => window.location.href = "whatsapp://", 1500);
        return;
      }
      if (lowerText.includes("setting")) {
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

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: newChat.map(m => ({
          role: m.role === "user" ? "user" : "model",
          parts: [{ text: m.content }]
        })),
        config: {
          systemInstruction: `You are Khushi AI, a friendly and helpful assistant. You speak Hindi and English. 
          
          CURRENT STATUS: Full System Access is ${fullAccessGranted ? 'ENABLED (Simulated)' : 'DISABLED'}.
          
          CRITICAL INSTRUCTION: 
          1. If Full Access is DISABLED and the user asks to control their mobile, respond in Hindi explaining that they need to grant "System Permissions" in the app menu first.
          2. If Full Access is ENABLED and the user asks to open an app (Facebook, WhatsApp, etc.), confirm that you are executing the command.
          3. Always maintain a helpful, friendly tone.
          
          Hindi Disclaimer (if access is disabled):
          "अगर आप चाहते हैं कि मैं आपका मोबाइल कंट्रोल करूँ, तो मुझे System Permissions और API Integration की ज़रूरत होगी। इसका मतलब है कि मुझे आपके ऐप्स, सेटिंग्स और फाइल्स का एक्सेस मिलना चाहिए। कृपया ऊपर दिए गए 'Permissions' बटन पर क्लिक करके एक्सेस ग्रांट करें।"
          
          Keep other responses concise and conversational, suitable for voice interaction.`,
        }
      });

      const reply = response.text || "I'm sorry, I couldn't process that.";
      setChat(prev => [...prev, { role: "assistant", content: reply }]);
      speak(reply);
    } catch (err) {
      console.error("Gemini Error:", err);
      setError("Something went wrong. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0c0c0e] text-white flex flex-col items-center p-4 md:p-8 font-sans">
      {/* Header */}
      <header className="w-full max-w-2xl flex justify-between items-center mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-[#ff6b6b] to-[#ff9f43] flex items-center justify-center shadow-lg shadow-[#ff6b6b33]">
            <Sparkles className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-display font-bold tracking-tight">Khushi AI</h1>
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setShowPermissions(true)}
            className="text-[10px] font-mono text-gray-400 uppercase tracking-widest hover:text-white transition-colors border border-white/10 px-3 py-1 rounded-full"
          >
            Permissions
          </button>
          <div className="flex items-center gap-2 text-xs font-mono text-gray-500 uppercase tracking-widest">
            <div className={`w-2 h-2 rounded-full ${isProcessing ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`} />
            {isProcessing ? 'Processing' : 'Ready'}
          </div>
        </div>
      </header>

      {/* Permissions Modal */}
      <AnimatePresence>
        {showPermissions && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
            onClick={() => setShowPermissions(false)}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="glass-card max-w-md w-full p-8 rounded-3xl border border-white/10"
              onClick={e => e.stopPropagation()}
            >
              <h2 className="text-xl font-display font-bold mb-4 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-[#ff6b6b]" />
                System Permissions
              </h2>
              <p className="text-sm text-gray-400 mb-6 leading-relaxed">
                अगर आप चाहते हैं कि मैं आपका मोबाइल कंट्रोल करूँ, तो मुझे System Permissions और API Integration की ज़रूरत होगी।
              </p>
              <div className="space-y-4">
                {[
                  { icon: <Mic className="w-4 h-4" />, label: "Microphone", status: "Granted", color: "text-emerald-400" },
                  { icon: <Send className="w-4 h-4" />, label: "Messages & Calls", status: fullAccessGranted ? "Granted" : "Restricted", color: fullAccessGranted ? "text-emerald-400" : "text-amber-400" },
                  { icon: <Bot className="w-4 h-4" />, label: "App Control", status: fullAccessGranted ? "Granted" : "Restricted", color: fullAccessGranted ? "text-emerald-400" : "text-amber-400" },
                ].map((item, i) => (
                  <div key={i} className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5">
                    <div className="flex items-center gap-3">
                      <div className="text-gray-400">{item.icon}</div>
                      <span className="text-sm font-medium">{item.label}</span>
                    </div>
                    <span className={`text-[10px] font-mono uppercase tracking-widest ${item.color}`}>{item.status}</span>
                  </div>
                ))}
              </div>
              
              {!fullAccessGranted ? (
                <button
                  onClick={() => {
                    setFullAccessGranted(true);
                    speak("System access granted. I can now open apps for you.");
                  }}
                  className="w-full mt-8 py-4 bg-[#ff6b6b] text-white rounded-2xl font-bold text-sm hover:bg-[#ff5252] transition-all shadow-lg shadow-[#ff6b6b33]"
                >
                  Grant Full Access
                </button>
              ) : (
                <div className="mt-8 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-center">
                  <p className="text-xs text-emerald-400 font-mono uppercase tracking-widest">System Control Active</p>
                </div>
              )}

              <button
                onClick={() => setShowPermissions(false)}
                className="w-full mt-3 py-4 bg-white/5 text-white rounded-2xl font-bold text-sm hover:bg-white/10 transition-all"
              >
                Close
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Chat Area */}
      <main className="flex-1 w-full max-w-2xl glass-card rounded-3xl overflow-hidden flex flex-col shadow-2xl relative">
        <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-hide">
          {chat.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-50 py-20">
              <Bot className="w-16 h-16 mb-2" />
              <p className="text-lg font-display">Namaste! I'm Khushi.</p>
              <p className="text-sm max-w-xs">Try saying "Hello" or "Kaise ho?"</p>
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
                  <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center ${msg.role === "user" ? "bg-gray-800" : "bg-[#ff6b6b]"}`}>
                    {msg.role === "user" ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                  </div>
                  <div className={`p-4 rounded-2xl text-sm leading-relaxed ${
                    msg.role === "user" 
                      ? "bg-white/10 text-white rounded-tr-none" 
                      : "bg-white/5 text-gray-200 rounded-tl-none border border-white/5"
                  }`}>
                    {msg.content}
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          
          {isProcessing && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex justify-start"
            >
              <div className="flex gap-3 items-center text-gray-500 text-xs font-mono">
                <Loader2 className="w-4 h-4 animate-spin" />
                Thinking...
              </div>
            </motion.div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Error Message */}
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
              placeholder="Type your message..."
            />
            
            <div className="flex items-center gap-2">
              <button
                onClick={isSpeaking ? stopSpeaking : () => {}}
                className={`p-3 rounded-xl transition-all ${isSpeaking ? 'bg-[#ff6b6b] text-white' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}
                title={isSpeaking ? "Stop speaking" : "Voice output"}
              >
                {isSpeaking ? <Volume2 className="w-5 h-5 animate-pulse" /> : <VolumeX className="w-5 h-5" />}
              </button>

              <button
                onClick={() => handleSendMessage()}
                disabled={!message.trim() || isProcessing}
                className="p-3 bg-white text-black rounded-xl hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Voice Button Floating */}
      <div className="mt-8 flex flex-col items-center gap-4">
        <div className="relative">
          {isListening && (
            <div className="absolute inset-0 rounded-full bg-[#ff6b6b] pulse-ring" />
          )}
          <button
            onClick={startListening}
            disabled={isListening || isProcessing}
            className={`relative z-10 w-20 h-20 rounded-full flex items-center justify-center transition-all shadow-xl ${
              isListening 
                ? 'bg-[#ff6b6b] scale-110' 
                : 'bg-white text-black hover:scale-105 active:scale-95'
            } disabled:opacity-50`}
          >
            {isListening ? <Loader2 className="w-8 h-8 animate-spin text-white" /> : <Mic className="w-8 h-8" />}
          </button>
        </div>
        <p className="text-xs font-mono text-gray-500 uppercase tracking-[0.2em]">
          {isListening ? 'Listening...' : 'Tap to speak'}
        </p>
      </div>

      {/* Footer */}
      <footer className="mt-auto py-8 text-[10px] font-mono text-gray-600 uppercase tracking-widest">
        Powered by Gemini 3.1 & 2.5 TTS
      </footer>
    </div>
  );
}
