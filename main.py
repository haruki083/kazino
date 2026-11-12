"""KAZINO — ターミナルで遊べるカジノ。 `python main.py` で起動。"""

from __future__ import annotations

from casino import blackjack, poker, roulette, slots, ui
from casino.ui import MIN_BET
from casino.wallet import START_BALANCE, Wallet

GAMES = {
    1: ("ブラックジャック", blackjack.play),
    2: ("スロット", slots.play),
    3: ("ルーレット", roulette.play),
    4: ("ビデオポーカー", poker.play),
}

BANNER = r"""
  _  __    _     _____  ___  _   _   ___
 | |/ /   / \   |__  / |_ _|| \ | | / _ \
 | ' /   / _ \    / /   | | |  \| || | | |
 | . \  / ___ \  / /_   | | | |\  || |_| |
 |_|\_\/_/   \_\/____| |___||_| \_| \___/
"""


def main() -> None:
    wallet = Wallet.load()
    print(BANNER)
    print("  ようこそ KAZINO へ！")
    try:
        while True:
            if wallet.balance < MIN_BET:
                print(f"\n  チップがなくなりました… {START_BALANCE} 枚にリセットします。")
                wallet.reset()
                wallet.save()
            ui.title("メニュー")
            ui.show_balance(wallet)
            for key, (name, _) in GAMES.items():
                print(f"    {key}. {name}")
            print("    0. セーブして終了")
            choice = ui.ask_int("  番号を選んでください: ", 0, len(GAMES))
            if choice == 0:
                break
            GAMES[choice][1](wallet)
    except (KeyboardInterrupt, EOFError):
        print()
    wallet.save()
    print(f"\n  所持チップ {wallet.balance} 枚でセーブしました。またのお越しを！")


if __name__ == "__main__":
    main()
