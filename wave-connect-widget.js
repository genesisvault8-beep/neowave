/**
 * wave-connect-widget.js
 * WaveConnect — Embeddable P2P Support Chat by Genesis Group
 *
 * Usage:
 * <script src="wave-connect-widget.js"
 *   data-wave-code="BASE64_ENCODED_OFFER"
 *   data-owner-name="Support"
 *   data-theme="#0077ff"
 *   data-neowave-url="https://neowave.genesisvault.xyz">
 * </script>
 *
 * Flow:
 * 1. Agent opens NeoWave → starts a Wave → gets a Wave Code (SDP offer)
 * 2. Agent embeds that Wave Code in data-wave-code on their site
 * 3. Visitor clicks bubble → copies Wave Code → opens NeoWave → pastes it → gets Answer Code
 * 4. Visitor pastes Answer Code back into widget → widget finalizes WebRTC connection
 * 5. Direct P2P chat — no server ever involved
 */

(function () {
  'use strict';

  // ── Config from script tag ──
  const SCRIPT = document.currentScript;
  const WAVE_CODE    = SCRIPT?.getAttribute('data-wave-code') || '';
  const OWNER_NAME   = SCRIPT?.getAttribute('data-owner-name') || 'Support';
  const THEME        = SCRIPT?.getAttribute('data-theme') || '#0077ff';
  const NEOWAVE_URL  = SCRIPT?.getAttribute('data-neowave-url') || 'https://neowave.genesisvault.xyz';

  // Derive theme colors
  const THEME_DIM = THEME + '33';
  const THEME_BG  = THEME + '12';

  // STUN servers — same as NeoWave app
  const RTC_CONFIG = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
    ]
  };

  // ── State ──
  let wcPC           = null;   // RTCPeerConnection
  let wcChannel      = null;   // RTCDataChannel
  let wcPanelOpen    = false;
  let wcVisitorName  = 'Visitor';
  let wcConnected    = false;

  // ── Inject CSS ──
  const style = document.createElement('style');
  style.textContent = `
    #wc-bubble {
      position: fixed; bottom: 20px; right: 20px; z-index: 99998;
      width: 56px; height: 56px; border-radius: 50%;
      background: linear-gradient(135deg, ${THEME}, #0055cc);
      border: none; cursor: pointer;
      box-shadow: 0 4px 20px ${THEME}66, 0 0 0 0 ${THEME}44;
      display: flex; align-items: center; justify-content: center;
      font-size: 24px; transition: all 0.25s; outline: none;
      animation: wc-pulse 3s ease-in-out infinite;
    }
    #wc-bubble:hover { transform: scale(1.1); box-shadow: 0 6px 28px ${THEME}80; }
    #wc-bubble.open { background: #0c1422; box-shadow: 0 4px 20px rgba(0,0,0,0.4); animation: none; }
    @keyframes wc-pulse {
      0%, 100% { box-shadow: 0 4px 20px ${THEME}66, 0 0 0 0 ${THEME}44; }
      50%       { box-shadow: 0 4px 20px ${THEME}66, 0 0 0 8px ${THEME}00; }
    }

    #wc-status-dot {
      position: absolute; top: 2px; right: 2px;
      width: 12px; height: 12px; border-radius: 50%;
      background: ${WAVE_CODE ? '#00e896' : '#4a6080'};
      border: 2px solid #04080f;
      box-shadow: ${WAVE_CODE ? '0 0 6px #00e896' : 'none'};
    }
    #wc-status-dot.connected { background: #00e896; box-shadow: 0 0 6px #00e896; }

    #wc-panel {
      position: fixed; bottom: 88px; right: 20px; z-index: 99999;
      width: 340px; max-height: 560px;
      background: #080e1a; border: 1px solid #1a2a40; border-radius: 18px;
      display: flex; flex-direction: column; overflow: hidden;
      box-shadow: 0 24px 80px rgba(0,0,0,0.7), 0 0 0 1px ${THEME_DIM};
      transform: translateY(16px) scale(0.97); opacity: 0; pointer-events: none;
      transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    #wc-panel.open {
      transform: translateY(0) scale(1); opacity: 1; pointer-events: all;
    }
    @media (max-width: 400px) {
      #wc-panel { width: calc(100vw - 24px); right: 12px; bottom: 80px; }
      #wc-bubble { bottom: 12px; right: 12px; }
    }

    /* Header */
    .wc-header {
      padding: 14px 16px; display: flex; align-items: center; gap: 10px;
      border-bottom: 1px solid #1a2a40; background: #0c1422; flex-shrink: 0;
    }
    .wc-avatar {
      width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0;
      background: linear-gradient(135deg, ${THEME}, #0055cc);
      display: flex; align-items: center; justify-content: center;
      font-size: 16px; font-weight: 700; color: white;
    }
    .wc-header-info { flex: 1; }
    .wc-header-name { font-size: 14px; font-weight: 700; color: #e8f0ff; }
    .wc-header-status { font-size: 11px; color: #4a6080; margin-top: 1px; display: flex; align-items: center; gap: 4px; }
    .wc-status-dot-inline { width: 6px; height: 6px; border-radius: 50%; background: ${WAVE_CODE ? '#00e896' : '#4a6080'}; }
    .wc-status-dot-inline.blink { animation: wc-blink 1s step-end infinite; }
    @keyframes wc-blink { 50% { opacity: 0; } }
    .wc-close-btn { background: none; border: none; color: #4a6080; font-size: 20px; cursor: pointer; padding: 2px; line-height: 1; transition: color 0.2s; }
    .wc-close-btn:hover { color: #e8f0ff; }

    /* Screens */
    .wc-screen { display: none; flex-direction: column; flex: 1; overflow: hidden; }
    .wc-screen.active { display: flex; }

    /* Offline */
    .wc-offline { padding: 32px 20px; text-align: center; color: #4a6080; }
    .wc-offline-icon { font-size: 40px; margin-bottom: 12px; }
    .wc-offline-title { font-size: 15px; font-weight: 700; color: #e8f0ff; margin-bottom: 6px; }
    .wc-offline-sub { font-size: 12px; line-height: 1.6; }

    /* Intro */
    .wc-intro { padding: 24px 20px; overflow-y: auto; }
    .wc-intro-icon { font-size: 36px; margin-bottom: 10px; }
    .wc-intro-title { font-size: 17px; font-weight: 700; color: #e8f0ff; margin-bottom: 6px; }
    .wc-intro-sub { font-size: 12px; color: #4a6080; line-height: 1.7; margin-bottom: 16px; }
    .wc-privacy-row { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #4a6080; padding: 3px 0; }
    .wc-privacy-row span:first-child { font-size: 14px; }
    .wc-privacy-section { background: ${THEME_BG}; border: 1px solid ${THEME_DIM}; border-radius: 8px; padding: 10px 12px; margin-bottom: 16px; }

    /* Connect */
    .wc-connect { padding: 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
    .wc-label { font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: #4a6080; margin-bottom: 4px; font-weight: 600; }
    .wc-name-input {
      width: 100%; padding: 9px 12px; background: #0c1422;
      border: 1px solid #1a2a40; border-radius: 8px;
      color: #e8f0ff; font-size: 13px; outline: none; transition: border-color 0.2s;
      font-family: inherit;
    }
    .wc-name-input:focus { border-color: ${THEME}66; }
    .wc-name-input::placeholder { color: #2a3a50; }
    .wc-code-box {
      width: 100%; padding: 9px 12px; background: #0c1422;
      border: 1px solid #1a2a40; border-radius: 8px;
      color: ${THEME}; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 10px;
      resize: none; height: 72px; outline: none; word-break: break-all;
      line-height: 1.5; transition: border-color 0.2s;
    }
    .wc-code-box.input { color: #e8f0ff; }
    .wc-code-box:focus { border-color: ${THEME}66; }

    .wc-step-row { display: flex; align-items: flex-start; gap: 10px; background: #0c1422; border: 1px solid #1a2a40; border-radius: 8px; padding: 10px 12px; }
    .wc-step-num { font-size: 10px; color: ${THEME}; background: ${THEME_BG}; border: 1px solid ${THEME_DIM}; border-radius: 4px; padding: 2px 6px; flex-shrink: 0; font-weight: 600; margin-top: 1px; }
    .wc-step-text { font-size: 12px; color: #8a9ab0; line-height: 1.5; }
    .wc-step-text strong { color: #e8f0ff; }
    .wc-step-text a { color: ${THEME}; text-decoration: none; }
    .wc-step-text a:hover { text-decoration: underline; }

    /* Buttons */
    .wc-btn {
      width: 100%; padding: 11px; border: none; border-radius: 8px;
      background: linear-gradient(135deg, ${THEME}, #0055cc);
      color: white; font-size: 13px; font-weight: 700; cursor: pointer;
      transition: all 0.2s; font-family: inherit; letter-spacing: 0.02em;
      display: flex; align-items: center; justify-content: center; gap: 6px;
    }
    .wc-btn:hover { filter: brightness(1.1); transform: translateY(-1px); }
    .wc-btn:active { transform: translateY(0); }
    .wc-btn.secondary {
      background: none; border: 1px solid #1a2a40; color: #8a9ab0;
    }
    .wc-btn.secondary:hover { border-color: ${THEME}44; color: ${THEME}; filter: none; transform: none; }
    .wc-btn.copied { background: linear-gradient(135deg, #00aa66, #007744); }

    .wc-status-msg { font-size: 11px; text-align: center; min-height: 16px; }
    .wc-status-msg.ok  { color: #00e896; }
    .wc-status-msg.err { color: #ff4455; }
    .wc-status-msg.wait { color: #f0a500; }

    /* Chat */
    .wc-messages { flex: 1; overflow-y: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
    .wc-messages::-webkit-scrollbar { width: 3px; }
    .wc-messages::-webkit-scrollbar-thumb { background: #1a2a40; border-radius: 2px; }
    .wc-msg { display: flex; flex-direction: column; gap: 2px; max-width: 80%; animation: wc-in 0.2s ease; }
    @keyframes wc-in { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
    .wc-msg.mine   { align-self: flex-end; align-items: flex-end; }
    .wc-msg.theirs { align-self: flex-start; align-items: flex-start; }
    .wc-msg-name { font-size: 10px; color: #4a6080; margin-bottom: 2px; padding: 0 4px; }
    .wc-msg-bubble { padding: 8px 12px; border-radius: 14px; font-size: 13px; line-height: 1.5; word-break: break-word; white-space: pre-wrap; }
    .wc-msg.mine   .wc-msg-bubble { background: linear-gradient(135deg, ${THEME}, #0055cc); color: white; border-bottom-right-radius: 3px; }
    .wc-msg.theirs .wc-msg-bubble { background: #0c1422; border: 1px solid #1a2a40; color: #e8f0ff; border-bottom-left-radius: 3px; }
    .wc-msg-time { font-size: 9px; color: #2a3a50; padding: 0 4px; }
    .wc-sys-msg { text-align: center; font-size: 10px; color: #4a6080; padding: 2px 0; letter-spacing: 0.04em; }

    /* Chat input */
    .wc-input-area { border-top: 1px solid #1a2a40; padding: 10px 12px; background: #0c1422; flex-shrink: 0; display: flex; gap: 8px; align-items: flex-end; }
    .wc-input {
      flex: 1; background: #080e1a; border: 1px solid #1a2a40; border-radius: 12px;
      padding: 8px 12px; color: #e8f0ff; font-size: 13px; resize: none;
      max-height: 80px; outline: none; font-family: inherit; line-height: 1.4;
      transition: border-color 0.2s;
    }
    .wc-input:focus { border-color: ${THEME}44; }
    .wc-input::placeholder { color: #2a3a50; }
    .wc-send-btn {
      width: 34px; height: 34px; border-radius: 50%; border: none; flex-shrink: 0;
      background: linear-gradient(135deg, ${THEME}, #0055cc);
      color: white; font-size: 14px; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: all 0.2s; box-shadow: 0 2px 8px ${THEME}44;
    }
    .wc-send-btn:hover { transform: scale(1.1); }
    .wc-send-btn:disabled { opacity: 0.4; cursor: default; transform: none; }

    /* Footer */
    .wc-footer { padding: 6px 16px 10px; text-align: center; font-size: 10px; color: #2a3a50; letter-spacing: 0.06em; flex-shrink: 0; }
    .wc-footer a { color: ${THEME}66; text-decoration: none; }
    .wc-footer a:hover { color: ${THEME}; }
  `;
  document.head.appendChild(style);

  // ── Build DOM ──
  const bubble = document.createElement('button');
  bubble.id = 'wc-bubble';
  bubble.innerHTML = `<span>💬</span><div id="wc-status-dot"></div>`;
  bubble.onclick = wcToggle;
  document.body.appendChild(bubble);

  const panel = document.createElement('div');
  panel.id = 'wc-panel';
  const ownerInitial = OWNER_NAME.charAt(0).toUpperCase();

  panel.innerHTML = `
    <!-- Header -->
    <div class="wc-header">
      <div class="wc-avatar">${ownerInitial}</div>
      <div class="wc-header-info">
        <div class="wc-header-name">${escH(OWNER_NAME)}</div>
        <div class="wc-header-status">
          <div class="wc-status-dot-inline ${WAVE_CODE ? 'blink' : ''}"></div>
          <span id="wc-header-status-text">${WAVE_CODE ? 'Available' : 'Offline'}</span>
        </div>
      </div>
      <button class="wc-close-btn" onclick="window.__wcClose()">✕</button>
    </div>

    <!-- Screen: Offline (no wave code) -->
    <div class="wc-screen ${!WAVE_CODE ? 'active' : ''}" id="wc-screen-offline">
      <div class="wc-offline">
        <div class="wc-offline-icon">📡</div>
        <div class="wc-offline-title">Support is offline</div>
        <div class="wc-offline-sub">No active Wave Code detected. Check back when support is available.</div>
      </div>
      <div class="wc-footer">Powered by <a href="${NEOWAVE_URL}" target="_blank">NeoWave</a></div>
    </div>

    <!-- Screen: Intro -->
    <div class="wc-screen ${WAVE_CODE ? 'active' : ''}" id="wc-screen-intro">
      <div class="wc-intro">
        <div class="wc-intro-icon">🔒</div>
        <div class="wc-intro-title">Encrypted support chat</div>
        <div class="wc-intro-sub">This chat goes direct from your browser to the support agent. No server in between — not even ours.</div>
        <div class="wc-privacy-section">
          <div class="wc-privacy-row"><span>🔒</span><span>End-to-end encrypted via WebRTC</span></div>
          <div class="wc-privacy-row"><span>🚫</span><span>No chat logs stored anywhere</span></div>
          <div class="wc-privacy-row"><span>👁️</span><span>Zero third-party access</span></div>
        </div>
        <button class="wc-btn" onclick="window.__wcStartConnect()">Start Secure Chat →</button>
      </div>
      <div class="wc-footer">Powered by <a href="${NEOWAVE_URL}" target="_blank">NeoWave</a> · <a href="${NEOWAVE_URL}" target="_blank">Genesis Group</a></div>
    </div>

    <!-- Screen: Connect (manual SDP exchange) -->
    <div class="wc-screen" id="wc-screen-connect">
      <div class="wc-connect">
        <div>
          <div class="wc-label">Your name (optional)</div>
          <input class="wc-name-input" id="wc-name-input" type="text" placeholder="Visitor" maxlength="20" />
        </div>

        <div class="wc-step-row">
          <div class="wc-step-num">1</div>
          <div class="wc-step-text">Copy the <strong>Wave Code</strong> below, then open NeoWave and paste it there as a guest.</div>
        </div>

        <div>
          <div class="wc-label">Wave Code (from support agent)</div>
          <textarea class="wc-code-box" id="wc-offer-display" readonly>${escH(WAVE_CODE)}</textarea>
          <button class="wc-btn secondary" id="wc-copy-btn" onclick="window.__wcCopyOffer()">⎘ Copy Wave Code</button>
        </div>

        <div class="wc-step-row">
          <div class="wc-step-num">2</div>
          <div class="wc-step-text">In NeoWave, choose <strong>Join a Wave</strong>, paste the code, and tap <strong>Generate Answer Code</strong>. Then copy the Answer Code it gives you.</div>
        </div>

        <div class="wc-step-row">
          <div class="wc-step-num">2b</div>
          <div class="wc-step-text">Don't have NeoWave open? <a href="${NEOWAVE_URL}" target="_blank">Open it here →</a></div>
        </div>

        <div class="wc-step-row">
          <div class="wc-step-num">3</div>
          <div class="wc-step-text">Paste the <strong>Answer Code</strong> from NeoWave below, then tap Connect.</div>
        </div>

        <div>
          <div class="wc-label">Answer Code (from NeoWave)</div>
          <textarea class="wc-code-box input" id="wc-answer-input" placeholder="Paste Answer Code here..."></textarea>
        </div>

        <button class="wc-btn" onclick="window.__wcConnect()">🔗 Connect</button>
        <div class="wc-status-msg" id="wc-connect-status"></div>
      </div>
      <div class="wc-footer">Powered by <a href="${NEOWAVE_URL}" target="_blank">NeoWave</a></div>
    </div>

    <!-- Screen: Chat -->
    <div class="wc-screen" id="wc-screen-chat">
      <div class="wc-messages" id="wc-messages"></div>
      <div class="wc-input-area">
        <textarea class="wc-input" id="wc-msg-input" rows="1" placeholder="Type a message..." oninput="this.style.height='auto';this.style.height=Math.min(this.scrollHeight,80)+'px'" onkeydown="window.__wcKeyDown(event)"></textarea>
        <button class="wc-send-btn" id="wc-send-btn" onclick="window.__wcSend()">➤</button>
      </div>
      <div class="wc-footer">Direct P2P · <a href="${NEOWAVE_URL}" target="_blank">NeoWave</a></div>
    </div>
  `;
  document.body.appendChild(panel);

  // ── Global functions (called from inline onclick) ──
  window.__wcClose       = () => { wcPanelOpen = false; panel.classList.remove('open'); bubble.classList.remove('open'); bubble.querySelector('span').textContent = '💬'; };
  window.__wcStartConnect = wcStartConnect;
  window.__wcCopyOffer   = wcCopyOffer;
  window.__wcConnect     = wcConnect;
  window.__wcSend        = wcSend;
  window.__wcKeyDown     = wcKeyDown;

  // ── Functions ──
  function wcToggle() {
    wcPanelOpen = !wcPanelOpen;
    panel.classList.toggle('open', wcPanelOpen);
    bubble.classList.toggle('open', wcPanelOpen);
    bubble.querySelector('span').textContent = wcPanelOpen ? '✕' : '💬';
  }

  function wcStartConnect() {
    showScreen('wc-screen-connect');
    document.getElementById('wc-name-input')?.focus();
  }

  function wcCopyOffer() {
    if (!WAVE_CODE) return;
    navigator.clipboard.writeText(WAVE_CODE).then(() => {
      const btn = document.getElementById('wc-copy-btn');
      btn.textContent = '✓ Copied!';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = '⎘ Copy Wave Code'; btn.classList.remove('copied'); }, 2000);
    });
  }

  async function wcConnect() {
    const raw = document.getElementById('wc-answer-input').value.trim();
    const statusEl = document.getElementById('wc-connect-status');
    const nameVal  = document.getElementById('wc-name-input').value.trim();
    wcVisitorName  = nameVal || 'Visitor';

    if (!raw) { setStatus(statusEl, 'Paste your Answer Code first', 'err'); return; }
    if (!WAVE_CODE) { setStatus(statusEl, 'No Wave Code available', 'err'); return; }

    setStatus(statusEl, 'Connecting...', 'wait');

    try {
      // The visitor's pasted Answer Code is the SDP answer
      const { sdp: answerSdp, type: answerType } = JSON.parse(atob(raw));

      // The widget holds the agent's offer in data-wave-code
      const { sdp: offerSdp, type: offerType } = JSON.parse(atob(WAVE_CODE));

      // Widget acts as the guest (answerer):
      // - set remote = agent's offer
      // - set local  = visitor's answer (from NeoWave)
      wcPC = new RTCPeerConnection(RTC_CONFIG);

      wcPC.ondatachannel = e => {
        wcChannel = e.channel;
        wcSetupChannel();
      };

      wcPC.oniceconnectionstatechange = () => {
        if (wcPC.iceConnectionState === 'failed' || wcPC.iceConnectionState === 'disconnected') {
          setStatus(statusEl, 'Connection lost. Try again.', 'err');
        }
      };

      // Set remote = agent's offer
      await wcPC.setRemoteDescription(new RTCSessionDescription({ sdp: offerSdp, type: offerType }));

      // Set local = visitor's answer
      await wcPC.setLocalDescription(new RTCSessionDescription({ sdp: answerSdp, type: answerType }));

      setStatus(statusEl, '⏳ Waiting for agent...', 'wait');

    } catch(e) {
      setStatus(statusEl, '✗ Invalid code. Check both codes and try again.', 'err');
    }
  }

  function wcSetupChannel() {
    wcChannel.onopen = () => {
      wcConnected = true;
      wcChannel.send(JSON.stringify({ type: 'WC_JOIN', name: wcVisitorName }));
      showScreen('wc-screen-chat');
      wcAddSysMsg('Connected — this chat is private and P2P');
      document.getElementById('wc-header-status-text').textContent = 'Connected';
      document.querySelector('.wc-status-dot-inline').style.background = '#00e896';
      document.querySelector('.wc-status-dot-inline').classList.remove('blink');
      document.getElementById('wc-status-dot').classList.add('connected');
      document.getElementById('wc-msg-input')?.focus();
    };

    wcChannel.onmessage = e => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'WC_MSG') {
          wcAddMessage(data.text, data.name || OWNER_NAME, false);
        } else if (data.type === 'WC_SYS') {
          wcAddSysMsg(data.text);
        }
      } catch(err) {}
    };

    wcChannel.onclose = () => {
      wcConnected = false;
      wcAddSysMsg('Agent disconnected — session ended');
      document.getElementById('wc-send-btn').disabled = true;
      document.getElementById('wc-header-status-text').textContent = 'Disconnected';
    };

    wcChannel.onerror = () => {
      wcAddSysMsg('Connection error');
    };
  }

  function wcSend() {
    if (!wcChannel || wcChannel.readyState !== 'open') return;
    const input = document.getElementById('wc-msg-input');
    const text = input.value.trim();
    if (!text) return;
    wcChannel.send(JSON.stringify({ type: 'WC_MSG', text, name: wcVisitorName }));
    wcAddMessage(text, wcVisitorName, true);
    input.value = ''; input.style.height = 'auto';
  }

  function wcKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); wcSend(); }
  }

  function wcAddMessage(text, name, isMe) {
    const msgs = document.getElementById('wc-messages');
    const div = document.createElement('div');
    div.className = 'wc-msg ' + (isMe ? 'mine' : 'theirs');
    div.innerHTML = `
      <div class="wc-msg-name">${escH(isMe ? 'You' : name)}</div>
      <div class="wc-msg-bubble">${escH(text)}</div>
      <div class="wc-msg-time">${wcNow()}</div>`;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function wcAddSysMsg(text) {
    const msgs = document.getElementById('wc-messages');
    const div = document.createElement('div');
    div.className = 'wc-sys-msg';
    div.textContent = '— ' + text + ' —';
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }

  // ── Helpers ──
  function showScreen(id) {
    ['wc-screen-offline','wc-screen-intro','wc-screen-connect','wc-screen-chat'].forEach(s => {
      document.getElementById(s)?.classList.remove('active');
    });
    document.getElementById(id)?.classList.add('active');
  }

  function setStatus(el, msg, type) {
    el.textContent = msg;
    el.className = 'wc-status-msg ' + (type || '');
  }

  function escH(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function wcNow() {
    return new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
  }

})();
