/* 会員アカウントの保存先。
   Firebase の設定があれば Firebase（どの端末からでも同じアカウント）、
   なければブラウザ内保存（オフラインモード）を使う。どちらも同じ形で呼び出せる:
     onAuth(cb) / register(name, email, pass) / login(email, pass) / logout() / save(profile) / leaderboard() */

(() => {
  const START = 1000;
  const FIELDS = ["name", "nameKey", "balance", "memberNo", "played", "wins", "biggestWin", "lastBonus"];
  const pick = p => Object.fromEntries(FIELDS.map(k => [k, p[k]]));

  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  // 文字列から8桁の会員番号を作る
  function memberNoFrom(s) {
    let h = 2166136261;
    for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
    return String(h % 100000000).padStart(8, "0");
  }
  function newProfile(name, memberNo) {
    return { name, nameKey: nameKey(name), balance: START, memberNo, played: 0, wins: 0, biggestWin: 0, lastBonus: "" };
  }
  // 名前の重複チェック用キー。全角/半角・大文字/小文字・空白の違いは同じ名前として扱う
  function nameKey(name) {
    return encodeURIComponent(String(name).normalize("NFKC").toLowerCase().replace(/\s+/g, ""));
  }
  // 名前として使えない場合は理由を返す（使えるなら空文字）
  function nameError(name) {
    const n = String(name).trim();
    if (!n) return "ニックネームを入力してください。";
    if ([...n].length > 12) return "ニックネームは12文字以内にしてください。";
    if (/[\/\\]/.test(n)) return "ニックネームに / や \\ は使えません。";
    const plain = n.normalize("NFKC").replace(/\s+/g, "");
    if (!plain || /^\.+$/.test(plain) || /^__.*__$/.test(plain)) return "このニックネームは使えません。";
    return "";
  }
  const TAKEN = "このニックネームはすでに使われています。別の名前にしてください。";

  /* ---------- オフラインモード（ブラウザ内保存） ---------- */
  function LocalBackend() {
    const ACC = "kazino.accounts", SES = "kazino.session";
    const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
    const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
    async function hash(pass) {
      const data = new TextEncoder().encode("kazino:" + pass);
      if (window.crypto && crypto.subtle) {
        const buf = await crypto.subtle.digest("SHA-256", data);
        return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
      }
      return memberNoFrom("kazino:" + pass) + pass.length;
    }
    let listener = null;
    const current = () => {
      const email = read(SES, null), acc = read(ACC, {});
      return email && acc[email] ? { ...acc[email].profile } : null;
    };
    return {
      mode: "local",
      onAuth(cb) { listener = cb; setTimeout(() => cb(current()), 0); },
      async register(name, email, pass) {
        email = email.trim().toLowerCase();
        const acc = read(ACC, {});
        if (acc[email]) throw new Error("このメールアドレスはもう登録されています。");
        if (!(await this.isNameAvailable(name))) throw new Error(TAKEN);
        const p = newProfile(name, memberNoFrom(email + Date.now()));
        acc[email] = { pass: await hash(pass), profile: p };
        write(ACC, acc);
        write(SES, email);
        if (listener) listener({ ...p });
        return { ...p };
      },
      async login(email, pass) {
        email = email.trim().toLowerCase();
        const acc = read(ACC, {});
        if (!acc[email] || acc[email].pass !== (await hash(pass))) throw new Error("メールアドレスかパスワードが違います。");
        write(SES, email);
        const p = { ...acc[email].profile };
        if (listener) listener(p);
        return p;
      },
      async logout() {
        try { localStorage.removeItem(SES); } catch (e) {}
        if (listener) listener(null);
      },
      save(p) {
        const email = read(SES, null), acc = read(ACC, {});
        if (email && acc[email]) { acc[email].profile = pick(p); write(ACC, acc); }
      },
      async isNameAvailable(name) {
        const key = nameKey(name);
        return !Object.values(read(ACC, {})).some(a => (a.profile.nameKey || nameKey(a.profile.name)) === key);
      },
      async leaderboard() {
        return Object.values(read(ACC, {})).map(a => a.profile).sort((a, b) => b.balance - a.balance).slice(0, 10);
      },
    };
  }

  /* ---------- Firebase（オンライン保存） ---------- */
  const MESSAGES = {
    "auth/email-already-in-use": "このメールアドレスはもう登録されています。",
    "auth/invalid-email": "メールアドレスの形が正しくありません。",
    "auth/weak-password": "パスワードは6文字以上にしてください。",
    "auth/invalid-credential": "メールアドレスかパスワードが違います。",
    "auth/invalid-login-credentials": "メールアドレスかパスワードが違います。",
    "auth/wrong-password": "メールアドレスかパスワードが違います。",
    "auth/user-not-found": "メールアドレスかパスワードが違います。",
    "auth/too-many-requests": "試行回数が多すぎます。しばらく待ってからもう一度お試しください。",
    "auth/network-request-failed": "インターネットにつながっていません。接続を確認してください。",
    "auth/operation-not-allowed": "Firebase でメール/パスワードのログインが有効になっていません（README の手順を確認してください）。",
    "permission-denied": "データベースに拒否されました。Firestore のルールを確認してください（README の手順を確認してください）。",
  };
  const message = e => MESSAGES[e && e.code] || `エラーが発生しました（${(e && (e.code || e.message)) || "不明"}）`;

  function FirebaseBackend(cfg) {
    firebase.initializeApp(cfg);
    const auth = firebase.auth(), db = firebase.firestore();
    const ref = id => db.collection("users").doc(id);
    const stamp = () => firebase.firestore.FieldValue.serverTimestamp();
    let listener = null, busy = false, uid = null, pending = null, timer = null;

    const nameRef = key => db.collection("usernames").doc(key);
    async function loadProfile(user) {
      const snap = await ref(user.uid).get();
      if (snap.exists) return snap.data();
      // 登録の途中で失敗して会員データがないアカウントは消して、登録し直せるようにする
      await user.delete().catch(() => auth.signOut());
      const e = new Error("会員情報が見つかりませんでした。お手数ですが、もう一度会員登録してください。");
      e.code = "kazino/no-profile";
      throw e;
    }
    function flush() {
      if (!pending || !uid) return;
      const data = pending;
      pending = null;
      clearTimeout(timer);
      ref(uid).update({ ...data, updatedAt: stamp() }).catch(e => console.error("チップの保存に失敗しました:", message(e)));
    }
    addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });

    return {
      mode: "firebase",
      onAuth(cb) {
        listener = cb;
        auth.onAuthStateChanged(async user => {
          if (busy) return; // 登録・ログイン中は、その処理側で通知する
          if (!user) { uid = null; cb(null); return; }
          uid = user.uid;
          try { cb(await loadProfile(user)); } catch (e) { console.error(e.message); cb(null); }
        });
      },
      async register(name, email, pass) {
        busy = true;
        let user = null;
        try {
          if (!(await this.isNameAvailable(name))) throw Object.assign(new Error(TAKEN), { code: "kazino/name-taken" });
          ({ user } = await auth.createUserWithEmailAndPassword(email.trim(), pass));
          const p = newProfile(name, memberNoFrom(user.uid));
          // 会員データと「使われた名前」を同時に書く。名前が先に取られていたらルールで両方失敗する
          const batch = db.batch();
          batch.set(ref(user.uid), { ...p, createdAt: stamp() });
          batch.set(nameRef(p.nameKey), { uid: user.uid, name: p.name, createdAt: stamp() });
          await batch.commit();
          await user.updateProfile({ displayName: name }).catch(() => {});
          uid = user.uid;
          if (listener) listener(p);
          return p;
        } catch (e) {
          // 名前の登録に失敗したら、作りかけのログイン情報を消してメールアドレスを使えるようにする
          if (user) {
            await user.delete().catch(() => auth.signOut());
            if (e.code === "permission-denied") throw new Error(TAKEN);
          }
          throw new Error(e.code && e.code.startsWith("kazino/") ? e.message : message(e));
        } finally {
          busy = false;
        }
      },
      async login(email, pass) {
        busy = true;
        try {
          const { user } = await auth.signInWithEmailAndPassword(email.trim(), pass);
          uid = user.uid;
          const p = await loadProfile(user);
          if (listener) listener(p);
          return p;
        } catch (e) {
          throw new Error(e.code && e.code.startsWith("kazino/") ? e.message : message(e));
        } finally {
          busy = false;
        }
      },
      async isNameAvailable(name) {
        const snap = await nameRef(nameKey(name)).get();
        return !snap.exists;
      },
      async logout() { flush(); await auth.signOut(); },
      save(p) { pending = pick(p); clearTimeout(timer); timer = setTimeout(flush, 800); },
      async leaderboard() {
        const qs = await db.collection("users").orderBy("balance", "desc").limit(10).get();
        return qs.docs.map(d => d.data());
      },
    };
  }

  window.kazinoToday = today;
  window.kazinoNameError = nameError;
  window.createKazinoBackend = () => {
    const cfg = window.KAZINO_FIREBASE_CONFIG;
    if (cfg && cfg.apiKey && window.firebase) {
      try { return FirebaseBackend(cfg); } catch (e) { console.error("Firebase を使えないのでオフラインモードで動きます:", e); }
    }
    return LocalBackend();
  };
})();
