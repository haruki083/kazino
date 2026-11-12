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
  // game: どのゲームの結果か（ランキングのゲーム別収支に使う）
  function resultText(bet, payout, game) {
    if (W.onRound) W.onRound(bet, payout, game);
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
    if (W.balance < MIN_BET) { say(msgEl, "チップがなくなりました。「フロアに戻る」から1000枚に戻せます。", "lose"); return false; }
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
    const [t, k] = resultText(BJ.bet, payout, "blackjack");
    say(bj.msg, `${head} ${t}`, k);
  }
  bj.deal.onclick = bjDeal;
  bj.hit.onclick = bjHit;
  bj.stand.onclick = bjStand;
  bj.dbl.onclick = bjDouble;

  /* ---------- slots ---------- */
  // 絵柄
  const SLOT_SYMBOLS = [
    { s: "🍒", name: "チェリー" },
    { s: "🍋", name: "レモン" },
    { s: "🔔", name: "ベル" },
    { s: "⭐", name: "スター" },
    { s: "💎", name: "ダイヤ" },
    { s: "👑", name: "クラウン" },
  ];
  // 当たりの種類。chance = 出る確率（%）、mult = 賭け金に対する倍率、count = そろう数。
  // 先に当たりの種類をこの確率で決めて、それに合う絵柄をリールに表示する。
  // どれにも当たらなかった残りの確率がハズレ。
  const SLOT_PAYS = [
    { s: "👑", count: 3, chance: 0.006, mult: 1000 },
    { s: "💎", count: 3, chance: 0.05, mult: 150 },
    { s: "⭐", count: 3, chance: 0.2, mult: 60 },
    { s: "👑", count: 2, chance: 0.4, mult: 40 },
    { s: "🔔", count: 3, chance: 3, mult: 25 },
    { s: "🍋", count: 3, chance: 5, mult: 10 },
    { s: "🍒", count: 3, chance: 10, mult: 5 },
    { s: "🔔", count: 2, chance: 15, mult: 2.5 },
    { s: "🍒", count: 2, chance: 20, mult: 1.5 },
  ];
  const SYM = SLOT_SYMBOLS.map(x => [x.s]);
  const bySymbol = Object.fromEntries(SLOT_SYMBOLS.map(x => [x.s, x]));
  const payKey = p => p.s + p.count;
  const reels = [...document.querySelectorAll(".reel")];
  const slMsg = $("#sl-msg"), slBtn = $("#sl-spin"), slBar = makeBetBar($("#sl-bet"));

  // 配当表（表の確率は SLOT_PAYS の値そのまま）
  const slotRtp = SLOT_PAYS.reduce((a, p) => a + (p.chance / 100) * p.mult, 0);
  const loseChance = 100 - SLOT_PAYS.reduce((a, p) => a + p.chance, 0);
  $("#sl-pay").innerHTML = `<thead><tr><th>そろい方</th><th>確率</th><th>配当</th></tr></thead><tbody>`
    + [...SLOT_PAYS].sort((a, b) => b.mult - a.mult).map(p =>
      `<tr data-k="${payKey(p)}"><td>${p.count === 3 ? p.s.repeat(3) : `${p.s.repeat(2)} が2つ`}</td><td class="prob">${p.chance}%</td><td>×${p.mult.toLocaleString("ja-JP")}</td></tr>`).join("")
    + `<tr><td>ハズレ</td><td class="prob">${Number(loseChance.toFixed(3))}%</td><td>×0</td></tr>`
    + `</tbody><tfoot><tr><td colspan="3">払い戻し率 約${Math.round(slotRtp * 100).toLocaleString("ja-JP")}%（長く遊ぶと、賭けたチップのうち平均でこれだけ戻ります）</td></tr></tfoot>`;

  const randSym = (except = []) => {
    const pool = SLOT_SYMBOLS.map(x => x.s).filter(s => !except.includes(s));
    return pool[Math.floor(Math.random() * pool.length)];
  };
  // 3つのリールの絵柄から [倍率, 配当表のキー, そろった絵柄] を出す
  function slotMult(r) {
    const counts = {};
    r.forEach(s => (counts[s] = (counts[s] || 0) + 1));
    for (const p of SLOT_PAYS) if (counts[p.s] === p.count) return [p.mult, payKey(p), p.s];
    return [0, null, null];
  }
  // 当たりの種類を確率で決めて、それに合うリールの並びを作る
  function slotSpin() {
    let x = Math.random() * 100;
    for (const p of SLOT_PAYS) {
      if ((x -= p.chance) < 0) {
        if (p.count === 3) return [p.s, p.s, p.s];
        const r = [p.s, p.s, randSym([p.s])];
        for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
        return r;
      }
    }
    // ハズレ: どの当たりにもならない並びを作る
    for (;;) {
      const r = [randSym(), randSym(), randSym()];
      if (!slotMult(r)[0]) return r;
    }
  }
  slBtn.onclick = async () => {
    const bet = slBar.bet;
    if (!checkBet(bet, slMsg)) return;
    slBtn.disabled = true; slBar.lock(true);
    say(slMsg, " ");
    document.querySelectorAll("#sl-pay tr").forEach(tr => tr.classList.remove("hit"));
    const res = slotSpin();
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
    const [mult, key, sym] = slotMult(res);
    const payout = Math.floor(bet * mult); // ×2.5 などで端数が出たら切り捨て
    pay(payout);
    if (mult) {
      reels.forEach((r, i) => { if (res[i] === sym) r.classList.add("win"); });
      $(`#sl-pay tr[data-k="${key}"]`).classList.add("hit");
    }
    const [t, k] = resultText(bet, payout, "slots");
    const head = !mult ? "" : sym === "👑" && mult === SLOT_PAYS[0].mult ? "ジャックポット！！ " : `${bySymbol[sym].name} ×${mult}！ `;
    say(slMsg, head + t, k);
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
    const [t, k] = resultText(total, payout, "roulette");
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
  const PK = { deck: [], hand: [], swap: [], phase: "idle", bet: 0 }; // swap[i] = そのカードを交換するか
  const pk = { hand: $("#pk-hand"), msg: $("#pk-msg"), main: $("#pk-main"), pay: $("#pk-pay") };
  const pkBar = makeBetBar($("#pk-bet"));
  pk.pay.innerHTML = PT.map(([n, m], i) => `<tr data-i="${i}"><td>${n}</td><td>×${m}</td></tr>`).join("");
  function pkRender(stay = []) {
    if (!PK.hand.length) {
      pk.hand.innerHTML = Array.from({ length: 5 }, () => `<div class="pk-slot">${cardHTML(null, true, "stay")}<span class="tag">交換</span></div>`).join("");
    } else {
      pk.hand.innerHTML = PK.hand.map((c, i) =>
        `<button class="pk-slot" data-i="${i}" aria-pressed="${PK.swap[i]}" aria-label="${i + 1}枚目を交換する" ${PK.phase !== "draw" ? "disabled" : ""}>${cardHTML(c, false, stay[i] ? "stay" : "")}<span class="tag">交換</span></button>`
      ).join("");
    }
    pk.main.textContent = PK.phase === "draw" ? "交換しないで勝負" : "配る";
    pkBar.lock(PK.phase === "draw");
  }
  function markPay(i) {
    pk.pay.querySelectorAll("tr").forEach(tr => tr.classList.toggle("hit", +tr.dataset.i === i));
  }
  pk.hand.onclick = e => {
    const b = e.target.closest("button.pk-slot");
    if (!b || PK.phase !== "draw") return;
    const i = +b.dataset.i;
    PK.swap[i] = !PK.swap[i];
    b.setAttribute("aria-pressed", String(PK.swap[i]));
    const n = PK.swap.filter(Boolean).length;
    pk.main.textContent = n ? `${n}枚を交換する` : "交換しないで勝負";
  };
  pk.main.onclick = () => {
    if (PK.phase !== "draw") {
      const bet = pkBar.bet;
      if (!checkBet(bet, pk.msg)) return;
      PK.bet = bet; PK.deck = newDeck(); PK.hand = Array.from({ length: 5 }, () => PK.deck.pop());
      PK.swap = [false, false, false, false, false]; PK.phase = "draw";
      pkRender();
      const i = evalPoker(PK.hand);
      markPay(i);
      say(pk.msg, `今の役: ${i >= 0 ? PT[i][0] : "役なし"}。交換したいカードをタップして選んでください。`);
    } else {
      const stay = PK.swap.map(x => !x);
      PK.hand = PK.hand.map((c, i) => (PK.swap[i] ? PK.deck.pop() : c));
      PK.phase = "done";
      pkRender(stay);
      const i = evalPoker(PK.hand);
      markPay(i);
      const payout = i >= 0 ? PK.bet * PT[i][1] : 0;
      pay(payout);
      const [t, k] = resultText(PK.bet, payout, "poker");
      say(pk.msg, `${i >= 0 ? PT[i][0] : "役なし"}。 ${t}`, k);
    }
  };
  pkRender();

  /* ---------- baccarat ---------- */
  const BAC_RET = { player: 2, banker: 1.95, tie: 9 }; // 払い戻し倍率（賭け金込み）
  const BAC_NAMES = { player: "プレイヤー", banker: "バンカー", tie: "タイ" };
  const bacVal = c => (c.r === 14 ? 1 : c.r >= 10 ? 0 : c.r);
  const bacTotal = cs => cs.reduce((a, c) => a + bacVal(c), 0) % 10;
  // プレイヤーが3枚目を引いたかどうかと、その札で、バンカーが3枚目を引くかが決まる
  function bankerDraws(bt, p3) {
    if (!p3) return bt <= 5;
    const x = bacVal(p3);
    if (bt <= 2) return true;
    if (bt === 3) return x !== 8;
    if (bt === 4) return x >= 2 && x <= 7;
    if (bt === 5) return x >= 4 && x <= 7;
    if (bt === 6) return x === 6 || x === 7;
    return false;
  }
  const bac = {
    pv: $("#bac-pv"), bv: $("#bac-bv"), player: $("#bac-player"), banker: $("#bac-banker"),
    pside: $("#bac-pside"), bside: $("#bac-bside"), msg: $("#bac-msg"), spots: $("#bac-spots"),
    total: $("#bac-total"), chips: $("#bac-chips"), deal: $("#bac-deal"), clear: $("#bac-clear"),
    rebet: $("#bac-rebet"), road: $("#bac-road"),
  };
  let bacDeck = newDeck(8), bacDenom = 10, bacBusy = false, bacLast = null, bacDone = false;
  const bacBets = {}, bacRoad = [];
  bac.chips.innerHTML = chipsHTML(v => `aria-pressed="${v === bacDenom}" aria-label="${v}枚チップを選ぶ"`);
  bac.chips.onclick = e => {
    const b = e.target.closest(".chip");
    if (!b) return;
    bacDenom = +b.dataset.v;
    bac.chips.querySelectorAll(".chip").forEach(c => c.setAttribute("aria-pressed", String(c === b)));
  };
  const bacSum = () => Object.values(bacBets).reduce((a, b) => a + b, 0);
  function bacRender(won = new Set()) {
    bac.spots.querySelectorAll(".bac-spot").forEach(sp => {
      const amt = bacBets[sp.dataset.k];
      let st = sp.querySelector(".stake");
      if (!amt) { if (st) st.remove(); return; }
      if (!st) { st = document.createElement("span"); st.className = "stake"; sp.appendChild(st); }
      st.textContent = amt;
      st.classList.toggle("won", won.has(sp.dataset.k));
    });
    bac.total.textContent = bacSum();
    bac.deal.disabled = bacBusy || bacSum() === 0;
    bac.clear.disabled = bacBusy;
    bac.rebet.disabled = bacBusy || !bacLast;
    bac.road.innerHTML = bacRoad.map(r => `<span class="${r}" title="${BAC_NAMES[r]}">${{ player: "P", banker: "B", tie: "T" }[r]}</span>`).join("");
  }
  function bacReset() {
    for (const k in bacBets) delete bacBets[k];
    bacDone = false;
    bac.pside.classList.remove("win"); bac.bside.classList.remove("win");
  }
  bac.spots.onclick = e => {
    const sp = e.target.closest(".bac-spot");
    if (!sp || bacBusy) return;
    if (bacDone) { bacReset(); say(bac.msg, " "); }
    if (bacSum() + bacDenom > W.balance) return say(bac.msg, "チップが足りません。", "lose");
    bacBets[sp.dataset.k] = (bacBets[sp.dataset.k] || 0) + bacDenom;
    bacRender();
  };
  bac.clear.onclick = () => { bacReset(); say(bac.msg, "チップを選んで、プレイヤー・タイ・バンカーのどれかに置いてください。"); bacRender(); };
  bac.rebet.onclick = () => {
    const total = Object.values(bacLast).reduce((a, b) => a + b, 0);
    if (total > W.balance) return say(bac.msg, "同じ賭けをするにはチップが足りません。", "lose");
    bacReset();
    Object.assign(bacBets, bacLast);
    say(bac.msg, "前回と同じ賭けを置きました。");
    bacRender();
  };
  bac.deal.onclick = async () => {
    const total = bacSum();
    if (!total) return;
    if (!take(total)) return say(bac.msg, "チップが足りません。", "lose");
    bacBusy = true; bacLast = { ...bacBets };
    bac.pside.classList.remove("win"); bac.bside.classList.remove("win");
    if (bacDeck.length < 30) bacDeck = newDeck(8);
    // 先に結果まで決めてから、1枚ずつ見せる
    const d = () => bacDeck.pop();
    const P = [d()], B = [d()];
    P.push(d()); B.push(d());
    const natural = bacTotal(P) >= 8 || bacTotal(B) >= 8;
    let p3 = null, b3 = null;
    if (!natural) {
      if (bacTotal(P) <= 5) { p3 = d(); P.push(p3); }
      if (bankerDraws(bacTotal(B.slice(0, 2)), p3)) { b3 = d(); B.push(b3); }
    }
    say(bac.msg, " ");
    bacRender();
    const shown = { P: [], B: [] };
    const show = () => {
      renderHand(bac.player, shown.P); renderHand(bac.banker, shown.B);
      bac.pv.textContent = shown.P.length ? bacTotal(shown.P) : "";
      bac.bv.textContent = shown.B.length ? bacTotal(shown.B) : "";
    };
    show();
    for (const [side, card] of [["P", P[0]], ["B", B[0]], ["P", P[1]], ["B", B[1]]]) {
      await sleep(330);
      shown[side].push(card); show();
    }
    if (natural) say(bac.msg, "ナチュラル！");
    if (p3) { await sleep(650); shown.P.push(p3); show(); }
    if (b3) { await sleep(650); shown.B.push(b3); show(); }
    await sleep(300);
    const pt = bacTotal(P), bt = bacTotal(B);
    const outcome = pt > bt ? "player" : bt > pt ? "banker" : "tie";
    if (outcome !== "tie") (outcome === "player" ? bac.pside : bac.bside).classList.add("win");
    let payout = 0;
    const won = new Set();
    for (const [k, amt] of Object.entries(bacBets)) {
      if (k === outcome) { payout += Math.floor(amt * BAC_RET[k]); won.add(k); }
      else if (outcome === "tie") payout += amt; // タイのときはプレイヤー・バンカーへの賭けは戻る
    }
    pay(payout);
    bacRoad.push(outcome);
    if (bacRoad.length > 36) bacRoad.shift();
    const head = outcome === "tie" ? `タイ（${pt} 対 ${bt}）！` : `${BAC_NAMES[outcome]}の勝ち（${pt} 対 ${bt}）。`;
    const [t, k] = resultText(total, payout, "baccarat");
    say(bac.msg, `${head} ${t}`, k);
    bacBusy = false; bacDone = true;
    bacRender(won);
  };
  bacRender();

  /* ---------- keno ---------- */
  // KENO_PAYS[選んだ個数][当たった個数] = 払い戻し倍率（賭け金込み）。書いていない当たり数は配当なし
  const KENO_PAYS = {
    1: { 1: 3.6 },
    2: { 2: 15 },
    3: { 2: 2, 3: 45 },
    4: { 2: 1, 3: 6, 4: 150 },
    5: { 3: 3, 4: 20, 5: 650 },
    6: { 3: 2, 4: 6, 5: 90, 6: 1500 },
    7: { 3: 1, 4: 3, 5: 25, 6: 350, 7: 5000 },
    8: { 4: 2, 5: 12, 6: 100, 7: 1500, 8: 15000 },
    9: { 4: 1, 5: 5, 6: 50, 7: 350, 8: 4000, 9: 30000 },
    10: { 0: 2, 5: 3, 6: 20, 7: 150, 8: 1000, 9: 6000, 10: 100000 },
  };
  const KENO_MAX = 10;
  const comb = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; };
  // 80個から20個引いたとき、選んだ n 個のうち h 個が当たる確率
  const kenoProb = (n, h) => (comb(n, h) * comb(80 - n, 20 - h)) / comb(80, 20);
  const pct = p => { const v = p * 100; return `${v >= 10 ? v.toFixed(1) : Number(v.toPrecision(2))}%`; };
  const kn = { board: $("#keno-board"), status: $("#keno-status"), msg: $("#keno-msg"), draw: $("#keno-draw"), quick: $("#keno-quick"), clear: $("#keno-clear"), pay: $("#keno-pay") };
  const knBar = makeBetBar($("#keno-bet"));
  const picks = new Set();
  let knBusy = false, knDrawn = [];
  kn.board.innerHTML = Array.from({ length: 80 }, (_, i) => `<button class="kn" data-n="${i + 1}" aria-pressed="false">${i + 1}</button>`).join("");
  function knClearMarks() {
    knDrawn = [];
    kn.board.querySelectorAll(".kn").forEach(b => b.classList.remove("drawn", "hit"));
  }
  function knRender() {
    kn.board.querySelectorAll(".kn").forEach(b => b.setAttribute("aria-pressed", String(picks.has(+b.dataset.n))));
    const hits = knDrawn.filter(n => picks.has(n)).length;
    kn.status.textContent = `選んだ数字 ${picks.size} / ${KENO_MAX}` + (knDrawn.length ? ` ・ 抽選 ${knDrawn.length} / 20 ・ 当たり ${hits}` : "");
    kn.draw.disabled = knBusy || picks.size === 0;
    kn.quick.disabled = kn.clear.disabled = knBusy;
    knBar.lock(knBusy);
    const n = picks.size;
    if (!n) {
      kn.pay.innerHTML = `<tbody><tr><td colspan="3">数字を選ぶと、ここに配当表が出ます。</td></tr></tbody>`;
      return;
    }
    const table = KENO_PAYS[n];
    const rows = Object.keys(table).map(Number).sort((a, b) => b - a);
    const rtp = rows.reduce((a, h) => a + kenoProb(n, h) * table[h], 0);
    kn.pay.innerHTML = `<thead><tr><th>${n}個選んで</th><th>確率</th><th>配当</th></tr></thead><tbody>`
      + rows.map(h => `<tr data-h="${h}"><td>${h}個当たり</td><td class="prob">${pct(kenoProb(n, h))}</td><td>×${table[h].toLocaleString("ja-JP")}</td></tr>`).join("")
      + `</tbody><tfoot><tr><td colspan="3">払い戻し率 約${Math.round(rtp * 100)}%</td></tr></tfoot>`;
  }
  kn.board.onclick = e => {
    const b = e.target.closest(".kn");
    if (!b || knBusy) return;
    if (knDrawn.length) { knClearMarks(); say(kn.msg, " "); }
    const n = +b.dataset.n;
    if (picks.has(n)) picks.delete(n);
    else if (picks.size >= KENO_MAX) return say(kn.msg, `選べるのは${KENO_MAX}個までです。`, "lose");
    else picks.add(n);
    knRender();
  };
  kn.quick.onclick = () => {
    const count = picks.size || 5;
    picks.clear(); knClearMarks();
    const all = Array.from({ length: 80 }, (_, i) => i + 1);
    for (let i = 0; i < count; i++) { const j = i + Math.floor(Math.random() * (80 - i)); [all[i], all[j]] = [all[j], all[i]]; picks.add(all[i]); }
    say(kn.msg, `${count}個をおまかせで選びました。`);
    knRender();
  };
  kn.clear.onclick = () => { picks.clear(); knClearMarks(); say(kn.msg, "1〜80から、好きな数字を1〜10個選んでください。"); knRender(); };
  kn.draw.onclick = async () => {
    const bet = knBar.bet, n = picks.size;
    if (!n || !checkBet(bet, kn.msg)) return;
    knBusy = true; knClearMarks();
    kn.pay.querySelectorAll("tr").forEach(tr => tr.classList.remove("hit"));
    say(kn.msg, "抽選中…");
    knRender();
    const all = Array.from({ length: 80 }, (_, i) => i + 1);
    for (let i = 0; i < 20; i++) { const j = i + Math.floor(Math.random() * (80 - i)); [all[i], all[j]] = [all[j], all[i]]; }
    for (const num of all.slice(0, 20)) {
      await sleep(110);
      knDrawn.push(num);
      const b = kn.board.querySelector(`[data-n="${num}"]`);
      b.classList.add("drawn");
      if (picks.has(num)) b.classList.add("hit");
      knRender();
    }
    const hits = knDrawn.filter(x => picks.has(x)).length;
    const mult = KENO_PAYS[n][hits] || 0;
    const payout = Math.floor(bet * mult);
    pay(payout);
    const row = kn.pay.querySelector(`tr[data-h="${hits}"]`);
    if (row) row.classList.add("hit");
    const [t, k] = resultText(bet, payout, "keno");
    say(kn.msg, `${n}個中 ${hits}個当たり${mult ? `（×${mult}）！` : "。"} ${t}`, k);
    knBusy = false;
    knRender();
  };
  knRender();
};
