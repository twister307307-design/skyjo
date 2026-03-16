const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const JWT_SECRET = process.env.JWT_SECRET || 'skyjo_secret_2024';
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const users = {};
const rooms = {};
const AVATARS = ['🌟','🎯','🎲','🃏','🎴','🎪','🎨','🎭','🦊','🐺','🐉','🦋','🌙','⭐','🔥','💎','👑','🤖','👾','🎃'];

// ─── SKYJO DECK ──────────────────────────────────────────────
// Cards: -2(5), 0(15), 1-12(10 each)
function createDeck() {
  const deck = [];
  for (let i = 0; i < 5; i++) deck.push(-2);
  for (let i = 0; i < 15; i++) deck.push(0);
  for (let v = 1; v <= 12; v++) for (let i = 0; i < 10; i++) deck.push(v);
  return shuffle(deck);
}

function shuffle(a) {
  const arr = [...a];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function cardColor(v) {
  if (v === -2) return 'dark-blue';
  if (v === 0) return 'blue';
  if (v <= 4) return 'green';
  if (v <= 8) return 'yellow';
  return 'red';
}

function auth(t) {
  try { return jwt.verify(t, JWT_SECRET); } catch { return null; }
}

// AUTH
app.post('/api/register', async (req, res) => {
  const { username, password, avatar } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Champs manquants' });
  if (username.length < 3) return res.status(400).json({ error: 'Pseudo trop court' });
  if (password.length < 4) return res.status(400).json({ error: 'Mot de passe trop court' });
  if (users[username]) return res.status(400).json({ error: 'Pseudo déjà pris' });
  const hash = await bcrypt.hash(password, 10);
  const av = AVATARS.includes(avatar) ? avatar : AVATARS[0];
  users[username] = { password: hash, avatar: av };
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, username, avatar: av });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const u = users[username];
  if (!u) return res.status(400).json({ error: 'Compte introuvable' });
  if (!await bcrypt.compare(password, u.password)) return res.status(400).json({ error: 'Mot de passe incorrect' });
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, username, avatar: u.avatar });
});

// GAME
class SkyjoRoom {
  constructor(code, host) {
    this.code = code; this.host = host;
    this.players = {}; // sid -> { username, avatar, grid, connected }
    this.playerOrder = [];
    this.phase = 'lobby'; // lobby, reveal2, playing, last_round, finished
    this.deck = []; this.discard = [];
    this.currentIdx = 0;
    this.lastRoundStarter = null; // sid who closed
    this.log = [];
    this.roundNum = 0;
    this.scores = {}; // username -> total score
    // Turn sub-phase: 'draw' | 'replace_or_discard' | 'flip'
    this.turnPhase = 'draw';
    this.drawnCard = null; // card picked from deck this turn
    this.reveal2Done = {}; // sid -> count revealed
  }

  add(sid, username, avatar) {
    this.players[sid] = { username, avatar, grid: [], connected: true };
    if (!this.scores[username]) this.scores[username] = 0;
  }
  del(sid) { delete this.players[sid]; this.playerOrder = this.playerOrder.filter(s => s !== sid); }
  count() { return Object.keys(this.players).length; }
  current() { return this.playerOrder[this.currentIdx]; }

  nextTurn() {
    this.currentIdx = (this.currentIdx + 1) % this.playerOrder.length;
    this.turnPhase = 'draw';
    this.drawnCard = null;
  }

  dealGrid() {
    // 12 cards per player, 3 rows x 4 cols, all face down
    this.playerOrder.forEach(sid => {
      this.players[sid].grid = Array.from({ length: 12 }, (_, i) => ({
        value: this.deck.pop(),
        revealed: false,
        idx: i,
      }));
    });
    // First discard
    this.discard = [this.deck.pop()];
  }

  // Check and remove completed columns (3 same revealed values)
  checkColumns(sid) {
    const grid = this.players[sid].grid;
    const removed = [];
    for (let col = 0; col < 4; col++) {
      const indices = [col, col + 4, col + 8];
      const cards = indices.map(i => grid[i]);
      if (cards.every(c => c.revealed && c.value === cards[0].value)) {
        indices.forEach(i => { grid[i].removed = true; });
        removed.push(cards[0].value);
      }
    }
    return removed;
  }

  gridScore(sid) {
    return this.players[sid].grid
      .filter(c => !c.removed)
      .reduce((sum, c) => sum + c.value, 0);
  }

  allRevealed(sid) {
    return this.players[sid].grid.every(c => c.revealed || c.removed);
  }

