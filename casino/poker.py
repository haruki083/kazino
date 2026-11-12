"""ビデオポーカー（ジャックス・オア・ベター）。"""

from __future__ import annotations

import random
from collections import Counter

from casino import ui
from casino.cards import Card, Deck
from casino.wallet import Wallet

# (役名, 払い戻し倍率（賭け金込み）)
ROYAL_FLUSH = ("ロイヤルストレートフラッシュ", 250)
STRAIGHT_FLUSH = ("ストレートフラッシュ", 50)
FOUR_OF_A_KIND = ("フォーカード", 25)
FULL_HOUSE = ("フルハウス", 9)
FLUSH = ("フラッシュ", 6)
STRAIGHT = ("ストレート", 4)
THREE_OF_A_KIND = ("スリーカード", 3)
TWO_PAIR = ("ツーペア", 2)
JACKS_OR_BETTER = ("ワンペア (J以上)", 1)
NOTHING = ("役なし", 0)

PAYTABLE = [ROYAL_FLUSH, STRAIGHT_FLUSH, FOUR_OF_A_KIND, FULL_HOUSE, FLUSH,
            STRAIGHT, THREE_OF_A_KIND, TWO_PAIR, JACKS_OR_BETTER]


def evaluate(cards: list[Card]) -> tuple[str, int]:
    ranks = [c.rank for c in cards]
    counts = Counter(ranks)
    freq = sorted(counts.values(), reverse=True)
    unique = sorted(counts)
    is_flush = len({c.suit for c in cards}) == 1
    is_straight = len(unique) == 5 and (
        unique[-1] - unique[0] == 4 or unique == [2, 3, 4, 5, 14]
    )

    if is_straight and is_flush:
        return ROYAL_FLUSH if unique[0] == 10 else STRAIGHT_FLUSH
    if freq[0] == 4:
        return FOUR_OF_A_KIND
    if freq == [3, 2]:
        return FULL_HOUSE
    if is_flush:
        return FLUSH
    if is_straight:
        return STRAIGHT
    if freq[0] == 3:
        return THREE_OF_A_KIND
    if freq == [2, 2, 1]:
        return TWO_PAIR
    if freq[0] == 2:
        pair_rank = next(r for r, c in counts.items() if c == 2)
        return JACKS_OR_BETTER if pair_rank >= 11 else NOTHING
    return NOTHING


def parse_positions(text: str) -> set[int] | None:
    """'2 4' や '24' をカードの位置 {1, 3} に変換する。不正なら None。"""
    digits = text.replace(",", " ").replace(" ", "")
    if not all(ch in "12345" for ch in digits):
        return None
    return {int(ch) - 1 for ch in digits}


def _show(cards: list[Card], swaps: set[int] = frozenset()) -> None:
    print("  " + "  ".join(f"[{i + 1}]{c}" for i, c in enumerate(cards)))
    if swaps:
        print("  交換: " + " ".join(str(i + 1) for i in sorted(swaps)))


def play_round(wallet: Wallet, deck: Deck, bet: int) -> tuple[str, int]:
    wallet.withdraw(bet)
    deck.reset()
    hand = [deck.draw() for _ in range(5)]
    print()
    _show(hand)
    print(f"  今の役: {evaluate(hand)[0]}")
    while True:
        swaps = parse_positions(input("  交換するカードの番号（例: 2 4、空欄なら交換しない）: "))
        if swaps is not None:
            break
        print("  1〜5 の数字で入力してください。")
    hand = [deck.draw() if i in swaps else c for i, c in enumerate(hand)]
    print("\n  交換後:")
    _show(hand)
    name, mult = evaluate(hand)
    payout = bet * mult
    wallet.deposit(payout)
    print(f"  役: {name}")
    ui.show_result(bet, payout)
    return name, payout


def play(wallet: Wallet, rng: random.Random | None = None) -> None:
    ui.title("🃏 ビデオポーカー 🃏")
    print("  5枚配られたら、交換したいカードを選んで1回だけ交換できます。")
    print("  配当（賭け金に対する倍率）:")
    for name, mult in PAYTABLE:
        print(f"    {ui.pad(name, 30)} x{mult}")
    deck = Deck(rng)
    while True:
        print()
        ui.show_balance(wallet)
        bet = ui.ask_bet(wallet)
        if bet is None:
            return
        play_round(wallet, deck, bet)
        wallet.save()
