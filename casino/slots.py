"""スロットマシン（3リール）。"""

from __future__ import annotations

import random
import time

from casino import ui
from casino.wallet import Wallet

# 絵柄ごとの設定: (絵柄, 名前, 出やすさ, 3つそろったときの倍率, 2つそろったときの倍率)
# 倍率は賭け金込みの払い戻し。2つの倍率が 0 の絵柄は、2つでは配当なし。
SYMBOLS = [
    ("🍒", "チェリー", 32, 5, 1),
    ("🍋", "レモン", 26, 10, 0),
    ("🔔", "ベル", 18, 25, 0),
    ("⭐", "スター", 12, 60, 0),
    ("💎", "ダイヤ", 8, 150, 0),
    ("👑", "クラウン", 4, 1000, 5),
]
THREE_OF_A_KIND = {s: three for s, _, _, three, _ in SYMBOLS}
TWO_OF_A_KIND = {s: two for s, _, _, _, two in SYMBOLS if two}

_NAMES = [s for s, *_ in SYMBOLS]
_WEIGHTS = [w for _, _, w, _, _ in SYMBOLS]
_TOTAL = sum(_WEIGHTS)


def spin(rng: random.Random) -> list[str]:
    return rng.choices(_NAMES, weights=_WEIGHTS, k=3)


def payout_multiplier(reels: list[str]) -> int:
    if len(set(reels)) == 1:
        return THREE_OF_A_KIND[reels[0]]
    for symbol in set(reels):
        if reels.count(symbol) == 2 and symbol in TWO_OF_A_KIND:
            return TWO_OF_A_KIND[symbol]
    return 0


def paytable() -> list[tuple[str, float, int]]:
    """(そろい方, 確率, 倍率) の一覧を倍率の高い順に返す。"""
    rows = []
    for symbol, _, weight, three, two in SYMBOLS:
        p = weight / _TOTAL
        rows.append((symbol * 3, p ** 3, three))
        if two:
            rows.append((f"{symbol * 2} が2つ", 3 * p * p * (1 - p), two))
    return sorted(rows, key=lambda r: -r[2])


def return_rate() -> float:
    """長く遊んだときの平均払い戻し率（1.0 = 100%）。"""
    return sum(p * mult for _, p, mult in paytable())


def _animate(rng: random.Random, final: list[str], animate: bool) -> None:
    if animate:
        for _ in range(12):
            print("\r  | " + " | ".join(rng.choices(_NAMES, k=3)) + " |", end="", flush=True)
            time.sleep(0.07)
    print("\r  | " + " | ".join(final) + " |")


def play(wallet: Wallet, rng: random.Random | None = None, animate: bool = True) -> None:
    rng = rng or random.Random()
    ui.title("🎰 スロットマシン 🎰")
    print("  配当表（そろい方 / 確率 / 倍率）:")
    for label, p, mult in paytable():
        print(f"    {ui.pad(label, 12)} 1/{round(1 / p):<6} x{mult}")
    print(f"  払い戻し率 約{round(return_rate() * 100)}%")
    while True:
        print()
        ui.show_balance(wallet)
        bet = ui.ask_bet(wallet)
        if bet is None:
            return
        wallet.withdraw(bet)
        reels = spin(rng)
        _animate(rng, reels, animate)
        payout = bet * payout_multiplier(reels)
        wallet.deposit(payout)
        ui.show_result(bet, payout)
        wallet.save()
