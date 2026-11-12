import random
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from casino import blackjack, poker, roulette, slots
from casino.cards import Card, Deck
from casino.wallet import Wallet


def cards(*specs: str) -> list[Card]:
    """'A♠', '10♥', 'K♦' のような表記からカードを作る。"""
    labels = {"J": 11, "Q": 12, "K": 13, "A": 14}
    return [Card(labels.get(s[:-1]) or int(s[:-1]), s[-1]) for s in specs]


class WalletTest(unittest.TestCase):
    def test_withdraw_and_deposit(self):
        w = Wallet(balance=100, path=Path("unused.json"))
        w.withdraw(30)
        w.deposit(10)
        self.assertEqual(w.balance, 80)
        with self.assertRaises(ValueError):
            w.withdraw(81)

    def test_save_and_load(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "save.json"
            Wallet(balance=1234, path=path).save()
            self.assertEqual(Wallet.load(path).balance, 1234)

    def test_load_broken_file_gives_new_wallet(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "save.json"
            path.write_text("not json")
            self.assertEqual(Wallet.load(path).balance, 1000)


class DeckTest(unittest.TestCase):
    def test_deck_has_52_unique_cards(self):
        deck = Deck(random.Random(0))
        self.assertEqual(len(set(deck.cards)), 52)


class BlackjackTest(unittest.TestCase):
    def test_hand_value_with_aces(self):
        self.assertEqual(blackjack.hand_value(cards("A♠", "K♥")), 21)
        self.assertEqual(blackjack.hand_value(cards("A♠", "A♥", "9♦")), 21)
        self.assertEqual(blackjack.hand_value(cards("A♠", "K♥", "5♦")), 16)

    def test_settle(self):
        s = blackjack.settle
        self.assertEqual(s(cards("A♠", "K♥"), cards("10♠", "9♥")), "blackjack")
        self.assertEqual(s(cards("A♠", "K♥"), cards("A♦", "Q♥")), "push")
        self.assertEqual(s(cards("10♠", "6♥", "9♦"), cards("10♦", "7♥")), "lose")
        self.assertEqual(s(cards("10♠", "8♥"), cards("10♦", "6♥", "9♣")), "win")
        self.assertEqual(s(cards("10♠", "8♥"), cards("10♦", "8♣")), "push")
        self.assertEqual(s(cards("7♠", "4♥", "10♦"), cards("A♦", "K♣")), "lose")

    def test_play_round_stand(self):
        w = Wallet(balance=100, path=Path("unused.json"))
        with patch("builtins.input", return_value="s"):
            outcome = blackjack.play_round(w, Deck(random.Random(1), decks=4), 10)
        self.assertEqual(w.balance, 100 - 10 + int(10 * blackjack.PAYOUT[outcome]))


class SlotsTest(unittest.TestCase):
    def test_payouts(self):
        self.assertEqual(slots.payout_multiplier(["👑", "👑", "👑"]), 1000)
        self.assertEqual(slots.payout_multiplier(["🍒", "🔔", "🍒"]), 1)
        self.assertEqual(slots.payout_multiplier(["👑", "👑", "🍋"]), 5)
        self.assertEqual(slots.payout_multiplier(["🔔", "🔔", "🍋"]), 0)
        self.assertEqual(slots.payout_multiplier(["🍒", "🔔", "🍋"]), 0)

    def test_rarer_symbols_pay_more(self):
        rows = [(w, three) for _, _, w, three, _ in slots.SYMBOLS]
        for (w1, t1), (w2, t2) in zip(rows, rows[1:]):
            self.assertGreater(w1, w2)
            self.assertLess(t1, t2)

    def test_return_rate(self):
        self.assertAlmostEqual(slots.return_rate(), 0.9618, places=3)

    def test_house_edge(self):
        rng = random.Random(42)
        n = 200_000
        rtp = sum(slots.payout_multiplier(slots.spin(rng)) for _ in range(n)) / n
        self.assertTrue(0.85 < rtp < 1.05, rtp)


class RouletteTest(unittest.TestCase):
    def test_wins(self):
        self.assertTrue(roulette.wins("number", 17, 17))
        self.assertTrue(roulette.wins("red", None, 1))
        self.assertTrue(roulette.wins("black", None, 2))
        self.assertTrue(roulette.wins("dozen", 3, 36))
        self.assertTrue(roulette.wins("high", None, 19))
        for bet in ("red", "black", "even", "odd", "low", "high"):
            self.assertFalse(roulette.wins(bet, None, 0))
        self.assertFalse(roulette.wins("dozen", 1, 0))

    def test_red_has_18_numbers(self):
        self.assertEqual(len(roulette.RED), 18)


class PokerTest(unittest.TestCase):
    def check(self, hand, expected):
        self.assertEqual(poker.evaluate(cards(*hand)), expected)

    def test_hands(self):
        self.check(["10♠", "J♠", "Q♠", "K♠", "A♠"], poker.ROYAL_FLUSH)
        self.check(["5♥", "6♥", "7♥", "8♥", "9♥"], poker.STRAIGHT_FLUSH)
        self.check(["9♠", "9♥", "9♦", "9♣", "2♠"], poker.FOUR_OF_A_KIND)
        self.check(["3♠", "3♥", "3♦", "K♣", "K♠"], poker.FULL_HOUSE)
        self.check(["2♦", "7♦", "9♦", "J♦", "K♦"], poker.FLUSH)
        self.check(["A♠", "2♥", "3♦", "4♣", "5♠"], poker.STRAIGHT)
        self.check(["7♠", "7♥", "7♦", "2♣", "K♠"], poker.THREE_OF_A_KIND)
        self.check(["4♠", "4♥", "8♦", "8♣", "K♠"], poker.TWO_PAIR)
        self.check(["J♠", "J♥", "2♦", "5♣", "9♠"], poker.JACKS_OR_BETTER)
        self.check(["10♠", "10♥", "2♦", "5♣", "9♠"], poker.NOTHING)
        self.check(["Q♠", "K♥", "A♦", "2♣", "3♠"], poker.NOTHING)

    def test_parse_holds(self):
        self.assertEqual(poker.parse_holds("1 3 5"), {0, 2, 4})
        self.assertEqual(poker.parse_holds("24"), {1, 3})
        self.assertEqual(poker.parse_holds(""), set())
        self.assertIsNone(poker.parse_holds("6"))


if __name__ == "__main__":
    unittest.main()
