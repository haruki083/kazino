"""入力・表示まわりの共通処理。"""

from __future__ import annotations

import unicodedata

from casino.wallet import Wallet

MIN_BET = 10


def ask_int(prompt: str, lo: int, hi: int) -> int:
    while True:
        text = input(prompt).strip()
        try:
            value = int(text)
        except ValueError:
            print("  数字を入力してください。")
            continue
        if lo <= value <= hi:
            return value
        print(f"  {lo}〜{hi} の範囲で入力してください。")


def ask_choice(prompt: str, choices: list[str]) -> str:
    """choices のどれかが入力されるまで聞き直す（小文字で返す）。"""
    while True:
        text = input(prompt).strip().lower()
        if text in choices:
            return text
        print(f"  {' / '.join(choices)} のどれかを入力してください。")


def ask_bet(wallet: Wallet, minimum: int = MIN_BET) -> int | None:
    """賭け金を聞く。0 またはチップ不足なら None を返す。"""
    if wallet.balance < minimum:
        print(f"  チップが足りません（最低 {minimum} 枚必要です）。")
        return None
    while True:
        bet = ask_int(f"  賭け金 ({minimum}〜{wallet.balance}、0 で戻る): ", 0, wallet.balance)
        if bet == 0:
            return None
        if bet >= minimum:
            return bet
        print(f"  最低 {minimum} 枚から賭けられます。")


def pad(text: str, width: int) -> str:
    """全角文字を2文字分として数え、表示幅 width になるよう右を空白で埋める。"""
    used = sum(2 if unicodedata.east_asian_width(ch) in "WF" else 1 for ch in text)
    return text + " " * max(width - used, 0)


def title(text: str) -> None:
    line = "=" * 40
    print(f"\n{line}\n  {text}\n{line}")


def show_balance(wallet: Wallet) -> None:
    print(f"  所持チップ: {wallet.balance} 枚")


def show_result(bet: int, payout: int) -> None:
    diff = payout - bet
    if diff > 0:
        print(f"  ★ +{diff} 枚の勝ち！（払い戻し {payout} 枚）")
    elif diff == 0:
        print(f"  引き分け。賭け金 {bet} 枚が戻りました。")
    else:
        print(f"  {-diff} 枚の負け…")
