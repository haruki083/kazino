"""トランプのカードと山札。"""

from __future__ import annotations

import random
from dataclasses import dataclass

SUITS = ["♠", "♥", "♦", "♣"]
RANKS = range(2, 15)  # 11=J, 12=Q, 13=K, 14=A
RANK_LABELS = {11: "J", 12: "Q", 13: "K", 14: "A"}


@dataclass(frozen=True)
class Card:
    rank: int
    suit: str

    def __str__(self) -> str:
        return f"{RANK_LABELS.get(self.rank, str(self.rank))}{self.suit}"


class Deck:
    def __init__(self, rng: random.Random | None = None, decks: int = 1) -> None:
        self.rng = rng or random.Random()
        self.decks = decks
        self.cards: list[Card] = []
        self.reset()

    def reset(self) -> None:
        self.cards = [Card(r, s) for _ in range(self.decks) for s in SUITS for r in RANKS]
        self.rng.shuffle(self.cards)

    def draw(self) -> Card:
        if not self.cards:
            self.reset()
        return self.cards.pop()


def format_hand(cards: list[Card]) -> str:
    return " ".join(str(c) for c in cards)
