"""スロットマシン（3リール）。"""

from __future__ import annotations

import random
import time

from casino import ui
from casino.wallet import Wallet

# (絵柄, 出やすさ)
SYMBOLS = [("🍒", 30), ("🍋", 25), ("🔔", 20), ("⭐", 12), ("💎", 8), ("👑", 5)]
# 3つそろったときの払い戻し倍率（賭け金込み）
THREE_OF_A_KIND = {"🍒": 5, "🍋": 10, "🔔": 15, "⭐": 30, "💎": 75, "👑": 200}
TWO_CHERRIES = 2

_NAMES = [s for s, _ in SYMBOLS]
_WEIGHTS = [w for _, w in SYMBOLS]


def spin(rng: random.Random) -> list[str]:
    return rng.choices(_NAMES, weights=_WEIGHTS, k=3)


def payout_multiplier(reels: list[str]) -> int:
    if len(set(reels)) == 1:
        return THREE_OF_A_KIND[reels[0]]
    if reels.count("🍒") == 2:
        return TWO_CHERRIES
    return 0


def _animate(rng: random.Random, final: list[str], animate: bool) -> None:
    if animate:
        for _ in range(12):
            print("\r  | " + " | ".join(rng.choices(_NAMES, k=3)) + " |", end="", flush=True)
            time.sleep(0.07)
    print("\r  | " + " | ".join(final) + " |")


def play(wallet: Wallet, rng: random.Random | None = None, animate: bool = True) -> None:
    rng = rng or random.Random()
    ui.title("🎰 スロットマシン 🎰")
    print("  配当（賭け金に対する倍率）:")
    for symbol, mult in THREE_OF_A_KIND.items():
        print(f"    {symbol}{symbol}{symbol}  x{mult}")
    print(f"    🍒が2つ  x{TWO_CHERRIES}")
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