  log_(msg, type = 'info') { this.log.push({ msg, type, t: Date.now() }); }

  state(forSid = null) {
    const players = {};
    const sids = this.playerOrder.length ? this.playerOrder : Object.keys(this.players);
    sids.forEach(sid => {
      const p = this.players[sid];
      if (!p) return;
      const grid = p.grid.map(c => ({
        value: (c.revealed || c.removed || this.phase === 'finished') ? c.value : null,
        revealed: c.revealed,
        removed: c.removed || false,
        idx: c.idx,
      }));
      players[sid] = {
        username: p.username, avatar: p.avatar, connected: p.connected,
        isHost: p.username === this.host,
        isCurrent: sid === this.current(),
        grid,
        score: this.gridScore(sid),
        totalScore: this.scores[p.username] || 0,
        allRevealed: this.allRevealed(sid),
      };
    });
    return {
      code: this.code, host: this.host, phase: this.phase,
      players, playerOrder: this.playerOrder,
      topDiscard: this.discard[this.discard.length - 1] ?? null,
      deckCount: this.deck.length,
      currentPlayer: this.current(),
      turnPhase: this.turnPhase,
      drawnCard: forSid === this.current() ? this.drawnCard : null,
      lastRoundStarter: this.lastRoundStarter,
      log: this.log.slice(-35),
      roundNum: this.roundNum,
      scores: this.scores,
    };
  }
}

const socketUsers = {};

