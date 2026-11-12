"""スロットマシン（3リール）。"""

from __future__ import annotations

import random
import time

from casino import ui
from casino.wallet import Wallet

SYMBOLS = ["🍒", "🍋", "🔔", "⭐", "💎", "👑"]
NAMES = {"🍒": "チェリー", "🍋": "レモン", "🔔": "ベル", "⭐": "スター", "💎": "ダイヤ", "👑": "クラウン"}

# 当たりの種類: (絵柄, そろう数, 確率[%], 賭け金に対する倍率)
# 先に当たりの種類をこの確率で決めて、それに合う絵柄をリールに表示する。
# どれにも当たらなかった残りの確率がハズレ。
PAYS = [
    ("👑", 3, 0.006, 1000),
    ("💎", 3, 0.05, 150),
    ("⭐", 3, 0.2, 60),
    ("👑", 2, 0.4, 40),
    ("🔔", 3, 3, 25),
    ("🍋", 3, 5, 10),
    ("🍒", 3, 10, 5),
    ("🔔", 2, 15, 2.5),
    ("🍒", 2, 20, 1.5),
]


def payout_multiplier(reels: list[str]) -> float:
    for symbol, count, _, mult in PAYS:
        if reels.count(symbol) == count:
            return mult
    return 0


def spin(rng: random.Random) -> list[str]:
    x = rng.random() * 100
    for symbol, count, chance, _ in PAYS:
        x -= chance
        if x < 0:
            if count == 3:
                return [symbol] * 3
            reels = [symbol, symbol, rng.choice([s for s in SYMBOLS if s != symbol])]
            rng.shuffle(reels)
            return reels
    while True:  # ハズレ: どの当たりにもならない並び
        reels = [rng.choice(SYMBOLS) for _ in range(3)]
        if not payout_multiplier(reels):
            return reels


def paytable() -> list[tuple[str, float, float]]:
    """(そろい方, 確率, 倍率) の一覧を倍率の高い順に返す。確率は 0〜1。"""
    rows = [(symbol * 3 if count == 3 else f"{symbol * 2} が2つ", chance / 100, mult)
            for symbol, count, chance, mult in PAYS]
    return sorted(rows, key=lambda r: -r[2])


def percent(p: float) -> str:
    """確率（0〜1）を % 表記にする。"""
    return f"{p * 100:g}%"


def return_rate() -> float:
    """長く遊んだときの平均払い戻し率（1.0 = 100%）。"""
    return sum(p * mult for _, p, mult in paytable())


def _animate(rng: random.Random, final: list[str], animate: bool) -> None:
    if animate:
        for _ in range(12):
            print("\r  | " + " | ".join(rng.choices(SYMBOLS, k=3)) + " |", end="", flush=True)
            time.sleep(0.07)
    print("\r  | " + " | ".join(final) + " |")


def play(wallet: Wallet, rng: random.Random | None = None, animate: bool = True) -> None:
    rng = rng or random.Random()
    ui.title("🎰 スロットマシン 🎰")
    print("  配当表（そろい方 / 確率 / 倍率）:")
    for label, p, mult in paytable():
        print(f"    {ui.pad(label, 12)} {percent(p):>8} x{mult}")
    lose = 1 - sum(p for _, p, _ in paytable())
    print(f"    {ui.pad('ハズレ', 12)} {percent(round(lose, 6)):>8} x0")
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
        payout = int(bet * payout_multiplier(reels))  # ×2.5 などで端数が出たら切り捨て
        wallet.deposit(payout)
        ui.show_result(bet, payout)
        wallet.save()
