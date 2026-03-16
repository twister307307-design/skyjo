// ─── MUSIC ───────────────────────────────────────────────────
const TRACKS = {
  lobby: 'https://cdn.pixabay.com/audio/2023/04/10/audio_9f5ae47858.mp3',
  game:  'https://cdn.pixabay.com/audio/2022/10/16/audio_127a6e8c9e.mp3',
};
let audio = null, curTrack = null, musicOn = true, musicStarted = false;
function playMusic(t) {
  if (!musicOn) return;
  if (curTrack === t && audio && !audio.paused) return;
  if (audio) { audio.pause(); audio.currentTime = 0; }
  curTrack = t; if (!TRACKS[t]) return;
  audio = new Audio(TRACKS[t]); audio.loop = true; audio.volume = 0.2;
  audio.play().catch(() => {});
}
function toggleMusic() {
  musicOn = !musicOn;
  const b = document.getElementById('music-btn');
  if (!musicOn) { if (audio) audio.pause(); if (b) b.textContent = '🔇'; }
  else { if (b) b.textContent = '🔊'; playMusic(curTrack || 'lobby'); }
}
function startMusicOnce() {
  if (musicStarted) return; musicStarted = true;
  playMusic('lobby');
  document.removeEventListener('click', startMusicOnce);
  document.removeEventListener('keydown', startMusicOnce);
}
document.addEventListener('click', startMusicOnce);
document.addEventListener('keydown', startMusicOnce);

// ─── DATA ────────────────────────────────────────────────────
const ALL_AVATARS = ['🌟','🎯','🎲','🃏','🎴','🎪','🎨','🎭','🦊','🐺','🐉','🦋','🌙','⭐','🔥','💎','👑','🤖','👾','🎃','🧙','🦝','🐻','🦅','🎵','🌈','⚡','🍀','🔮','💫'];

function cardColor(v) {
  if (v === null || v === undefined) return 'face-down';
  if (v === -2) return 'dark-blue';
  if (v === 0) return 'blue';
  if (v <= 4) return 'green';
  if (v <= 8) return 'yellow';
  return 'red';
}
function cardDisplay(v) {
  if (v === null || v === undefined) return '🌟';
  if (v === -2) return '-2';
  return String(v);
}

// ─── STATE ───────────────────────────────────────────────────
let token = localStorage.getItem('sky_token');
let myUsername = localStorage.getItem('sky_user') || '';
let myAvatar = localStorage.getItem('sky_avatar') || '🌟';
let currentRoom = null, gs = null;
let socket = null;
let selectedAv = '🌟', endShown = false;

// Mode d'action actuel :
// null = rien
// 'replace' = cliquer une carte pour la remplacer par drawnCard
// 'flip'    = cliquer une carte face cachée pour la retourner (après avoir jeté)
let gridActionMode = null;

// ─── INIT ─────────────────────────────────────────────────────
function init() {
  buildAvPicker();
  socket = io();
  socket.on('connect', () => { if (token) socket.emit('auth', { token }); });
  socket.on('auth_ok', ({ username, avatar }) => {
    myUsername = username; myAvatar = avatar || '🌟';
    localStorage.setItem('sky_user', username); localStorage.setItem('sky_avatar', myAvatar);
    document.getElementById('my-name').textContent = username;
    document.getElementById('my-avatar').textContent = myAvatar;
    show('s-menu');
  });
  socket.on('auth_error', () => { token = null; localStorage.clear(); show('s-auth'); });
  socket.on('err', msg => showErr(msg));
  socket.on('room_joined', ({ code }) => {
    currentRoom = code;
    document.getElementById('room-code').textContent = code;
    show('s-room'); playMusic('lobby');
  });
  socket.on('state', st => onState(st));
  socket.on('chat_msg', m => appendChat(m));
  if (token) socket.emit('auth', { token });
  else show('s-auth');
  document.getElementById('chat-in').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });
  const rci = document.getElementById('room-chat-in');
  if (rci) rci.addEventListener('keydown', e => { if (e.key === 'Enter') sendRoomChat(); });
}