io.on('connection', socket => {
  const bcast = code => {
    const r = rooms[code]; if (!r) return;
    Object.keys(r.players).forEach(sid => io.to(sid).emit('state', r.state(sid)));
  };

  socket.on('auth', ({ token }) => {
    const u = auth(token); if (!u) return socket.emit('auth_error');
    socketUsers[socket.id] = u.username;
    socket.emit('auth_ok', { username: u.username, avatar: users[u.username]?.avatar });
  });

  socket.on('create_room', ({ token }) => {
    const u = auth(token); if (!u) return;
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const r = new SkyjoRoom(code, u.username);
    rooms[code] = r;
    r.add(socket.id, u.username, users[u.username]?.avatar || '🌟');
    socket.join(code);
    r.log_(`🏠 ${u.username} a créé le salon`, 'system');
    socket.emit('room_joined', { code });
    bcast(code);
  });

  socket.on('join_room', ({ token, code }) => {
    const u = auth(token); if (!u) return socket.emit('err', 'Non authentifié');
    const c = code?.toUpperCase();
    const r = rooms[c];
    if (!r) return socket.emit('err', 'Salon introuvable');
    if (r.phase !== 'lobby') return socket.emit('err', 'Partie déjà en cours');
    if (r.count() >= 8) return socket.emit('err', 'Salon plein (max 8)');
    if (Object.values(r.players).find(p => p.username === u.username)) return socket.emit('err', 'Déjà dans ce salon');
    r.add(socket.id, u.username, users[u.username]?.avatar || '🌟');
    socket.join(c);
    r.log_(`🚪 ${u.username} a rejoint`, 'system');
    socket.emit('room_joined', { code: c });
    bcast(c);
  });

  socket.on('start_game', ({ token, code }) => {
    const u = auth(token); if (!u) return;
    const r = rooms[code]; if (!r || r.host !== u.username) return socket.emit('err', 'Pas l\'hôte');
    if (r.count() < 2) return socket.emit('err', 'Minimum 2 joueurs !');
    startRound(r, code);
  });

  function startRound(r, code) {
    r.roundNum++;
    r.deck = createDeck();
    r.playerOrder = shuffle(Object.keys(r.players));
    r.currentIdx = 0;
    r.lastRoundStarter = null;
    r.drawnCard = null;
    r.turnPhase = 'draw';
    r.reveal2Done = {};
    r.dealGrid();
    r.phase = 'reveal2';
    r.log_(`🎴 Manche ${r.roundNum} — Retournez 2 cartes !`, 'system');
    bcast(code);
  }

  // Reveal 2 initial cards
  socket.on('reveal_initial', ({ token, code, cardIdx }) => {
    const u = auth(token); if (!u) return;
    const r = rooms[code]; if (!r || r.phase !== 'reveal2') return;
    const sid = Object.keys(r.players).find(s => r.players[s].username === u.username);
    if (!sid) return;
    const p = r.players[sid];
    if (!r.reveal2Done[sid]) r.reveal2Done[sid] = 0;
    if (r.reveal2Done[sid] >= 2) return socket.emit('err', 'Vous avez déjà retourné 2 cartes');
    const card = p.grid[cardIdx];
    if (!card || card.revealed) return socket.emit('err', 'Carte déjà retournée');
    card.revealed = true;
    r.reveal2Done[sid]++;
    r.log_(`👁️ ${u.username} retourne une carte`, 'action');
    // Check if all done
    const allDone = Object.keys(r.players).every(s => (r.reveal2Done[s] || 0) >= 2);
    if (allDone) {
      r.phase = 'playing';
      // Player with highest revealed sum goes first
      let maxSum = -Infinity, firstSid = r.playerOrder[0];
      r.playerOrder.forEach(s => {
        const sum = r.players[s].grid.filter(c => c.revealed).reduce((a, c) => a + c.value, 0);
        if (sum > maxSum) { maxSum = sum; firstSid = s; }
      });
      r.currentIdx = r.playerOrder.indexOf(firstSid);
      r.log_(`🎯 ${r.players[firstSid].username} commence (score révélé le plus élevé) !`, 'turn');
    }
    bcast(code);
  });

  // Draw from deck
  socket.on('draw_deck', ({ token, code }) => {
    const u = auth(token); if (!u) return;
    const r = rooms[code]; if (!r || !['playing','last_round'].includes(r.phase)) return;
    const sid = Object.keys(r.players).find(s => r.players[s].username === u.username);
    if (!sid || r.current() !== sid || r.turnPhase !== 'draw') return;
    if (r.deck.length === 0) {
      const top = r.discard.pop();
      r.deck = shuffle(r.discard); r.discard = [top];
    }
    r.drawnCard = r.deck.pop();
    r.turnPhase = 'replace_or_discard';
    r.log_(`📥 ${u.username} pioche une carte`, 'action');
    bcast(code);
  });

  // Take from discard
  socket.on('take_discard', ({ token, code }) => {
    const u = auth(token); if (!u) return;
    const r = rooms[code]; if (!r || !['playing','last_round'].includes(r.phase)) return;
    const sid = Object.keys(r.players).find(s => r.players[s].username === u.username);
    if (!sid || r.current() !== sid || r.turnPhase !== 'draw') return;
    if (r.discard.length === 0) return socket.emit('err', 'Défausse vide');
    r.drawnCard = r.discard.pop();
    r.turnPhase = 'must_replace'; // must place on grid
    r.log_(`♻️ ${u.username} prend la carte de la défausse (${r.drawnCard})`, 'action');
    bcast(code);
  });

  // Place drawn card on grid (replace a grid card)
  socket.on('place_card', ({ token, code, gridIdx }) => {
    const u = auth(token); if (!u) return;
    const r = rooms[code]; if (!r || !['playing','last_round'].includes(r.phase)) return;
    const sid = Object.keys(r.players).find(s => r.players[s].username === u.username);
    if (!sid || r.current() !== sid) return;
    if (!['replace_or_discard','must_replace'].includes(r.turnPhase)) return;
    if (r.drawnCard === null) return;
    const p = r.players[sid];
    const oldCard = p.grid[gridIdx];
    if (!oldCard || oldCard.removed) return socket.emit('err', 'Case invalide');
    // Swap
    const oldVal = oldCard.value;
    r.discard.push(oldVal);
    oldCard.value = r.drawnCard;
    oldCard.revealed = true;
    r.drawnCard = null;
    r.log_(`🔄 ${u.username} place ${oldCard.value} (remplace ${oldVal})`, 'action');
    // Check columns
    const removed = r.checkColumns(sid);
    if (removed.length) r.log_(`✨ ${u.username} élimine une colonne de ${removed[0]} !`, 'bonus');
    afterTurn(r, code, sid);
  });

  // Discard drawn card + flip a hidden card
  socket.on('discard_and_flip', ({ token, code, gridIdx }) => {
    const u = auth(token); if (!u) return;
    const r = rooms[code]; if (!r || !['playing','last_round'].includes(r.phase)) return;
    const sid = Object.keys(r.players).find(s => r.players[s].username === u.username);
    if (!sid || r.current() !== sid || r.turnPhase !== 'replace_or_discard') return;
    if (r.drawnCard === null) return;
    const p = r.players[sid];
    const card = p.grid[gridIdx];
    if (!card || card.revealed || card.removed) return socket.emit('err', 'Carte déjà retournée');
    r.discard.push(r.drawnCard);
    r.drawnCard = null;
    card.revealed = true;
    r.log_(`👁️ ${u.username} défausse et retourne une carte (${card.value})`, 'action');
    const removed = r.checkColumns(sid);
    if (removed.length) r.log_(`✨ ${u.username} élimine une colonne de ${removed[0]} !`, 'bonus');
    afterTurn(r, code, sid);
  });

  function afterTurn(r, code, sid) {
    // Check if this player revealed all cards → trigger last round
    if (r.allRevealed(sid) && r.phase === 'playing') {
      r.lastRoundStarter = sid;
      r.phase = 'last_round';
      r.log_(`🔔 ${r.players[sid].username} a retourné toutes ses cartes ! Dernier tour pour les autres !`, 'alert');
    }
    r.nextTurn();
    // If last round and we're back to starter → end round
    if (r.phase === 'last_round' && r.current() === r.lastRoundStarter) {
      endRound(r, code);
      return;
    }
    const cur = r.players[r.current()];
    r.log_(`🎯 Tour de ${cur?.username}`, 'turn');
    bcast(code);
  }

  function endRound(r, code) {
    r.phase = 'finished';
    // Reveal all
    Object.values(r.players).forEach(p => p.grid.forEach(c => c.revealed = true));
    // Scores
    const roundScores = {};
    r.playerOrder.forEach(sid => {
      const p = r.players[sid];
      let score = r.gridScore(sid);
      // Penalty: if closer triggered last round but doesn't have lowest score, double their score
      if (r.lastRoundStarter === sid) {
        const others = r.playerOrder.filter(s => s !== sid).map(s => r.gridScore(s));
        const myScore = score;
        if (others.some(s => s <= myScore)) {
          score *= 2;
          r.log_(`💥 ${p.username} a fermé mais n'a pas le plus bas score → score doublé !`, 'penalty');
        }
      }
      roundScores[p.username] = score;
      r.scores[p.username] = (r.scores[p.username] || 0) + score;
    });

    // Log scores
    r.log_('📊 Scores de la manche :', 'system');
    Object.entries(roundScores).sort(([,a],[,b])=>a-b).forEach(([name, score]) => {
      r.log_(`  ${name} : +${score} pts (total: ${r.scores[name]})`, 'score');
    });

    // Check game end (someone reaches 100)
    const gameOver = Object.values(r.scores).some(s => s >= 100);
    if (gameOver) {
      const winner = Object.entries(r.scores).sort(([,a],[,b])=>a-b)[0];
      r.log_(`🏆 ${winner[0]} gagne la partie avec ${winner[1]} points !`, 'win');
    } else {
      r.log_(`🔄 Fin de manche ! L'hôte peut lancer la suivante.`, 'system');
    }
    bcast(code);
  }

  socket.on('next_round', ({ token, code }) => {
    const u = auth(token); if (!u) return;
    const r = rooms[code]; if (!r || r.host !== u.username || r.phase !== 'finished') return;
    const gameOver = Object.values(r.scores).some(s => s >= 100);
    if (gameOver) return socket.emit('err', 'La partie est terminée !');
    startRound(r, code);
  });

  socket.on('new_game', ({ token, code }) => {
    const u = auth(token); if (!u) return;
    const r = rooms[code]; if (!r || r.host !== u.username) return;
    Object.keys(r.players).forEach(sid => { r.scores[r.players[sid].username] = 0; });
    r.phase = 'lobby'; r.log = [];
    r.log_('🔄 Nouvelle partie !', 'system');
    bcast(code);
  });

  socket.on('chat', ({ token, code, msg }) => {
    const u = auth(token); if (!u) return;
    const r = rooms[code]; if (!r) return;
    const p = Object.values(r.players).find(p => p.username === u.username);
    if (!p) return;
    const clean = String(msg).trim().substring(0, 200); if (!clean) return;
    io.to(code).emit('chat_msg', { username: u.username, avatar: p.avatar, msg: clean });
  });

  socket.on('leave_room', ({ token, code }) => {
    const u = auth(token); if (!u) return;
    const r = rooms[code]; if (!r) return;
    const sid = Object.keys(r.players).find(s => r.players[s].username === u.username);
    if (sid) { r.del(sid); r.log_(`👋 ${u.username} a quitté`, 'system'); }
    if (!r.count()) delete rooms[code]; else bcast(code);
  });

  socket.on('disconnect', () => {
    const username = socketUsers[socket.id];
    if (username) {
      Object.entries(rooms).forEach(([code, r]) => {
        if (r.players[socket.id]) {
          r.players[socket.id].connected = false;
          r.log_(`📡 ${username} déconnecté`, 'system');
          bcast(code);
        }
      });
    }
    delete socketUsers[socket.id];
  });
});

server.listen(PORT, () => console.log(`🌟 Skyjo server on port ${PORT}`));
