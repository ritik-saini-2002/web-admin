/**
 * AIControl.jsx — AI Command Control Page
 * Connects to Ollama (agent-v12 / llama3b-fast / tinyllama) on the CentOS server.
 * Sends natural language → gets JSON plan → executes on selected PC via agent_v12.py
 *
 * Place this file at:  src/ai/AIControl.jsx
 * CSS already handled by:  AIcontrol.css  (import it in this file or in index.css)
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { usePcControl } from '../context/PcControlContext';
import { executePlan, ping } from '../api/pcControlApi';
import './AIcontrol.css';

// ── CONFIG ─────────────────────────────────────────────────────────────────
// Ollama URL — uses same origin host so HTTP/HTTPS matches the page protocol
const OLLAMA_PORT = '5004';
const OLLAMA_URL  = `${window.location.protocol}//${window.location.hostname}:${OLLAMA_PORT}`;

// Available models on your server
const MODELS = [
    { id: 'agent-v12',    label: 'agent-v12',    desc: 'Best for automation',   speed: '~6 t/s'  },
    { id: 'llama3b-fast', label: 'llama3b-fast', desc: 'Balanced',              speed: '~6 t/s'  },
    { id: 'tinyllama',    label: 'tinyllama',    desc: 'Fastest, simple tasks',  speed: '~15 t/s' },
];

// Quick action presets
const QUICK_ACTIONS = [
    { icon: '🔒', label: 'Lock PC',       prompt: 'lock the computer'              },
    { icon: '📸', label: 'Screenshot',    prompt: 'take a screenshot'              },
    { icon: '🔊', label: 'Volume Up',     prompt: 'increase volume by 20 percent'  },
    { icon: '🔇', label: 'Mute',          prompt: 'mute the volume'                },
    { icon: '🌐', label: 'Open Chrome',   prompt: 'open google chrome browser'     },
    { icon: '📁', label: 'File Explorer', prompt: 'open file explorer'             },
    { icon: '⚙️', label: 'Task Manager',  prompt: 'open task manager'              },
    { icon: '😴', label: 'Sleep',         prompt: 'put computer to sleep'          },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function getTimestamp() {
    return new Date().toLocaleTimeString('en-US', { hour12: false });
}

function parseJsonSafe(text) {
    if (!text) return null;
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    try { return JSON.parse(cleaned); } catch { return null; }
}

async function askOllama(promptText, modelId, signal) {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ model: modelId, prompt: promptText, keep_alive: -1, stream: false }),
        signal,
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const data = await res.json();
    return data.response || '';
}

async function checkOllamaHealth() {
    try {
        const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
        if (!res.ok) return false;
        const data = await res.json();
        return Array.isArray(data.models);
    } catch { return false; }
}

// ── Component ────────────────────────────────────────────────────────────────

export default function AIControl() {
    const { selectedPc, settings, connected } = usePcControl();
    const secretKey = settings?.secretKey ?? '';
    const pcUrl     = selectedPc ? `http://${selectedPc.ip}:${selectedPc.command_port}` : '';

    // AI state
    const [model,         setModel]         = useState('agent-v12');
    const [modelDropOpen, setModelDropOpen]  = useState(false);
    const [ollamaOnline,  setOllamaOnline]   = useState(null);
    const [pcOnline,      setPcOnline]       = useState(null);

    // Chat state
    const [messages,  setMessages]  = useState([
        { role: 'ai', text: "Hi! Tell me what to do on your PC and I'll build and run the automation plan." },
    ]);
    const [input,     setInput]     = useState('');
    const [thinking,  setThinking]  = useState(false);

    // Plan state
    const [plan,       setPlan]       = useState(null);
    const [planStatus, setPlanStatus] = useState([]);
    const [running,    setRunning]    = useState(false);

    // Log state
    const [logs, setLogs] = useState([]);

    const chatEndRef = useRef(null);
    const inputRef   = useRef(null);
    const abortRef   = useRef(null);

    // ── Scroll chat to bottom ───────────────────────────────────────────
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, thinking]);

    // ── Health checks ───────────────────────────────────────────────────
    useEffect(() => {
        checkOllamaHealth().then(ok => setOllamaOnline(ok)).catch(() => setOllamaOnline(false));
    }, []);

    useEffect(() => {
        if (!pcUrl || !secretKey) { setPcOnline(null); return; }
        ping(pcUrl, secretKey).then(r => setPcOnline(r.ok)).catch(() => setPcOnline(false));
    }, [pcUrl, secretKey]);

    // ── Helpers ─────────────────────────────────────────────────────────
    const addLog = useCallback((type, text) => {
        setLogs(prev => [...prev.slice(-49), { type, text, time: getTimestamp() }]);
    }, []);

    const addMsg = useCallback((role, text) => {
        setMessages(prev => [...prev, { role, text }]);
    }, []);

    // ── Send prompt to AI ────────────────────────────────────────────────
    const sendPrompt = useCallback((promptText) => {
        if (!promptText.trim() || thinking || running) return;

        abortRef.current?.abort();
        const ctrl = new AbortController();
        abortRef.current = ctrl;

        addMsg('user', promptText);
        setInput('');
        setThinking(true);
        setPlan(null);
        setPlanStatus([]);
        addLog('info', `Sending to ${model}: "${promptText.substring(0, 60)}…"`);

        askOllama(promptText, model, ctrl.signal)
            .then(rawResponse => {
                addLog('info', `AI responded (${rawResponse.length} chars)`);
                setThinking(false);
                const parsed = parseJsonSafe(rawResponse);
                if (parsed?.steps && Array.isArray(parsed.steps)) {
                    setPlan(parsed);
                    setPlanStatus(parsed.steps.map(() => 'wait'));
                    addMsg('ai', `✅ Plan ready: "${parsed.planName || 'Unnamed'}" — ${parsed.steps.length} step(s). Click Run to execute.`);
                    addLog('ok', `Plan parsed: ${parsed.steps.length} steps`);
                } else {
                    addMsg('ai', rawResponse || '(empty response)');
                    addLog('warn', 'Response was not a valid JSON plan');
                }
            })
            .catch(e => {
                if (e.name === 'AbortError') { setThinking(false); return; }
                addMsg('ai', `⚠️ AI error: ${e.message}`);
                addLog('err', `AI request failed: ${e.message}`);
                setThinking(false);
            });
    }, [thinking, running, model, addMsg, addLog]);

    // ── Execute plan on PC ───────────────────────────────────────────────
    const runPlan = useCallback(() => {
        if (!plan || running) return;
        if (!pcUrl) { addMsg('ai', '⚠️ No PC connected. Go to Remote Control and connect first.'); return; }
        if (!secretKey) { addMsg('ai', '⚠️ No secret key configured.'); return; }

        setRunning(true);
        addLog('info', `Executing plan: "${plan.planName}" on ${selectedPc?.pc_name || pcUrl}`);

        // Optimistic step animation
        const animateSteps = async () => {
            for (let i = 0; i < plan.steps.length; i++) {
                setPlanStatus(prev => prev.map((s, idx) => idx === i ? 'run' : s));
                await new Promise(r => setTimeout(r, 120)); // eslint-disable-line no-await-in-loop
            }
        };

        animateSteps()
            .then(() => executePlan(pcUrl, secretKey, plan.planName, plan.steps))
            .then(res => {
                if (res.ok) {
                    const results  = res.data?.results || [];
                    const newStatus = plan.steps.map((_, i) => (results[i]?.status === 'ERROR' ? 'err' : 'ok'));
                    setPlanStatus(newStatus);
                    const errors = results.filter(r => r?.status === 'ERROR').length;
                    if (errors > 0) {
                        addMsg('ai', `⚠️ Plan completed with ${errors} error(s).`);
                        addLog('warn', `Plan done — ${errors} error(s)`);
                    } else {
                        addMsg('ai', `✅ Plan executed — ${plan.steps.length} step(s) completed.`);
                        addLog('ok', `Plan done — all ${plan.steps.length} steps OK`);
                    }
                } else {
                    setPlanStatus(plan.steps.map(() => 'err'));
                    addMsg('ai', `❌ Execution failed: ${res.error || res.data?.error || 'Unknown error'}`);
                    addLog('err', `Execution failed: ${res.error}`);
                }
            })
            .catch(e => {
                setPlanStatus(plan.steps.map(() => 'err'));
                addMsg('ai', `❌ Network error: ${e.message}`);
                addLog('err', `Network error: ${e.message}`);
            })
            .finally(() => setRunning(false));
    }, [plan, running, pcUrl, secretKey, selectedPc, addMsg, addLog]);

    // ── Keyboard submit ──────────────────────────────────────────────────
    const onKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendPrompt(input); }
    };

    // ── Status pill ──────────────────────────────────────────────────────
    const statusPill = (online, label) => {
        if (online === null) return <span className="ai-status-pill ai-pill-dim">⏳ {label}</span>;
        if (online)          return <span className="ai-status-pill ai-pill-green">● {label}</span>;
        return                      <span className="ai-status-pill ai-pill-red">● {label} Offline</span>;
    };

    // ── Step badge ───────────────────────────────────────────────────────
    const stepBadge = (status, type) => {
        const cls  = { wait: 'ai-badge-wait', run: 'ai-badge-run', ok: 'ai-badge-ok', err: 'ai-badge-err' }[status] || 'ai-badge-wait';
        const icon = { wait: '○', run: '⟳', ok: '✓', err: '✗' }[status] || '○';
        return <span className={`ai-step-badge ${cls}`}>{icon} {type}</span>;
    };

    return (
        <div className="ai-control-page">

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <div>
                    <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>🤖 AI PC Control</h2>
                    <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
                        Natural language → automation plan → executed on your PC
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    {statusPill(ollamaOnline, `Ollama ${model}`)}
                    {statusPill(pcOnline, selectedPc?.pc_name || (connected ? 'PC Connected' : 'No PC Connected'))}
                </div>
            </div>

            {/* Main grid */}
            <div className="ai-grid">

                {/* LEFT */}
                <div className="ai-left">

                    {/* Model selector */}
                    <div className="card" style={{ position: 'relative' }}>
                        <div className="card-label">🧠 AI Model</div>
                        <button
                            className="q-btn"
                            style={{ width: '100%', justifyContent: 'space-between' }}
                            onClick={() => setModelDropOpen(o => !o)}
                        >
                            <span>{model}</span>
                            <span style={{ fontSize: '0.65rem', opacity: 0.6 }}>{MODELS.find(m => m.id === model)?.speed}</span>
                            <span>{modelDropOpen ? '▲' : '▼'}</span>
                        </button>
                        {modelDropOpen && (
                            <div className="ai-model-dropdown">
                                {MODELS.map(m => (
                                    <div
                                        key={m.id}
                                        className={`ai-model-item ${m.id === model ? 'active' : ''}`}
                                        onClick={() => { setModel(m.id); setModelDropOpen(false); addLog('info', `Switched to model: ${m.id}`); }}
                                    >
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <span>{m.label}</span>
                                            <span style={{ fontSize: '0.65rem', opacity: 0.55 }}>{m.speed}</span>
                                        </div>
                                        <div style={{ fontSize: '0.68rem', opacity: 0.55, marginTop: 1 }}>{m.desc}</div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Quick actions */}
                    <div className="card">
                        <div className="card-label">⚡ Quick Actions</div>
                        <div className="ai-quick-grid">
                            {QUICK_ACTIONS.map(qa => (
                                <button
                                    key={qa.label}
                                    className="ai-qa-btn"
                                    disabled={thinking || running}
                                    onClick={() => sendPrompt(qa.prompt)}
                                    title={qa.prompt}
                                >
                                    <span style={{ fontSize: '1.3rem' }}>{qa.icon}</span>
                                    <span>{qa.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Plan card */}
                    {plan && (
                        <div className="card">
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                                <div className="card-label" style={{ margin: 0 }}>📋 {plan.planName || 'Plan'}</div>
                                <button
                                    className="btn btn-primary"
                                    style={{ fontSize: '0.75rem', padding: '4px 14px' }}
                                    disabled={running || !pcUrl}
                                    onClick={runPlan}
                                >
                                    {running
                                        ? <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span className="spin" style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid rgba(255,255,255,.3)', borderTopColor: '#fff', borderRadius: '50%' }} />
                        Running…
                      </span>
                                        : '▶ Run'}
                                </button>
                            </div>
                            <div className="ai-plan-steps">
                                {plan.steps.map((step, i) => (
                                    // eslint-disable-next-line react/no-array-index-key
                                    <div key={i} className="ai-plan-step">
                                        {stepBadge(planStatus[i] || 'wait', step.type)}
                                        <span className="ai-step-text">
                      {step.value || step.action || JSON.stringify(step).substring(0, 60)}
                    </span>
                                    </div>
                                ))}
                            </div>
                            {!pcUrl && (
                                <p style={{ fontSize: '0.72rem', color: 'var(--accent-amber,#fbbf24)', marginTop: 8, marginBottom: 0 }}>
                                    ⚠️ Connect a PC from the Remote Control page first.
                                </p>
                            )}
                        </div>
                    )}

                    {/* Log */}
                    <div className="card">
                        <div className="card-label">📟 Log</div>
                        <div className="ai-log-lines">
                            {logs.length === 0 && (
                                <span style={{ color: 'var(--text-tertiary)', fontSize: '0.72rem' }}>No activity yet.</span>
                            )}
                            {logs.map((l, i) => (
                                // eslint-disable-next-line react/no-array-index-key
                                <div key={i} className="ai-log-line">
                                    <span className="ai-log-ts">{l.time}</span>
                                    <span className={`ai-log-${l.type}`}>{l.text}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                </div>

                {/* RIGHT — Chat */}
                <div className="ai-right">
                    <div className="card ai-chat-card" style={{ flex: 1 }}>
                        <div className="card-label">💬 Chat</div>

                        <div className="ai-chat-history">
                            {messages.map((m, i) => (
                                // eslint-disable-next-line react/no-array-index-key
                                <div key={i} className={`ai-msg ai-msg-${m.role}`}>{m.text}</div>
                            ))}
                            {thinking && (
                                <div className="ai-msg ai-msg-ai ai-thinking">
                                    <span className="spin" style={{ display: 'inline-block', width: 13, height: 13, border: '2px solid rgba(167,139,250,.3)', borderTopColor: '#a78bfa', borderRadius: '50%' }} />
                                    <span style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>{model} is thinking…</span>
                                </div>
                            )}
                            <div ref={chatEndRef} />
                        </div>

                        {/* Suggestion chips */}
                        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
                            {[
                                'Open Chrome and go to youtube.com',
                                'Set volume to 60%',
                                'Take a screenshot and open Downloads',
                                'Open notepad and type Hello World',
                            ].map(s => (
                                <button key={s} className="q-btn" style={{ fontSize: '0.68rem' }} disabled={thinking || running} onClick={() => sendPrompt(s)}>
                                    {s}
                                </button>
                            ))}
                        </div>

                        <div className="ai-chat-input-row">
              <textarea
                  ref={inputRef}
                  className="ai-chat-input"
                  placeholder={thinking ? 'AI is thinking…' : 'Tell the AI what to do on your PC…'}
                  rows={2}
                  value={input}
                  disabled={thinking || running}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
              />
                            <button
                                className="btn btn-primary"
                                style={{ padding: '8px 16px', alignSelf: 'stretch' }}
                                disabled={!input.trim() || thinking || running}
                                onClick={() => sendPrompt(input)}
                            >
                                {thinking
                                    ? <span className="spin" style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid rgba(255,255,255,.3)', borderTopColor: '#fff', borderRadius: '50%' }} />
                                    : '↑'}
                            </button>
                        </div>

                        <div style={{ marginTop: 6, fontSize: '0.68rem', color: 'var(--text-tertiary)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                            <span>Enter to send · Shift+Enter for newline</span>
                            <span>Model: <strong style={{ color: 'var(--accent-purple,#a78bfa)' }}>{model}</strong></span>
                            <span>Server: <strong style={{ color: 'var(--text-secondary)' }}>{window.location.hostname}:{OLLAMA_PORT}</strong></span>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
}


// // Available models on your server
// // const MODELS = [
// //     { id: 'agent-v12',    label: 'agent-v12',    desc: 'Best for automation',  speed: '~6 t/s' },
// //     { id: 'llama3b-fast', label: 'llama3b-fast', desc: 'Balanced',             speed: '~6 t/s' },
// //     { id: 'tinyllama',    label: 'tinyllama',    desc: 'Fastest, simple tasks', speed: '~15 t/s' },
// // ];
//
// // Quick action presets
// // const QUICK_ACTIONS = [
// //     { icon: '🔒', label: 'Lock PC',      prompt: 'lock the computer' },
// //     { icon: '📸', label: 'Screenshot',   prompt: 'take a screenshot' },
// //     { icon: '🔊', label: 'Volume Up',    prompt: 'increase volume by 20 percent' },
// //     { icon: '🔇', label: 'Mute',         prompt: 'mute the volume' },
// //     { icon: '🌐', label: 'Open Chrome',  prompt: 'open google chrome browser' },
// //     { icon: '📁', label: 'File Explorer',prompt: 'open file explorer' },
// //     { icon: '⚙️', label: 'Task Manager', prompt: 'open task manager' },
// //     { icon: '😴', label: 'Sleep',        prompt: 'put computer to sleep' },
// // ];
//
// // ── Helpers ─────────────────────────────────────────────────────────────────
//
// function ts() {
//     return new Date().toLocaleTimeString('en-US', { hour12: false });
// }
//
// // function parseJsonSafe(text) {
// //     if (!text) return null;
// //     // Strip markdown code fences if model wrapped output
// //     const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
// //     try { return JSON.parse(cleaned); } catch { return null; }
// // }
//
// // async function askOllama(prompt, model, signal) {
// //     const res = await fetch(`${OLLAMA_URL}/api/generate`, {
// //         method:  'POST',
// //         headers: { 'Content-Type': 'application/json' },
// //         body:    JSON.stringify({ model, prompt, keep_alive: -1, stream: false }),
// //         signal,
// //     });
// //     if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
// //     const data = await res.json();
// //     return data.response || '';
// // }
//
// // async function checkOllamaHealth() {
// //     try {
// //         const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
// //         if (!res.ok) return false;
// //         const data = await res.json();
// //         return Array.isArray(data.models);
// //     } catch { return false; }
// // }
//
// // ── Component ────────────────────────────────────────────────────────────────
//
// export default function Aicontrol() {
//     const { selectedPc, baseUrl: pcBaseUrl, settings, connected } = usePcControl();
//     // selectedPc.ip + command_port → build URL; secretKey lives in settings
//     const secretKey = settings?.secretKey ?? '';
//     const pcUrl     = selectedPc ? `http://${selectedPc.ip}:${selectedPc.command_port}` : '';
//
//     // AI state
//     const [model,        setModel]        = useState('agent-v12');
//     const [modelDropOpen,setModelDropOpen] = useState(false);
//     const [ollamaOnline, setOllamaOnline]  = useState(null); // null=checking, true, false
//     const [pcOnline,     setPcOnline]      = useState(null);
//
//     // Chat state
//     const [messages,   setMessages]   = useState([
//         { role: 'ai', text: 'Hi! Tell me what to do on your PC and I\'ll build and run the automation plan.' },
//     ]);
//     const [input,      setInput]      = useState('');
//     const [thinking,   setThinking]   = useState(false);
//
//     // Plan state
//     const [plan,       setPlan]       = useState(null);   // { planName, steps: [] }
//     const [planStatus, setPlanStatus] = useState([]);      // per-step: 'wait'|'run'|'ok'|'err'
//     const [running,    setRunning]    = useState(false);
//
//     // Log state
//     const [logs,       setLogs]       = useState([]);
//
//     const chatEndRef  = useRef(null);
//     const inputRef    = useRef(null);
//     const abortRef    = useRef(null);
//
//     // ── Scroll chat to bottom ───────────────────────────────────────────
//     useEffect(() => {
//         chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
//     }, [messages, thinking]);
//
//     // ── Health checks on mount ──────────────────────────────────────────
//     useEffect(() => {
//         checkOllamaHealth().then(ok => setOllamaOnline(ok));
//     }, []);
//
//     useEffect(() => {
//         if (!pcUrl || !secretKey) { setPcOnline(null); return; }
//         ping(pcUrl, secretKey).then(r => setPcOnline(r.ok));
//     }, [pcUrl, secretKey]);
//
//     // ── Log helper ──────────────────────────────────────────────────────
//     const addLog = useCallback((type, text) => {
//         setLogs(prev => [...prev.slice(-49), { type, text, ts: ts() }]);
//     }, []);
//
//     // ── Add chat message ────────────────────────────────────────────────
//     const addMsg = useCallback((role, text) => {
//         setMessages(prev => [...prev, { role, text }]);
//     }, []);
//
//     // ── Core: send prompt to AI ─────────────────────────────────────────
//     const sendPrompt = useCallback(async (promptText) => {
//         if (!promptText.trim() || thinking || running) return;
//
//         // Cancel any previous request
//         abortRef.current?.abort();
//         const ctrl = new AbortController();
//         abortRef.current = ctrl;
//
//         addMsg('user', promptText);
//         setInput('');
//         setThinking(true);
//         setPlan(null);
//         setPlanStatus([]);
//         addLog('info', `Sending to ${model}: "${promptText.substring(0, 60)}..."`);
//
//         let rawResponse = '';
//         try {
//             rawResponse = await askOllama(promptText, model, ctrl.signal);
//             addLog('info', `AI responded (${rawResponse.length} chars)`);
//         } catch (e) {
//             if (e.name === 'AbortError') { setThinking(false); return; }
//             addMsg('ai', `⚠️ AI error: ${e.message}`);
//             addLog('err', `AI request failed: ${e.message}`);
//             setThinking(false);
//             return;
//         }
//
//         setThinking(false);
//
//         // Try to parse as a plan
//         const parsed = parseJsonSafe(rawResponse);
//
//         if (parsed && parsed.steps && Array.isArray(parsed.steps)) {
//             // Valid plan — show it
//             setPlan(parsed);
//             setPlanStatus(parsed.steps.map(() => 'wait'));
//             addMsg('ai', `✅ Plan ready: "${parsed.planName || 'Unnamed'}" — ${parsed.steps.length} step(s). Click Run to execute.`);
//             addLog('ok', `Plan parsed: ${parsed.steps.length} steps`);
//         } else {
//             // Not a plan — show as text response
//             addMsg('ai', rawResponse || '(empty response)');
//             addLog('warn', 'Response was not a valid JSON plan');
//         }
//     }, [thinking, running, model, addMsg, addLog]);
//
//     // ── Execute plan on PC ──────────────────────────────────────────────
//     const runPlan = useCallback(async () => {
//         if (!plan || running) return;
//         if (!pcUrl) {
//             addMsg('ai', '⚠️ No PC connected. Go to Remote Control and connect first.');
//             return;
//         }
//         if (!secretKey) {
//             addMsg('ai', '⚠️ No secret key set for this PC.');
//             return;
//         }
//
//         setRunning(true);
//         addLog('info', `Executing plan: "${plan.planName}" on ${selectedPc?.pc_name || pcUrl}`);
//
//         // Animate steps one by one (optimistic)
//         for (let i = 0; i < plan.steps.length; i++) {
//             setPlanStatus(prev => prev.map((s, idx) => idx === i ? 'run' : s));
//             await new Promise(r => setTimeout(r, 120)); // brief visual delay
//         }
//
//         try {
//             const res = await executePlan(pcUrl, secretKey, plan.planName, plan.steps);
//             if (res.ok) {
//                 const results = res.data?.results || [];
//                 const newStatus = plan.steps.map((_, i) => {
//                     const r = results[i];
//                     if (!r) return 'ok';
//                     return r.status === 'ERROR' ? 'err' : 'ok';
//                 });
//                 setPlanStatus(newStatus);
//                 const errors = results.filter(r => r?.status === 'ERROR').length;
//                 if (errors > 0) {
//                     addMsg('ai', `⚠️ Plan completed with ${errors} error(s). Check step details.`);
//                     addLog('warn', `Plan done — ${errors} error(s)`);
//                 } else {
//                     addMsg('ai', `✅ Plan executed successfully — ${plan.steps.length} step(s) completed.`);
//                     addLog('ok', `Plan done — all ${plan.steps.length} steps OK`);
//                 }
//             } else {
//                 setPlanStatus(plan.steps.map(() => 'err'));
//                 addMsg('ai', `❌ Execution failed: ${res.error || res.data?.error || 'Unknown error'}`);
//                 addLog('err', `Execution failed: ${res.error}`);
//             }
//         } catch (e) {
//             setPlanStatus(plan.steps.map(() => 'err'));
//             addMsg('ai', `❌ Network error: ${e.message}`);
//             addLog('err', `Network error: ${e.message}`);
//         } finally {
//             setRunning(false);
//         }
//     }, [plan, running, pcUrl, secretKey, selectedPc, addMsg, addLog]);
//
//     // ── Keyboard submit ─────────────────────────────────────────────────
//     const onKeyDown = (e) => {
//         if (e.key === 'Enter' && !e.shiftKey) {
//             e.preventDefault();
//             sendPrompt(input);
//         }
//     };
//
//     // ── Status pill helper ──────────────────────────────────────────────
//     const statusPill = (online, label) => {
//         if (online === null) return <span className="ai-status-pill ai-pill-dim">⏳ {label}</span>;
//         if (online)          return <span className="ai-status-pill ai-pill-green">● {label}</span>;
//         return                      <span className="ai-status-pill ai-pill-red">● {label} Offline</span>;
//     };
//
//     // ── Step badge ──────────────────────────────────────────────────────
//     const stepBadge = (status, type) => {
//         const cls = { wait: 'ai-badge-wait', run: 'ai-badge-run', ok: 'ai-badge-ok', err: 'ai-badge-err' }[status] || 'ai-badge-wait';
//         const icon = { wait: '○', run: '⟳', ok: '✓', err: '✗' }[status] || '○';
//         return <span className={`ai-step-badge ${cls}`}>{icon} {type}</span>;
//     };
//
//     return (
//         <div className="ai-control-page">
//
//             {/* ── Header row ─────────────────────────────────────────────── */}
//             <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
//                 <div>
//                     <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>🤖 AI PC Control</h2>
//                     <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
//                         Natural language → automation plan → executed on your PC
//                     </p>
//                 </div>
//                 <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
//                     {statusPill(ollamaOnline, `Ollama ${model}`)}
//                     {statusPill(pcOnline, selectedPc?.pc_name || (connected ? 'PC Connected' : 'No PC Connected'))}
//                 </div>
//             </div>
//
//             {/* ── Main grid ──────────────────────────────────────────────── */}
//             <div className="ai-grid">
//
//                 {/* LEFT column */}
//                 <div className="ai-left">
//
//                     {/* Model selector */}
//                     <div className="card" style={{ position: 'relative' }}>
//                         <div className="card-label">🧠 AI Model</div>
//                         <button
//                             className="q-btn"
//                             style={{ width: '100%', justifyContent: 'space-between' }}
//                             onClick={() => setModelDropOpen(o => !o)}
//                         >
//                             <span>{model}</span>
//                             <span style={{ fontSize: '0.65rem', opacity: 0.6 }}>
//                 {MODELS.find(m => m.id === model)?.speed}
//               </span>
//                             <span>{modelDropOpen ? '▲' : '▼'}</span>
//                         </button>
//                         {modelDropOpen && (
//                             <div className="ai-model-dropdown">
//                                 {MODELS.map(m => (
//                                     <div
//                                         key={m.id}
//                                         className={`ai-model-item ${m.id === model ? 'active' : ''}`}
//                                         onClick={() => { setModel(m.id); setModelDropOpen(false); addLog('info', `Switched to model: ${m.id}`); }}
//                                     >
//                                         <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
//                                             <span>{m.label}</span>
//                                             <span style={{ fontSize: '0.65rem', opacity: 0.55 }}>{m.speed}</span>
//                                         </div>
//                                         <div style={{ fontSize: '0.68rem', opacity: 0.55, marginTop: 1 }}>{m.desc}</div>
//                                     </div>
//                                 ))}
//                             </div>
//                         )}
//                     </div>
//
//                     {/* Quick actions */}
//                     <div className="card">
//                         <div className="card-label">⚡ Quick Actions</div>
//                         <div className="ai-quick-grid">
//                             {QUICK_ACTIONS.map(qa => (
//                                 <button
//                                     key={qa.label}
//                                     className="ai-qa-btn"
//                                     disabled={thinking || running}
//                                     onClick={() => sendPrompt(qa.prompt)}
//                                     title={qa.prompt}
//                                 >
//                                     <span style={{ fontSize: '1.3rem' }}>{qa.icon}</span>
//                                     <span>{qa.label}</span>
//                                 </button>
//                             ))}
//                         </div>
//                     </div>
//
//                     {/* Plan card */}
//                     {plan && (
//                         <div className="card">
//                             <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
//                                 <div className="card-label" style={{ margin: 0 }}>📋 {plan.planName || 'Plan'}</div>
//                                 <button
//                                     className="btn btn-primary"
//                                     style={{ fontSize: '0.75rem', padding: '4px 14px' }}
//                                     disabled={running || !pcUrl}
//                                     onClick={runPlan}
//                                 >
//                                     {running ? (
//                                         <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
//                       <span className="spin" style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid rgba(255,255,255,.3)', borderTopColor: '#fff', borderRadius: '50%' }} />
//                       Running…
//                     </span>
//                                     ) : '▶ Run'}
//                                 </button>
//                             </div>
//                             <div className="ai-plan-steps">
//                                 {plan.steps.map((step, i) => (
//                                     <div key={i} className="ai-plan-step">
//                                         {stepBadge(planStatus[i] || 'wait', step.type)}
//                                         <span className="ai-step-text">
//                       {step.value || step.action || JSON.stringify(step).substring(0, 60)}
//                     </span>
//                                     </div>
//                                 ))}
//                             </div>
//                             {!pcUrl && (
//                                 <p style={{ fontSize: '0.72rem', color: 'var(--accent-amber,#fbbf24)', marginTop: 8, marginBottom: 0 }}>
//                                     ⚠️ Connect a PC from the Remote Control page first.
//                                 </p>
//                             )}
//                         </div>
//                     )}
//
//                     {/* Log */}
//                     <div className="card">
//                         <div className="card-label">📟 Log</div>
//                         <div className="ai-log-lines">
//                             {logs.length === 0 && (
//                                 <span style={{ color: 'var(--text-tertiary)', fontSize: '0.72rem' }}>No activity yet.</span>
//                             )}
//                             {logs.map((l, i) => (
//                                 <div key={i} className="ai-log-line">
//                                     <span className="ai-log-ts">{l.ts}</span>
//                                     <span className={`ai-log-${l.type}`}>{l.text}</span>
//                                 </div>
//                             ))}
//                         </div>
//                     </div>
//
//                 </div>
//
//                 {/* RIGHT column — Chat */}
//                 <div className="ai-right">
//                     <div className="card ai-chat-card" style={{ flex: 1 }}>
//                         <div className="card-label">💬 Chat with AI</div>
//
//                         <div className="ai-chat-history">
//                             {messages.map((m, i) => (
//                                 <div key={i} className={`ai-msg ai-msg-${m.role}`}>
//                                     {m.text}
//                                 </div>
//                             ))}
//                             {thinking && (
//                                 <div className="ai-msg ai-msg-ai ai-thinking">
//                                     <span className="spin" style={{ display: 'inline-block', width: 13, height: 13, border: '2px solid rgba(167,139,250,.3)', borderTopColor: '#a78bfa', borderRadius: '50%' }} />
//                                     <span style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
//                     {model} is thinking…
//                   </span>
//                                 </div>
//                             )}
//                             <div ref={chatEndRef} />
//                         </div>
//
//                         {/* Suggestion chips */}
//                         <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
//                             {[
//                                 'Open Chrome and go to youtube.com',
//                                 'Set volume to 60%',
//                                 'Take a screenshot and open Downloads',
//                                 'Open notepad and type Hello World',
//                             ].map(s => (
//                                 <button
//                                     key={s}
//                                     className="q-btn"
//                                     style={{ fontSize: '0.68rem' }}
//                                     disabled={thinking || running}
//                                     onClick={() => sendPrompt(s)}
//                                 >
//                                     {s}
//                                 </button>
//                             ))}
//                         </div>
//
//                         <div className="ai-chat-input-row">
//               <textarea
//                   ref={inputRef}
//                   className="ai-chat-input"
//                   placeholder={thinking ? 'AI is thinking…' : 'Tell the AI what to do on your PC…'}
//                   rows={2}
//                   value={input}
//                   disabled={thinking || running}
//                   onChange={e => setInput(e.target.value)}
//                   onKeyDown={onKeyDown}
//               />
//                             <button
//                                 className="btn btn-primary"
//                                 style={{ padding: '8px 16px', alignSelf: 'stretch' }}
//                                 disabled={!input.trim() || thinking || running}
//                                 onClick={() => sendPrompt(input)}
//                             >
//                                 {thinking ? (
//                                     <span className="spin" style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid rgba(255,255,255,.3)', borderTopColor: '#fff', borderRadius: '50%' }} />
//                                 ) : '↑'}
//                             </button>
//                         </div>
//
//                         <div style={{ marginTop: 6, fontSize: '0.68rem', color: 'var(--text-tertiary)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
//                             <span>Enter to send · Shift+Enter for newline</span>
//                             <span>Model: <strong style={{ color: 'var(--accent-purple,#a78bfa)' }}>{model}</strong></span>
//                             <span>Server: <strong style={{ color: 'var(--text-secondary)' }}>192.168.5.32:5004</strong></span>
//                         </div>
//                     </div>
//                 </div>
//
//             </div>
//         </div>
//     );
// }