function buildAvPicker() {
  const g = document.getElementById('avatar-grid'); if (!g) return;
  g.innerHTML = ALL_AVATARS.map(a => `<span class="av-opt${a===selectedAv?' sel':''}" onclick="pickAv('${a}')">${a}</span>`).join('');
}
function pickAv(a) {
  selectedAv = a;
  document.getElementById('avatar-preview').textContent = a;
  document.querySelectorAll('.av-opt').forEach(el => el.classList.toggle('sel', el.textContent === a));
}

// ─── AUTH ──────────────────────────────────────────────────────
async function login() {
  const u = document.getElementById('l-user').value.trim();
  const p = document.getElementById('l-pass').value;
  if (!u || !p) return setErr('auth-err', 'Remplis tous les champs');
  try {
    const r = await fetch('/api/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username:u,password:p}) });
    const d = await r.json(); if (!r.ok) return setErr('auth-err', d.error);
    saveAuth(d);
  } catch { setErr('auth-err', 'Erreur réseau'); }
}
async function register() {
  const u = document.getElementById('r-user').value.trim();
  const p = document.getElementById('r-pass').value;
  if (!u || !p) return setErr('auth-err', 'Remplis tous les champs');
  try {
    const r = await fetch('/api/register', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username:u,password:p,avatar:selectedAv}) });
    const d = await r.json(); if (!r.ok) return setErr('auth-err', d.error);
    saveAuth(d);
  } catch { setErr('auth-err', 'Erreur réseau'); }
}
function saveAuth({ token: t, username, avatar }) {
  token = t; myUsername = username; myAvatar = avatar || '🌟';
  localStorage.setItem('sky_token', t); localStorage.setItem('sky_user', username); localStorage.setItem('sky_avatar', myAvatar);
  if (socket) socket.emit('auth', { token });
  document.getElementById('my-name').textContent = username;
  document.getElementById('my-avatar').textContent = myAvatar;
  show('s-menu');
}
function logout() { token = null; localStorage.clear(); show('s-auth'); }
function switchTab(t) {
  document.querySelectorAll('.tab').forEach((b,i) => b.classList.toggle('active',(i===0&&t==='login')||(i===1&&t==='register')));
  document.getElementById('t-login').classList.toggle('active', t==='login');
  document.getElementById('t-register').classList.toggle('active', t==='register');
  setErr('auth-err','');
}

// ─── ROOM ──────────────────────────────────────────────────────
function createRoom() { socket.emit('create_room', { token }); }
function toggleJoin() { document.getElementById('join-box').classList.toggle('hidden'); }
function joinRoom() {
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  if (!code) return; socket.emit('join_room', { token, code });
}
function leaveRoom() { socket.emit('leave_room', { token, code: currentRoom }); currentRoom = null; show('s-menu'); playMusic('lobby'); }
function copyCode() { navigator.clipboard?.writeText(currentRoom); const b=document.querySelector('.copy-btn'); b.textContent='✅'; setTimeout(()=>b.textContent='📋',1400); }
function startGame() { socket.emit('start_game', { token, code: currentRoom }); }
function sendRoomChat() {
  const el = document.getElementById('room-chat-in');
  const msg = el?.value.trim(); if (!msg||!currentRoom) return;
  socket.emit('chat', { token, code: currentRoom, msg }); el.value = '';
}

// ─── STATE ─────────────────────────────────────────────────────
function getMySid(players) {
  if (!socket) return null;
  if (players[socket.id]) return socket.id;
  return Object.keys(players).find(k => players[k].username === myUsername) || null;
}

function onState(st) {
  gs = st;
  const sid = getMySid(st.players);

  // Reset action mode quand c'est plus mon tour ou phase change
  const isMyTurn = st.currentPlayer === sid;
  if (!isMyTurn || st.phase === 'lobby') gridActionMode = null;

  if (st.phase === 'lobby') { show('s-room'); renderRoom(st, sid); return; }
  show('s-game'); playMusic('game'); renderGame(st, sid);
  if (st.phase === 'finished' && !endShown) { endShown = true; showEndScreen(st, sid); }
  if (st.phase !== 'finished') endShown = false;
}

