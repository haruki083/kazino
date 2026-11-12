/* 入口 → 会員カウンター → 扉 → カジノフロア の流れと、会員情報の表示・保存。 */

(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sleep = ms => new Promise(r => setTimeout(r, reduceMotion ? 0 : ms));
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const W = window.Wallet;
  const backend = window.createKazinoBackend();
  const GAMES = ["blackjack", "slots", "roulette", "poker"];
  const VIEWS = ["lobby", "ranking", ...GAMES];
  const START = 1000, DAILY_BONUS = 500, MIN_BET = 10;
  // 会員ランク: [この枚数以上, 名前, CSSクラス]。いま持っているチップで決まる（上から順に判定）
  const TIERS = [
    [5000000, "ブラック", "black"],
    [1000000, "プラチナ", "platinum"],
    [500000, "ゴールド", "gold"],
    [100000, "シルバー", "silver"],
    [10000, "ブロンズ", "bronze"],
    [0, "ノーマル", "normal"],
  ];
  const tierOf = b => TIERS.find(t => b >= t[0]);

  let profile = null;
  let booted = false;

  /* ---------- 画面切り替え ---------- */
  function showScreen(name) {
    ["entrance", "desk", "floor"].forEach(s => { $("#s-" + s).hidden = s !== name; });
    window.scrollTo(0, 0);
  }
  function currentView() {
    const h = location.hash.slice(1);
    return VIEWS.includes(h) ? h : "lobby";
  }
  function route() {
    if (!profile) return;
    const view = currentView();
    VIEWS.forEach(v => { $("#v-" + v).hidden = v !== view; });
    $("#crumb").hidden = view === "lobby";
    $("#crumb-title").textContent = { lobby: "", ranking: "ハイローラーズ", blackjack: "ブラックジャック", slots: "スロット", roulette: "ルーレット", poker: "ビデオポーカー" }[view];
    if (view === "ranking") loadRanking();
    if (view === "lobby") renderLobby();
    window.scrollTo(0, 0);
  }
  addEventListener("hashchange", () => { if (!$("#s-floor").hidden) route(); });

  /* ---------- 会員カード ---------- */
  function memberCardHTML(p) {
    const [, label, cls] = tierOf(p.balance);
    const no = String(p.memberNo || "00000000");
    return `<div class="mcard t-${cls}">
      <div class="mcard-top"><span class="mcard-brand">KAZINO</span><span class="mcard-tier">${label}</span></div>
      <div class="mcard-chip" aria-hidden="true"></div>
      <div class="mcard-no">${no.slice(0, 4)} ${no.slice(4)}</div>
      <div class="mcard-bottom"><span class="mcard-name">${esc(p.name)}</span><span><b data-balance>${p.balance.toLocaleString("ja-JP")}</b> 枚</span></div>
      <p class="mcard-club">PLAYERS CLUB MEMBER</p>
    </div>`;
  }
  function renderMember() {
    if (!profile) return;
    const [, label, cls] = tierOf(W.balance);
    $("#m-name").textContent = profile.name;
    const badge = $("#m-tier");
    badge.textContent = label;
    badge.className = "tier-badge t-" + cls;
    $("#rescue").hidden = W.balance >= MIN_BET;
  }
  function renderLobby() {
    if (!profile) return;
    $("#lobby-hi").textContent = `ようこそ、${profile.name} 様`;
    $("#lobby-card").innerHTML = memberCardHTML({ ...profile, balance: W.balance });
    const got = profile.lastBonus === window.kazinoToday();
    const bonus = $("#bonus");
    bonus.disabled = got;
    bonus.textContent = got ? "本日のボーナスは受け取り済み" : `本日のボーナス +${DAILY_BONUS}枚を受け取る`;
    const rate = profile.played ? Math.round((profile.wins / profile.played) * 100) : 0;
    $("#stats").innerHTML = `
      <div><dt>プレイ回数</dt><dd>${profile.played}</dd></div>
      <div><dt>勝率</dt><dd>${rate}%</dd></div>
      <div><dt>最大勝ち</dt><dd>${profile.biggestWin.toLocaleString("ja-JP")}</dd></div>`;
    $("#game-stats").innerHTML = Object.entries(GAME_NAMES).map(([id, label]) => {
      const g = profile.games[id];
      const cls = g.net > 0 ? "plus" : g.net < 0 ? "minus" : "";
      return `<li><span>${label}</span><b class="${cls}">${g.played ? signed(g.net) : "—"}</b></li>`;
    }).join("");
    renderMember();
  }

  /* ---------- チップの保存 ---------- */
  W.onChange = b => {
    if (!profile) return;
    profile.balance = b;
    backend.save(profile);
    renderMember();
  };
  W.onRound = (bet, payout, game) => {
    if (!profile) return;
    profile.played += 1;
    if (payout > bet) {
      profile.wins += 1;
      profile.biggestWin = Math.max(profile.biggestWin, payout - bet);
    }
    const g = profile.games && profile.games[game];
    if (g) {
      g.played += 1;
      g.net += payout - bet;
      if (payout > bet) g.wins += 1;
    }
    backend.save(profile);
  };
  $("#bonus").onclick = () => {
    if (profile.lastBonus === window.kazinoToday()) return;
    profile.lastBonus = window.kazinoToday();
    W.pay(DAILY_BONUS);
    renderLobby();
  };
  $("#rescue").onclick = () => {
    W.set(START);
    renderLobby();
  };

  /* ---------- ランキング ---------- */
  const GAME_NAMES = { blackjack: "ブラックジャック", slots: "スロット", roulette: "ルーレット", poker: "ビデオポーカー" };
  const signed = n => (n > 0 ? "+" : n < 0 ? "−" : "±") + Math.abs(n).toLocaleString("ja-JP");
  let rankKind = "total";
  document.querySelectorAll(".rank-tabs button").forEach(b => {
    b.onclick = () => { rankKind = b.dataset.kind; loadRanking(); };
  });
  async function loadRanking() {
    document.querySelectorAll(".rank-tabs button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.kind === rankKind)));
    const total = rankKind === "total";
    $("#rank-head").innerHTML = total
      ? `<tr><th>#</th><th>名前</th><th>ランク</th><th class="num">チップ</th></tr>`
      : `<tr><th>#</th><th>名前</th><th class="num">プレイ</th><th class="num">収支</th></tr>`;
    $("#rank-caption").textContent = total
      ? "いま持っているチップが多い順"
      : `${GAME_NAMES[rankKind]}で勝った枚数（収支 = 払い戻し − 賭け金）が多い順。遊んだ人だけ表示します`;
    const body = $("#rank-body");
    body.innerHTML = `<tr><td colspan="4" class="rank-note">読み込み中…</td></tr>`;
    const kind = rankKind;
    try {
      const rows = await backend.leaderboard(kind);
      if (kind !== rankKind) return; // 読み込み中に別のタブが押された
      if (!rows.length) {
        body.innerHTML = `<tr><td colspan="4" class="rank-note">${total ? "まだ誰もいません。" : "まだ誰も遊んでいません。"}</td></tr>`;
        return;
      }
      body.innerHTML = rows.map((r, i) => {
        const me = profile && r.memberNo === profile.memberNo;
        const name = `<td>${esc(r.name)}${me ? "（あなた）" : ""}</td>`;
        if (total) {
          const [, label, cls] = tierOf(r.balance);
          return `<tr class="${me ? "me" : ""}"><td class="rank-no">${i + 1}</td>${name}<td><span class="tier-badge t-${cls}">${label}</span></td><td class="num">${Number(r.balance).toLocaleString("ja-JP")}</td></tr>`;
        }
        const g = r.games[kind];
        const cls = g.net > 0 ? "plus" : g.net < 0 ? "minus" : "";
        return `<tr class="${me ? "me" : ""}"><td class="rank-no">${i + 1}</td>${name}<td class="num">${g.played.toLocaleString("ja-JP")}回</td><td class="num ${cls}">${signed(g.net)}</td></tr>`;
      }).join("");
    } catch (e) {
      body.innerHTML = `<tr><td colspan="4" class="rank-note">ランキングを読み込めませんでした。</td></tr>`;
      console.error(e);
    }
  }

  /* ---------- 入口 ---------- */
  function renderEntrance() {
    $("#ent-greet").textContent = profile ? `おかえりなさいませ、${profile.name} 様` : "";
    $("#ent-join").textContent = profile ? "別のアカウントで入る" : "会員登録（1000枚プレゼント）";
  }
  $("#ent-enter").onclick = () => (profile ? walkIn() : openDesk("login"));
  $("#ent-join").onclick = async () => {
    if (profile) await backend.logout();
    openDesk(profile ? "login" : "register");
  };
  $("#mode-note").textContent = backend.mode === "firebase"
    ? "オンライン会員システム：どの端末からでも同じアカウントで遊べます"
    : "オフラインモード：アカウントはこのブラウザの中にだけ保存されます";

  /* ---------- 会員カウンター ---------- */
  const deskMsg = $("#desk-msg");
  function openDesk(tab) {
    $("#new-card").hidden = true;
    $("#desk-forms").hidden = false;
    setTab(tab);
    deskMsg.textContent = "";
    showScreen("desk");
    const first = $(tab === "login" ? "#login-email" : "#reg-name");
    if (first) first.focus();
  }
  function setTab(tab) {
    document.querySelectorAll(".desk-tabs button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
    $("#f-login").hidden = tab !== "login";
    $("#f-register").hidden = tab !== "register";
    deskMsg.textContent = "";
  }
  document.querySelectorAll(".desk-tabs button").forEach(b => (b.onclick = () => setTab(b.dataset.tab)));
  $("#desk-back").onclick = () => { renderEntrance(); showScreen("entrance"); };

  async function submitting(form, fn) {
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    deskMsg.textContent = "";
    try { await fn(); } catch (e) { deskMsg.textContent = e.message; } finally { btn.disabled = false; }
  }
  $("#f-login").addEventListener("submit", e => {
    e.preventDefault();
    submitting(e.target, async () => {
      await backend.login($("#login-email").value, $("#login-pass").value);
      $("#login-pass").value = "";
      walkIn();
    });
  });
  /* ニックネームが使えるか、入力しながら確かめる */
  const nameHint = $("#reg-name-hint");
  const HINT_DEFAULT = "ほかの人と同じ名前は使えません。";
  let nameTimer = null, nameSeq = 0;
  function setHint(text, kind = "") { nameHint.textContent = text; nameHint.className = "field-hint" + (kind ? " " + kind : ""); }
  $("#reg-name").addEventListener("input", () => {
    clearTimeout(nameTimer);
    const name = $("#reg-name").value.trim();
    const seq = ++nameSeq;
    if (!name) return setHint(HINT_DEFAULT);
    const err = window.kazinoNameError(name);
    if (err) return setHint(err, "ng");
    setHint("確認中…");
    nameTimer = setTimeout(async () => {
      try {
        const ok = await backend.isNameAvailable(name);
        if (seq !== nameSeq) return; // 入力が変わっていたら古い結果は捨てる
        setHint(ok ? `「${name}」は使えます` : "この名前はすでに使われています", ok ? "ok" : "ng");
      } catch (e) {
        if (seq === nameSeq) setHint(HINT_DEFAULT);
      }
    }, 400);
  });

  $("#f-register").addEventListener("submit", e => {
    e.preventDefault();
    const name = $("#reg-name").value.trim();
    const pass = $("#reg-pass").value;
    const nameErr = window.kazinoNameError(name);
    if (nameErr) { deskMsg.textContent = nameErr; return; }
    if (pass.length < 6) { deskMsg.textContent = "パスワードは6文字以上にしてください。"; return; }
    submitting(e.target, async () => {
      const p = await backend.register(name, $("#reg-email").value, pass);
      $("#reg-pass").value = "";
      $("#reg-name").value = "";
      setHint(HINT_DEFAULT);
      $("#desk-forms").hidden = true;
      $("#new-card").hidden = false;
      $("#new-card-slot").innerHTML = memberCardHTML(p);
      $("#new-card-enter").focus();
    });
  });
  $("#new-card-enter").onclick = () => walkIn();

  /* ---------- 入場（扉が開く） ---------- */
  async function walkIn() {
    const doors = $("#doors");
    doors.classList.remove("open");
    doors.hidden = false;
    await sleep(500);
    if (!VIEWS.includes(location.hash.slice(1))) history.replaceState(null, "", "#lobby");
    showScreen("floor");
    route();
    await sleep(60);
    doors.classList.add("open");
    await sleep(1300);
    doors.hidden = true;
    doors.classList.remove("open");
  }

  $("#logout").onclick = async () => {
    await backend.logout();
    history.replaceState(null, "", location.pathname + location.search);
    renderEntrance();
    showScreen("entrance");
  };

  /* ---------- ログイン状態の変化 ---------- */
  backend.onAuth(p => {
    profile = p;
    if (p) {
      W.set(p.balance, true);
      window.KazinoGames.start();
      W.render();
      renderMember();
    }
    if (!booted) {
      booted = true;
      // ゲーム画面などで再読み込みしたときは、そのままフロアへ
      if (p && VIEWS.includes(location.hash.slice(1))) { showScreen("floor"); route(); }
      else { renderEntrance(); showScreen("entrance"); }
      document.body.classList.add("ready");
    } else if (!p && !$("#s-floor").hidden) {
      renderEntrance();
      showScreen("entrance");
    } else {
      renderEntrance();
    }
  });
})();
