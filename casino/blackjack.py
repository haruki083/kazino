"""ブラックジャック。"""

from __future__ import annotations

import random

from casino import ui
from casino.cards import Card, Deck, format_hand
from casino.wallet import Wallet

# 賭け金に対する払い戻し倍率（賭け金込み）
PAYOUT = {"blackjack": 3.0, "win": 2.0, "push": 1.0, "lose": 0.0}
MESSAGES = {
    "blackjack": "ブラックジャック！ 2倍の配当です。",
    "win": "あなたの勝ち！",
    "push": "引き分け（プッシュ）。",
    "lose": "ディーラーの勝ち。",
}
RESHUFFLE_AT = 15


def card_value(card: Card) -> int:
    if card.rank == 14:
        return 11
    return min(card.rank, 10)


def hand_value(cards: list[Card]) -> int:
    total = sum(card_value(c) for c in cards)
    aces = sum(1 for c in cards if c.rank == 14)
    while total > 21 and aces:
        total -= 10  # A を 11 → 1 として数え直す
        aces -= 1
    return total


def is_blackjack(cards: list[Card]) -> bool:
    return len(cards) == 2 and hand_value(cards) == 21


def dealer_should_hit(cards: list[Card]) -> bool:
    """ディーラーは 17 以上でスタンド。"""
    return hand_value(cards) < 17


def settle(player: list[Card], dealer: list[Card]) -> str:
    p, d = hand_value(player), hand_value(dealer)
    if p > 21:
        return "lose"
    p_bj, d_bj = is_blackjack(player), is_blackjack(dealer)
    if p_bj and d_bj:
        return "push"
    if p_bj:
        return "blackjack"
    if d_bj:
        return "lose"
    if d > 21 or p > d:
        return "win"
    if p < d:
        return "lose"
    return "push"


def _show(label: str, cards: list[Card]) -> None:
    print(f"  {label}: {format_hand(cards)}  （{hand_value(cards)}）")


def play_round(wallet: Wallet, deck: Deck, bet: int) -> str:
    wallet.withdraw(bet)
    player = [deck.draw(), deck.draw()]
    dealer = [deck.draw(), deck.draw()]

    print(f"\n  ディーラー: {dealer[0]} ??")
    naturals = is_blackjack(player) or is_blackjack(dealer)

    while not naturals:
        _show("あなた", player)
        if hand_value(player) >= 21:
            break
        can_double = len(player) == 2 and wallet.can_afford(bet)
        options = ["h", "s"] + (["d"] if can_double else [])
        prompt = "  [h]ヒット / [s]スタンド" + (" / [d]ダブルダウン" if can_double else "") + ": "
        action = ui.ask_choice(prompt, options)
        if action == "s":
            break
        if action == "d":
            wallet.withdraw(bet)
            bet *= 2
            player.append(deck.draw())
            print(f"  ダブルダウン！ 賭け金 {bet} 枚。")
            break
        player.append(deck.draw())

    _show("あなた", player)
    if hand_value(player) > 21:
        print("  バースト！")
    elif not naturals:
        while dealer_should_hit(dealer):
            dealer.append(deck.draw())
    _show("ディーラー", dealer)
    if hand_value(dealer) > 21:
        print("  ディーラーがバースト！")

    outcome = settle(player, dealer)
    payout = int(bet * PAYOUT[outcome])
    wallet.deposit(payout)
    print(f"  {MESSAGES[outcome]}")
    ui.show_result(bet, payout)
    return outcome


def play(wallet: Wallet, rng: random.Random | None = None) -> None:
    ui.title("♠ ブラックジャック ♥")
    print("  21 に近い方が勝ち。21 を超えたら負け。")
    print("  ディーラーは 17 以上で止まります。ブラックジャックは 2 倍の配当。")
    deck = Deck(rng, decks=4)
    while True:
        print()
        ui.show_balance(wallet)
        if len(deck.cards) < RESHUFFLE_AT:
            deck.reset()
            print("  （山札をシャッフルしました）")
        bet = ui.ask_bet(wallet)
        if bet is None:
            return
        play_round(wallet, deck, bet)
        wallet.save()