function renderRoom(st, sid) {
  const all = Object.entries(st.players);
  document.getElementById('players-wrap').innerHTML = all.map(([,p]) =>
    `<div class="p-card ${p.isHost?'host':''}">
      <span class="p-av">${p.avatar||'🌟'}</span>
      <div class="p-nm">${p.username}</div>
      ${p.isHost?'<span class="p-badge">HÔTE</span>':''}
    </div>`).join('');
  const cnt = all.length;
  document.getElementById('player-count').textContent = `${cnt}/8 joueurs`;
  const isHost = st.players[sid]?.isHost;
  const btn = document.getElementById('start-btn');
  btn.style.display = isHost ? 'block' : 'none';
  btn.textContent = cnt < 2 ? `🔒 Minimum 2 joueurs (${cnt}/2)` : '🌟 Lancer la partie !';
  btn.disabled = cnt < 2;
}

function renderGame(st, sid) {
  const { phase, players, playerOrder, topDiscard, deckCount, currentPlayer, turnPhase, drawnCard, log, roundNum } = st;
  const me = players[sid];
  const isMyTurn = currentPlayer === sid;

  // Top bar
  const phaseLabels = { reveal2:'👁️ Retournez 2 cartes', playing:'🎮 En jeu', last_round:'🔔 Dernier tour !', finished:'📊 Fin de manche' };
  document.getElementById('g-phase-label').textContent = phaseLabels[phase] || phase;
  document.getElementById('g-round').textContent = `Manche ${roundNum}`;
  const alert = document.getElementById('g-alert');
  if (phase === 'last_round') { alert.classList.remove('hidden'); alert.textContent = '🔔 Dernier tour !'; }
  else alert.classList.add('hidden');

  // Scores
  const sb = document.getElementById('scores-bar');
  const sorted = playerOrder.map(s => players[s]).filter(Boolean).sort((a,b) => a.totalScore - b.totalScore);
  sb.innerHTML = sorted.map((p,i) => `<div class="score-chip ${i===0?'leader':''}">
    <span class="sc-av">${p.avatar||'🌟'}</span>
    <span>${p.username}</span>
    <strong>${p.totalScore}pts</strong>
    <span style="opacity:.45;font-size:.6rem">(+${p.score})</span>
  </div>`).join('');

  // Turn bar
  const tb = document.getElementById('turn-bar');
  if (phase === 'reveal2') {
    const myRevealed = me?.grid?.filter(c => c.revealed && !c.removed).length || 0;
    if (myRevealed < 2) { tb.textContent = `👁️ Retournez ${2-myRevealed} carte${myRevealed===1?'':'s'} cachée(s) !`; tb.className = 'turn-bar my-turn'; }
    else { tb.textContent = '✅ En attente des autres joueurs...'; tb.className = 'turn-bar'; }
  } else if (isMyTurn) {
    if (gridActionMode === 'replace') tb.textContent = '🔄 Clique une carte de ta grille pour la REMPLACER';
    else if (gridActionMode === 'flip') tb.textContent = '👁️ Clique une carte CACHÉE pour la retourner';
    else if (turnPhase === 'draw') tb.textContent = '🎯 TON TOUR — Pioche 📥 ou prends la défausse ♻️';
    else if (turnPhase === 'must_replace') tb.textContent = '🔄 Clique une carte de ta grille pour la REMPLACER';
    else tb.textContent = '🃏 Remplace une carte ou 🗑️ Jette + retourne';
    tb.className = 'turn-bar my-turn';
  } else {
    const cur = players[currentPlayer];
    tb.textContent = `⏳ Tour de ${cur?.avatar||''} ${cur?.username||'?'}`;
    tb.className = 'turn-bar';
  }

  // Deck
  document.getElementById('deck-count').textContent = `${deckCount} cartes`;
  const deckEl = document.getElementById('deck-pile');
  if (isMyTurn && turnPhase === 'draw') deckEl.style.boxShadow = '0 0 18px rgba(255,215,0,.6)';
  else deckEl.style.boxShadow = '';

  // Discard pile
  const dp = document.getElementById('discard-pile');
  const dv = document.getElementById('discard-val');
  if (topDiscard !== null && topDiscard !== undefined) {
    dp.className = `pile discard-pile sky-card ${cardColor(topDiscard)}`;
    dv.textContent = cardDisplay(topDiscard);
    dp.style.cursor = (isMyTurn && turnPhase === 'draw') ? 'pointer' : 'default';
    if (isMyTurn && turnPhase === 'draw') dp.style.boxShadow = '0 0 18px rgba(255,215,0,.5)';
    else dp.style.boxShadow = '';
  } else {
    dp.className = 'pile discard-pile'; dv.textContent = '--'; dp.style.boxShadow = '';
  }

  // Drawn card section
  const ds = document.getElementById('drawn-section');
  const dc = document.getElementById('drawn-card-display');
  const dcv = document.getElementById('drawn-card-val');
  if (drawnCard !== null && drawnCard !== undefined && isMyTurn && (turnPhase === 'replace_or_discard' || turnPhase === 'must_replace')) {
    ds.classList.remove('hidden');
    dc.className = `drawn-card sky-card ${cardColor(drawnCard)}`;
    dc.textContent = cardDisplay(drawnCard);
    dcv.textContent = drawnCard === -2 ? 'Valeur : -2' : `Valeur : ${drawnCard}`;
    // must_replace = pris de la défausse, doit forcément remplacer
    const btnDiscard = document.getElementById('btn-discard-drawn');
    const btnKeep = document.querySelector('.btn-keep');
    if (turnPhase === 'must_replace') {
      if (btnDiscard) btnDiscard.style.display = 'none';
      if (btnKeep) btnKeep.style.display = 'none';
      gridActionMode = 'replace';
      document.getElementById('drawn-action-hint').textContent = '👆 Tu as pris la défausse — clique une carte de ta grille pour la remplacer !';
    } else {
      if (btnDiscard) btnDiscard.style.display = 'flex';
      if (btnKeep) btnKeep.style.display = 'flex';
      if (!gridActionMode) document.getElementById('drawn-action-hint').textContent = '';
    }
  } else {
    ds.classList.add('hidden');
    gridActionMode = null;
  }

  // Action instruction
  const ai = document.getElementById('action-instruction');
  if (gridActionMode === 'replace' && isMyTurn) {
    ai.classList.remove('hidden');
    ai.textContent = '👆 Clique n\'importe quelle carte pour la remplacer (même cachée !)';
  } else if (gridActionMode === 'flip' && isMyTurn) {
    ai.classList.remove('hidden');
    ai.textContent = '👆 Clique une carte face cachée pour la retourner !';
  } else if (isMyTurn && turnPhase === 'must_replace') {
    ai.classList.remove('hidden');
    ai.textContent = '👆 Tu as pris la défausse — clique une carte pour la remplacer !';
  } else {
    ai.classList.add('hidden');
  }

  // Other players
  const og = document.getElementById('other-grids');
  og.innerHTML = playerOrder.filter(s => s !== sid).map(s => {
    const p = players[s]; if (!p) return '';
    return `<div class="opp-grid-wrap ${s===currentPlayer&&phase!=='reveal2'?'current-turn':''}">
      <div class="opp-name">${p.avatar||'🌟'} ${p.username}</div>
      <div class="opp-score-txt">Score: ${p.score} (total: ${p.totalScore})</div>
      <div class="mini-grid">
        ${p.grid.map(c => `<div class="mini-card ${c.removed?'':cardColor(c.value)}" style="${c.removed?'opacity:.15':''}">
          ${c.removed?'':c.value!==null?cardDisplay(c.value):'·'}
        </div>`).join('')}
      </div>
    </div>`;
  }).join('');

  // My grid
  document.getElementById('my-score').textContent = me?.score ?? 0;
  const myGrid = document.getElementById('my-grid');
  if (me?.grid) {
    myGrid.innerHTML = me.grid.map((c, i) => {
      if (c.removed) return `<div class="sky-card removed"></div>`;
      const isFaceDown = !c.revealed;

      let extraClass = '';
      let clickFn = '';

      if (phase === 'reveal2' && isFaceDown) {
        const alreadyRevealed = me.grid.filter(x => x.revealed && !x.removed).length;
        if (alreadyRevealed < 2) {
          extraClass = 'reveal-mode';
          clickFn = `revealInitial(${i})`;
        }
      } else if (isMyTurn) {
        if (gridActionMode === 'replace' || turnPhase === 'must_replace') {
          // Can replace ANY card (face up or down)
          extraClass = 'can-click';
          clickFn = `doReplace(${i})`;
        } else if (gridActionMode === 'flip') {
          // Can only flip face-down cards
          if (isFaceDown) {
            extraClass = 'can-click reveal-mode';
            clickFn = `doFlip(${i})`;
          }
        }
      }

      return `<div class="sky-card ${isFaceDown?'face-down':cardColor(c.value)} ${extraClass}"
        onclick="${clickFn}">
        ${isFaceDown ? '🌟' : cardDisplay(c.value)}
      </div>`;
    }).join('');
  }

  // Log
  const ll = document.getElementById('log-list');
  ll.innerHTML = log.map(e => `<div class="log-entry ${e.type}">${e.msg}</div>`).join('');
  ll.scrollTop = ll.scrollHeight;
}

