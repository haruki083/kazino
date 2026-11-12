/* KAZINO のゲーム本体。チップは Wallet にまとめ、保存はアカウント側（app.js）が担当する。 */

window.Wallet = (() => {
  const W = { balance: 0, syncers: [], onChange: null, onRound: null };
  let timer = null;
  function render(diff = 0) {
    document.querySelectorAll("[data-balance]").forEach(el => {
      el.textContent = W.balance.toLocaleString("ja-JP");
      el.classList.toggle("up", diff > 0);
      el.classList.toggle("down", diff < 0);
    });
    clearTimeout(timer);
    timer = setTimeout(() => document.querySelectorAll("[data-balance]").forEach(el => el.classList.remove("up", "down")), 700);
    W.syncers.forEach(f => f());
  }
  W.render = render;
  // silent: ログイン直後の読み込みなど、保存し直す必要がないとき
  W.set = (v, silent = false) => {
    const diff = v - W.balance;
    W.balance = v;
    render(silent ? 0 : diff);
    if (!silent && W.onChange) W.onChange(v);
  };
  W.take = n => (n > 0 && n <= W.balance ? (W.set(W.balance - n), true) : false);
  W.pay = n => { if (n > 0) W.set(W.balance + n); };
  return W;
})();

window.KazinoGames = { started: false };
window.KazinoGames.start = () => {
  if (window.KazinoGames.started) return;
  window.KazinoGames.started = true;
  const W = window.Wallet;
  const take = W.take, pay = W.pay;
  const $ = (s, r = document) => r.querySelector(s);
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sleep = ms => new Promise(r => setTimeout(r, reduceMotion ? 0 : ms));
  const MIN_BET = 10;

  function say(el, text, kind = "") { el.textContent = text; el.className = "msg" + (kind ? " " + kind : ""); }
  function resultText(bet, payout) {
    if (W.onRound) W.onRound(bet, payout);
    const d = payout - bet;
    if (d > 0) return [`+${d}枚の勝ち！`, "win"];
    if (d === 0) return ["賭け金が戻りました。", "push"];
    return [`${-d}枚の負け`, "lose"];
  }

  /* ---------- bet bar ---------- */
  const DENOMS = [10, 50, 100, 500];
  const chipsHTML = attr => DENOMS.map(v => `<button class="chip c${v}" data-v="${v}" ${attr(v)}>${v}</button>`).join("");
  function makeBetBar(root) {
    root.innerHTML = `<div class="bet-amount">賭け金 <b>0</b><span>枚</span></div>
      <div class="chips">${chipsHTML(v => `aria-label="${v}枚追加"`)}</div>
      <button class="btn ghost small" data-clear>クリア</button>`;
    const out = $("b", root);
    const bar = { bet: Math.min(50, W.balance), locked: false };
    bar.sync = () => {
      if (!bar.locked && bar.bet > W.balance) bar.bet = Math.floor(W.balance / 10) * 10;
      out.textContent = bar.bet;
      root.querySelectorAll("button").forEach(b => {
        b.disabled = bar.locked || (b.dataset.v ? bar.bet + +b.dataset.v > W.balance : bar.bet === 0);
      });
      root.classList.toggle("locked", bar.locked);
    };
    bar.lock = v => { bar.locked = v; bar.sync(); };
    root.addEventListener("click", e => {
      const b = e.target.closest("button");
      if (!b || bar.locked) return;
      bar.bet = b.dataset.v ? Math.min(W.balance, bar.bet + +b.dataset.v) : 0;
      bar.sync();
    });
    W.syncers.push(bar.sync);
    bar.sync();
    return bar;
  }
  function checkBet(bet, msgEl) {
    if (bet < MIN_BET) { say(msgEl, `最低${MIN_BET}枚から賭けられます。チップを押して賭け金を決めてください。`, "lose"); return false; }
    if (!take(bet)) { say(msgEl, "チップが足りません。", "lose"); return false; }
    return true;
  }

  /* ---------- cards ---------- */
  const SUITS = ["♠", "♥", "♦", "♣"], LBL = { 11: "J", 12: "Q", 13: "K", 14: "A" };
  const label = c => LBL[c.r] || String(c.r);
  function newDeck(n = 1) {
    const d = [];
    for (let k = 0; k < n; k++) for (const s of SUITS) for (let r = 2; r <= 14; r++) d.push({ r, s });
    for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
    return d;
  }
  function cardHTML(c, hidden, extra = "") {
    if (hidden) return `<div class="card back ${extra}" role="img" aria-label="伏せたカード"></div>`;
    const red = c.s === "♥" || c.s === "♦";
    const l = label(c);
    return `<div class="card${red ? " red" : ""} ${extra}" role="img" aria-label="${c.s}${l}"><span class="tl">${l}<i>${c.s}</i></span><span class="mid">${c.s}</span><span class="tl br">${l}<i>${c.s}</i></span></div>`;
  }
  // 変化したカードだけ描き直して、配るアニメーションを新しいカードにだけかける
  function renderHand(el, cards, hiddenIdx = -1) {
    const keys = cards.map((c, i) => (i === hiddenIdx ? "X" : label(c) + c.s));
    const old = el._keys || [];
    let keep = 0;
    while (keep < old.length && keep < keys.length && old[keep] === keys[keep]) keep++;
    while (el.children.length > keep) el.lastElementChild.remove();
    for (let i = keep; i < keys.length; i++) el.insertAdjacentHTML("beforeend", cardHTML(cards[i], i === hiddenIdx));
    el._keys = keys;
  }

  /* ---------- blackjack ---------- */
  const BJ = { deck: newDeck(4), player: [], dealer: [], bet: 0, phase: "idle", busy: false };
  const bj = {
    dealer: $("#bj-dealer"), player: $("#bj-player"), dv: $("#bj-dv"), pv: $("#bj-pv"), msg: $("#bj-msg"),
    deal: $("#bj-deal"), hit: $("#bj-hit"), stand: $("#bj-stand"), dbl: $("#bj-double"),
  };
  const bjBar = makeBetBar($("#bj-bet"));
  const cv = c => (c.r === 14 ? 11 : Math.min(c.r, 10));
  function hv(cs) {
    let t = 0, a = 0;
    for (const c of cs) { t += cv(c); if (c.r === 14) a++; }
    while (t > 21 && a) { t -= 10; a--; }
    return t;
  }
  const isBJ = cs => cs.length === 2 && hv(cs) === 21;
  function settle(p, d) {
    const pv = hv(p), dv = hv(d);
    if (pv > 21) return "lose";
    if (isBJ(p) && isBJ(d)) return "push";
    if (isBJ(p)) return "blackjack";
    if (isBJ(d)) return "lose";
    if (dv > 21 || pv > dv) return "win";
    return pv < dv ? "lose" : "push";
  }
  function bjRender() {
    const hide = BJ.phase === "play" ? 1 : -1;
    renderHand(bj.dealer, BJ.dealer, hide);
    renderHand(bj.player, BJ.player);
    bj.dv.textContent = !BJ.dealer.length ? "" : hide === 1 ? (BJ.dealer.length > 0 ? cv(BJ.dealer[0]) + " + ?" : "") : hv(BJ.dealer);
    bj.pv.textContent = BJ.player.length ? hv(BJ.player) : "";
    const playing = BJ.phase === "play" && !BJ.busy;
    bj.hit.disabled = bj.stand.disabled = !playing;
    bj.dbl.disabled = !(playing && BJ.player.length === 2 && W.balance >= BJ.bet);
    bj.deal.disabled = BJ.phase === "play" || BJ.phase === "dealer" || BJ.busy;
    bjBar.lock(BJ.phase === "play" || BJ.phase === "dealer" || BJ.busy);
  }
  async function bjDeal() {
    const bet = bjBar.bet;
    if (!checkBet(bet, bj.msg)) return;
    if (BJ.deck.length < 15) BJ.deck = newDeck(4);
    Object.assign(BJ, { bet, player: [], dealer: [], phase: "play", busy: true });
    say(bj.msg, " ");
    bjRender();
    for (const who of ["player", "dealer", "player", "dealer"]) {
      BJ[who].push(BJ.deck.pop());
      bjRender();
      await sleep(230);
    }
    BJ.busy = false;
    if (isBJ(BJ.player) || isBJ(BJ.dealer)) return bjFinish();
    say(bj.msg, "ヒットしますか？ スタンドしますか？");
    bjRender();
  }
  function bjHit() {
    BJ.player.push(BJ.deck.pop());
    const v = hv(BJ.player);
    if (v > 21) return bjFinish();
    if (v === 21) return bjStand();
    bjRender();
  }
  async function bjStand() {
    BJ.phase = "dealer"; BJ.busy = true;
    bjRender();
    while (hv(BJ.dealer) < 17) {
      await sleep(520);
      BJ.dealer.push(BJ.deck.pop());
      bjRender();
    }
    await sleep(250);
    BJ.busy = false;
    bjFinish();
  }
  function bjDouble() {
    if (!take(BJ.bet)) return;
    BJ.bet *= 2;
    BJ.player.push(BJ.deck.pop());
    bjRender();
    if (hv(BJ.player) > 21) return bjFinish();
    bjStand();
  }
  function bjFinish() {
    BJ.phase = "done";
    const o = settle(BJ.player, BJ.dealer);
    const payout = Math.floor(BJ.bet * { blackjack: 2.5, win: 2, push: 1, lose: 0 }[o]);
    pay(payout);
    bjRender();
    const head = {
      blackjack: "ブラックジャック！",
      win: hv(BJ.dealer) > 21 ? "ディーラーがバースト！" : "あなたの勝ち！",
      push: "引き分け。",
      lose: hv(BJ.player) > 21 ? "バースト…" : isBJ(BJ.dealer) ? "ディーラーのブラックジャック。" : "ディーラーの勝ち。",
    }[o];
    const [t, k] = resultText(BJ.bet, payout);
    say(bj.msg, `${head} ${t}`, k);
  }
  bj.deal.onclick = bjDeal;
  bj.hit.onclick = bjHit;
  bj.stand.onclick = bjStand;
  bj.dbl.onclick = bjDouble;

  /* ---------- slots ---------- */
  const SYM = [["🍒", 30], ["🍋", 25], ["🔔", 20], ["⭐", 12], ["💎", 8], ["👑", 5]];
  const THREE = { "🍒": 5, "🍋": 10, "🔔": 15, "⭐": 30, "💎": 75, "👑": 200 };
  const reels = [...document.querySelectorAll(".reel")];
  const slMsg = $("#sl-msg"), slBtn = $("#sl-spin"), slBar = makeBetBar($("#sl-bet"));
  $("#sl-pay").innerHTML = Object.entries(THREE).map(([s, m]) => `<tr data-k="${s}"><td>${s}${s}${s}</td><td>×${m}</td></tr>`).join("")
    + `<tr data-k="cherry2"><td>🍒が2つ</td><td>×2</td></tr>`;
  function pick() {
    let x = Math.random() * 100;
    for (const [s, w] of SYM) if ((x -= w) < 0) return s;
    return SYM[0][0];
  }
  function slotMult(r) {
    if (r[0] === r[1] && r[1] === r[2]) return [THREE[r[0]], r[0]];
    if (r.filter(s => s === "🍒").length === 2) return [2, "cherry2"];
    return [0, null];
  }
  slBtn.onclick = async () => {
    const bet = slBar.bet;
    if (!checkBet(bet, slMsg)) return;
    slBtn.disabled = true; slBar.lock(true);
    say(slMsg, " ");
    document.querySelectorAll("#sl-pay tr").forEach(tr => tr.classList.remove("hit"));
    const res = [pick(), pick(), pick()];
    const timers = reels.map(r => {
      r.classList.remove("win"); r.classList.add("spinning");
      return setInterval(() => { r.firstElementChild.textContent = SYM[Math.floor(Math.random() * SYM.length)][0]; }, 70);
    });
    for (let i = 0; i < 3; i++) {
      await sleep(i === 0 ? 650 : 380);
      clearInterval(timers[i]);
      reels[i].classList.remove("spinning");
      reels[i].firstElementChild.textContent = res[i];
    }
    const [mult, key] = slotMult(res);
    const payout = bet * mult;
    pay(payout);
    if (mult) {
      reels.forEach((r, i) => { if (key !== "cherry2" || res[i] === "🍒") r.classList.add("win"); });
      $(`#sl-pay tr[data-k="${key}"]`).classList.add("hit");
    }
    const [t, k] = resultText(bet, payout);
    say(slMsg, mult ? `×${mult}！ ${t}` : t, k);
    slBtn.disabled = false; slBar.lock(false);
  };

  /* ---------- roulette ---------- */
  const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
  const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  const colorOf = n => (n === 0 ? "z" : RED.has(n) ? "r" : "b");
  const RET = { n: 36, red: 2, black: 2, even: 2, odd: 2, low: 2, high: 2, dozen: 3 };
  function rWins(key, n) {
    const [t, v] = key.split(":");
    if (t === "n") return n === +v;
    if (n === 0) return false;
    return { red: RED.has(n), black: !RED.has(n), even: n % 2 === 0, odd: n % 2 === 1, low: n <= 18, high: n >= 19, dozen: Math.ceil(n / 12) === +v }[t];
  }
  const board = $("#rl-board");
  {
    let h = `<button class="cell z" data-k="n:0" style="grid-column:1;grid-row:1 / span 3" aria-label="0">0</button>`;
    for (let row = 0; row < 3; row++) for (let col = 0; col < 12; col++) {
      const n = col * 3 + (3 - row);
      h += `<button class="cell ${colorOf(n)}" data-k="n:${n}" style="grid-column:${col + 2};grid-row:${row + 1}">${n}</button>`;
    }
    [1, 2, 3].forEach(d => {
      h += `<button class="cell out" data-k="dozen:${d}" style="grid-column:${2 + (d - 1) * 4} / span 4;grid-row:4">${(d - 1) * 12 + 1}–${d * 12}</button>`;
    });
    [["low", "1–18"], ["even", "偶数"], ["red", "赤"], ["black", "黒"], ["odd", "奇数"], ["high", "19–36"]].forEach(([k, l], i) => {
      const cls = k === "red" ? " r" : k === "black" ? " b" : "";
      h += `<button class="cell out${cls}" data-k="${k}" style="grid-column:${2 + i * 2} / span 2;grid-row:5">${l}</button>`;
    });
    board.innerHTML = h;
  }
  let rlDenom = 10, rlBusy = false, rlLast = null, wheelRot = 0;
  const rlBets = {}, rlHistory = [];
  const rl = { msg: $("#rl-msg"), total: $("#rl-total"), spin: $("#rl-spin"), clear: $("#rl-clear"), rebet: $("#rl-rebet"), chips: $("#rl-chips"), res: $("#rl-result"), hist: $("#rl-history"), wheel: $("#rl-wheel") };
  rl.chips.innerHTML = chipsHTML(v => `aria-pressed="${v === rlDenom}" aria-label="${v}枚チップを選ぶ"`);
  rl.chips.onclick = e => {
    const b = e.target.closest(".chip");
    if (!b) return;
    rlDenom = +b.dataset.v;
    rl.chips.querySelectorAll(".chip").forEach(c => c.setAttribute("aria-pressed", String(c === b)));
  };
  const rlSum = () => Object.values(rlBets).reduce((a, b) => a + b, 0);
  function rlRender(wonKeys = new Set()) {
    board.querySelectorAll(".cell").forEach(c => {
      const amt = rlBets[c.dataset.k];
      let s = c.querySelector(".stake");
      if (!amt) { s && s.remove(); return; }
      if (!s) { s = document.createElement("span"); s.className = "stake"; c.appendChild(s); }
      s.textContent = amt;
      s.classList.toggle("won", wonKeys.has(c.dataset.k));
    });
    rl.total.textContent = rlSum();
    rl.spin.disabled = rlBusy || rlSum() === 0;
    rl.clear.disabled = rlBusy;
    rl.rebet.disabled = rlBusy || !rlLast;
  }
  board.onclick = e => {
    const c = e.target.closest(".cell");
    if (!c || rlBusy) return;
    if (rl.msg.classList.contains("win") || rl.msg.classList.contains("lose") || rl.msg.classList.contains("push")) {
      board.querySelectorAll(".landed").forEach(x => x.classList.remove("landed"));
      for (const k in rlBets) delete rlBets[k];
      say(rl.msg, " ");
    }
    if (rlSum() + rlDenom > W.balance) return say(rl.msg, "チップが足りません。", "lose");
    rlBets[c.dataset.k] = (rlBets[c.dataset.k] || 0) + rlDenom;
    rlRender();
  };
  rl.clear.onclick = () => {
    for (const k in rlBets) delete rlBets[k];
    board.querySelectorAll(".landed").forEach(x => x.classList.remove("landed"));
    say(rl.msg, "チップを選んで、盤の上に置いてください。");
    rlRender();
  };
  rl.rebet.onclick = () => {
    const total = Object.values(rlLast).reduce((a, b) => a + b, 0);
    if (total > W.balance) return say(rl.msg, "同じ賭けをするにはチップが足りません。", "lose");
    for (const k in rlBets) delete rlBets[k];
    Object.assign(rlBets, rlLast);
    board.querySelectorAll(".landed").forEach(x => x.classList.remove("landed"));
    say(rl.msg, "前回と同じ賭けを置きました。");
    rlRender();
  };
  function drawWheel() {
    const cvs = rl.wheel, S = 240, dpr = window.devicePixelRatio || 1;
    cvs.width = S * dpr; cvs.height = S * dpr;
    const g = cvs.getContext("2d");
    g.scale(dpr, dpr);
    const c = S / 2, R = S / 2 - 2, seg = (2 * Math.PI) / 37;
    g.fillStyle = "#3a2417"; g.beginPath(); g.arc(c, c, R, 0, 2 * Math.PI); g.fill();
    WHEEL.forEach((n, i) => {
      const a0 = -Math.PI / 2 + i * seg - seg / 2;
      g.beginPath();
      g.arc(c, c, R - 8, a0, a0 + seg);
      g.arc(c, c, R * 0.6, a0 + seg, a0, true);
      g.closePath();
      g.fillStyle = n === 0 ? "#1f7a52" : RED.has(n) ? "#c7372c" : "#1f1b16";
      g.fill();
      g.strokeStyle = "rgba(226,182,92,.6)"; g.lineWidth = 1; g.stroke();
      g.save();
      g.translate(c, c);
      g.rotate(a0 + seg / 2 + Math.PI / 2);
      g.fillStyle = "#f7f0e1";
      g.font = "600 10px 'IBM Plex Mono', monospace";
      g.textAlign = "center";
      g.fillText(String(n), 0, -(R - 20));
      g.restore();
    });
    const hub = g.createRadialGradient(c - 10, c - 10, 4, c, c, R * 0.6);
    hub.addColorStop(0, "#f2d38f"); hub.addColorStop(1, "#7a5418");
    g.fillStyle = hub; g.beginPath(); g.arc(c, c, R * 0.58, 0, 2 * Math.PI); g.fill();
    g.fillStyle = "#3a2417"; g.beginPath(); g.arc(c, c, R * 0.16, 0, 2 * Math.PI); g.fill();
  }
  function spinWheelTo(n) {
    const seg = 360 / 37, i = WHEEL.indexOf(n);
    const target = (360 - i * seg) % 360;
    let next = wheelRot - (wheelRot % 360) + 360 * 5 + target;
    if (next - wheelRot < 360 * 4) next += 360;
    wheelRot = next;
    rl.wheel.style.transform = `rotate(${next}deg)`;
    return sleep(4300);
  }
  rl.spin.onclick = async () => {
    const total = rlSum();
    if (!total || !take(total)) return;
    rlBusy = true; rlLast = { ...rlBets };
    board.querySelectorAll(".landed").forEach(x => x.classList.remove("landed"));
    say(rl.msg, "ボールが回っています…");
    rlRender();
    const n = Math.floor(Math.random() * 37);
    await spinWheelTo(n);
    let payout = 0;
    const won = new Set();
    for (const [k, a] of Object.entries(rlBets)) if (rWins(k, n)) { payout += a * RET[k.split(":")[0]]; won.add(k); }
    pay(payout);
    rl.res.textContent = n;
    rl.res.className = "rl-result " + colorOf(n);
    rlHistory.unshift(n); rlHistory.length = Math.min(rlHistory.length, 14);
    rl.hist.innerHTML = rlHistory.map(x => `<span class="${colorOf(x)}">${x}</span>`).join("");
    board.querySelector(`[data-k="n:${n}"]`).classList.add("landed");
    const name = { z: "緑", r: "赤", b: "黒" }[colorOf(n)];
    const [t, k] = resultText(total, payout);
    say(rl.msg, `${n}（${name}）！ ${t}`, k);
    rlBusy = false;
    rlRender(won);
  };
  drawWheel();
  rlRender();

  /* ---------- video poker ---------- */
  const PT = [["ロイヤルストレートフラッシュ", 250], ["ストレートフラッシュ", 50], ["フォーカード", 25], ["フルハウス", 9], ["フラッシュ", 6], ["ストレート", 4], ["スリーカード", 3], ["ツーペア", 2], ["ワンペア（J以上）", 1]];
  function evalPoker(cs) {
    const counts = {};
    cs.forEach(c => (counts[c.r] = (counts[c.r] || 0) + 1));
    const freq = Object.values(counts).sort((a, b) => b - a).join("");
    const uniq = Object.keys(counts).map(Number).sort((a, b) => a - b);
    const flush = new Set(cs.map(c => c.s)).size === 1;
    const straight = uniq.length === 5 && (uniq[4] - uniq[0] === 4 || uniq.join() === "2,3,4,5,14");
    if (straight && flush) return uniq[0] === 10 ? 0 : 1;
    if (freq === "41") return 2;
    if (freq === "32") return 3;
    if (flush) return 4;
    if (straight) return 5;
    if (freq === "311") return 6;
    if (freq === "221") return 7;
    if (freq === "2111") return +Object.keys(counts).find(r => counts[r] === 2) >= 11 ? 8 : -1;
    return -1;
  }
  const PK = { deck: [], hand: [], held: [], phase: "idle", bet: 0 };
  const pk = { hand: $("#pk-hand"), msg: $("#pk-msg"), main: $("#pk-main"), pay: $("#pk-pay") };
  const pkBar = makeBetBar($("#pk-bet"));
  pk.pay.innerHTML = PT.map(([n, m], i) => `<tr data-i="${i}"><td>${n}</td><td>×${m}</td></tr>`).join("");
  function pkRender(stay = []) {
    if (!PK.hand.length) {
      pk.hand.innerHTML = Array.from({ length: 5 }, () => `<div class="pk-slot">${cardHTML(null, true, "stay")}<span class="tag">HOLD</span></div>`).join("");
    } else {
      pk.hand.innerHTML = PK.hand.map((c, i) =>
        `<button class="pk-slot" data-i="${i}" aria-pressed="${PK.held[i]}" ${PK.phase !== "draw" ? "disabled" : ""}>${cardHTML(c, false, stay[i] ? "stay" : "")}<span class="tag">HOLD</span></button>`
      ).join("");
    }
    pk.main.textContent = PK.phase === "draw" ? "交換する" : "配る";
    pkBar.lock(PK.phase === "draw");
  }
  function markPay(i) {
    pk.pay.querySelectorAll("tr").forEach(tr => tr.classList.toggle("hit", +tr.dataset.i === i));
  }
  pk.hand.onclick = e => {
    const b = e.target.closest("button.pk-slot");
    if (!b || PK.phase !== "draw") return;
    const i = +b.dataset.i;
    PK.held[i] = !PK.held[i];
    b.setAttribute("aria-pressed", String(PK.held[i]));
  };
  pk.main.onclick = () => {
    if (PK.phase !== "draw") {
      const bet = pkBar.bet;
      if (!checkBet(bet, pk.msg)) return;
      PK.bet = bet; PK.deck = newDeck(); PK.hand = Array.from({ length: 5 }, () => PK.deck.pop());
      PK.held = [false, false, false, false, false]; PK.phase = "draw";
      pkRender();
      const i = evalPoker(PK.hand);
      markPay(i);
      say(pk.msg, `今の役: ${i >= 0 ? PT[i][0] : "役なし"}。残すカードをタップして「交換する」。`);
    } else {
      const stay = PK.held.slice();
      PK.hand = PK.hand.map((c, i) => (PK.held[i] ? c : PK.deck.pop()));
      PK.phase = "done";
      pkRender(stay);
      const i = evalPoker(PK.hand);
      markPay(i);
      const payout = i >= 0 ? PK.bet * PT[i][1] : 0;
      pay(payout);
      const [t, k] = resultText(PK.bet, payout);
      say(pk.msg, `${i >= 0 ? PT[i][0] : "役なし"}。 ${t}`, k);
    }
  };
  pkRender();
};
