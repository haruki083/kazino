"""ルーレット（ヨーロピアン式: 0〜36）。"""

from __future__ import annotations

import random

from casino import ui
from casino.wallet import Wallet

RED = {1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36}

# 賭け方: メニュー番号 -> (種類, 表示名)
BET_MENU = {
    1: ("number", "数字ひとつ"),
    2: ("red", "赤"),
    3: ("black", "黒"),
    4: ("even", "偶数"),
    5: ("odd", "奇数"),
    6: ("low", "前半 (1-18)"),
    7: ("high", "後半 (19-36)"),
    8: ("dozen", "ダース (1-12 / 13-24 / 25-36)"),
}
# 払い戻し倍率（賭け金込み）
RETURN = {"number": 36, "red": 2, "black": 2, "even": 2, "odd": 2,
          "low": 2, "high": 2, "dozen": 3}


def color(n: int) -> str:
    if n == 0:
        return "緑"
    return "赤" if n in RED else "黒"


def wins(bet_type: str, value: int | None, n: int) -> bool:
    if bet_type == "number":
        return n == value
    if n == 0:
        return False  # 0 は数字賭け以外すべて負け
    return {
        "red": n in RED,
        "black": n not in RED,
        "even": n % 2 == 0,
        "odd": n % 2 == 1,
        "low": n <= 18,
        "high": n >= 19,
        "dozen": (n - 1) // 12 + 1 == value,
    }[bet_type]


def spin(rng: random.Random) -> int:
    return rng.randint(0, 36)


def _ask_bet_type() -> tuple[str, int | None, str]:
    print("  賭け方を選んでください:")
    for key, (bet_type, label) in BET_MENU.items():
        print(f"    {key}. {label}  （x{RETURN[bet_type]}）")
    bet_type, label = BET_MENU[ui.ask_int("  番号: ", 1, len(BET_MENU))]
    value = None
    if bet_type == "number":
        value = ui.ask_int("  どの数字に賭けますか？ (0-36): ", 0, 36)
        label = f"数字 {value}"
    elif bet_type == "dozen":
        value = ui.ask_int("  どのダース？ 1:1-12 / 2:13-24 / 3:25-36: ", 1, 3)
        label = f"ダース {value}"
    return bet_type, value, label


def play(wallet: Wallet, rng: random.Random | None = None) -> None:
    rng = rng or random.Random()
    ui.title("🎡 ルーレット 🎡")
    print("  0〜36 のどこにボールが落ちるか予想しよう。")
    while True:
        print()
        ui.show_balance(wallet)
        bet = ui.ask_bet(wallet)
        if bet is None:
            return
        bet_type, value, label = _ask_bet_type()
        wallet.withdraw(bet)
        n = spin(rng)
        print(f"\n  「{label}」に {bet} 枚。ボールは… {n} （{color(n)}）！")
        payout = bet * RETURN[bet_type] if wins(bet_type, value, n) else 0
        wallet.deposit(payout)
        ui.show_result(bet, payout)
        wallet.save()