// ─── GRID ACTIONS ─────────────────────────────────────────────

// Retourner une carte lors de la phase initiale
function revealInitial(idx) {
  socket.emit('reveal_initial', { token, code: currentRoom, cardIdx: idx });
}

// Piocher dans le deck
function drawDeck() {
  if (!gs) return;
  const sid = getMySid(gs.players);
  if (gs.currentPlayer !== sid || gs.turnPhase !== 'draw') return;
  socket.emit('draw_deck', { token, code: currentRoom });
  gridActionMode = 'replace'; // After drawing, can replace any card
}

// Prendre la carte de la défausse
function takeDiscard() {
  if (!gs) return;
  const sid = getMySid(gs.players);
  if (gs.currentPlayer !== sid || gs.turnPhase !== 'draw') return;
  socket.emit('take_discard', { token, code: currentRoom });
  gridActionMode = 'replace'; // Must replace after taking discard
}

// Bouton "Jeter" → active mode flip (retourner une carte cachée)
function setDiscardMode() {
  if (!gs) return;
  const sid = getMySid(gs.players);
  if (gs.currentPlayer !== sid) return;
  const me = gs.players[sid];
  const hasHidden = me?.grid?.some(c => !c.revealed && !c.removed);
  if (!hasHidden) {
    showNotif('❌ Impossible', 'Toutes vos cartes sont déjà retournées !', '😅');
    return;
  }
  gridActionMode = 'flip';
  document.getElementById('drawn-action-hint').textContent = '👆 Clique maintenant une carte face cachée dans ta grille !';
  renderGame(gs, sid);
}

// Bouton "Remplacer" → active mode replace
function setReplaceMode() {
  if (!gs) return;
  const sid = getMySid(gs.players);
  if (gs.currentPlayer !== sid) return;
  gridActionMode = 'replace';
  document.getElementById('drawn-action-hint').textContent = '👆 Clique n\'importe quelle carte de ta grille pour la remplacer !';
  renderGame(gs, sid);
}

// Remplacer une carte par la carte en main
function doReplace(idx) {
  if (!gs) return;
  socket.emit('place_card', { token, code: currentRoom, gridIdx: idx });
  gridActionMode = null;
}

// Jeter la carte en main + retourner une carte cachée
function doFlip(idx) {
  if (!gs) return;
  socket.emit('discard_and_flip', { token, code: currentRoom, gridIdx: idx });
  gridActionMode = null;
}

// ─── END SCREEN ───────────────────────────────────────────────
function showEndScreen(st, sid) {
  const { players, playerOrder, scores, roundNum } = st;
  const gameOver = Object.values(scores).some(s => s >= 100);
  document.getElementById('end-ico').textContent = gameOver ? '🏆' : '📊';
  document.getElementById('end-title').textContent = gameOver ? 'Fin de partie !' : `Fin de manche ${roundNum}`;
  const sorted = Object.entries(scores).sort(([,a],[,b]) => a-b);
  document.getElementById('end-scores').innerHTML = sorted.map(([name, score], i) => {
    const p = Object.values(players).find(p => p.username === name);
    const roundScore = playerOrder.map(s => players[s]).find(p => p?.username === name)?.score ?? 0;
    return `<div class="end-score-row ${i===0?'winner':''}">
      <span>${i===0?'🏆':i===1?'🥈':i===2?'🥉':'  '} ${p?.avatar||'🌟'} ${name}</span>
      <span>${score} pts <span style="opacity:.5;font-size:.7rem">(+${roundScore})</span></span>
    </div>`;
  }).join('');
  const isHost = players[sid]?.isHost;
  document.getElementById('btn-next-round').style.display = isHost && !gameOver ? 'block' : 'none';
  document.getElementById('btn-new-game').style.display = isHost && gameOver ? 'block' : 'none';
  document.getElementById('end-overlay').classList.remove('hidden');
}

// ─── CHAT ──────────────────────────────────────────────────────
function sendChat() {
  const el = document.getElementById('chat-in');
  const msg = el.value.trim(); if (!msg||!currentRoom) return;
  socket.emit('chat', { token, code: currentRoom, msg }); el.value = '';
}
function appendChat({ username, avatar, msg }) {
  ['chat-msgs','room-chat-msgs'].forEach(id => {
    const c = document.getElementById(id); if (!c) return;
    const d = document.createElement('div'); d.className = 'c-msg';
    d.innerHTML = `<span class="c-nm">${avatar||'🌟'} ${username}</span><span style="font-size:.75rem">${esc(msg)}</span>`;
    c.appendChild(d); c.scrollTop = c.scrollHeight;
  });
}

// ─── TABS ──────────────────────────────────────────────────────
function showTab(t) {
  document.getElementById('panel-chat').classList.toggle('active', t==='chat');
  document.getElementById('panel-log').classList.toggle('active', t==='log');
  document.getElementById('btn-chat').classList.toggle('active', t==='chat');
  document.getElementById('btn-log').classList.toggle('active', t==='log');
}

// ─── END ───────────────────────────────────────────────────────
function nextRound() { socket.emit('next_round', { token, code: currentRoom }); document.getElementById('end-overlay').classList.add('hidden'); endShown = false; }
function newGame() { socket.emit('new_game', { token, code: currentRoom }); document.getElementById('end-overlay').classList.add('hidden'); endShown = false; }
function endGoMenu() { socket.emit('leave_room', { token, code: currentRoom }); currentRoom = null; document.getElementById('end-overlay').classList.add('hidden'); show('s-menu'); playMusic('lobby'); }

// ─── UTILS ─────────────────────────────────────────────────────
function show(id) { document.querySelectorAll('.screen').forEach(s => s.classList.remove('active')); const el=document.getElementById(id); if(el) el.classList.add('active'); }
function setErr(id, msg) { const el=document.getElementById(id); if(el){el.textContent=msg; if(msg) setTimeout(()=>el.textContent='',4000);} }
function showErr(msg) { const a=document.querySelector('.screen.active'); if(!a) return; const e=a.querySelector('.err'); if(e){e.textContent=msg; setTimeout(()=>e.textContent='',4000);} }
function showNotif(title, body, ico='🌟') { document.getElementById('notif-ico').textContent=ico; document.getElementById('notif-title').textContent=title; document.getElementById('notif-body').textContent=body; document.getElementById('notif-overlay').classList.remove('hidden'); }
function closeNotif() { document.getElementById('notif-overlay').classList.add('hidden'); }
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

init();
