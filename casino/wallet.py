"""プレイヤーのチップ（所持金）を管理する。"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

START_BALANCE = 1000
SAVE_FILE = Path(__file__).resolve().parent.parent / "save_data.json"


@dataclass
class Wallet:
    balance: int = START_BALANCE
    path: Path = field(default=SAVE_FILE, repr=False)

    def can_afford(self, amount: int) -> bool:
        return 0 < amount <= self.balance

    def withdraw(self, amount: int) -> None:
        if not self.can_afford(amount):
            raise ValueError(f"チップが足りません（所持: {self.balance}, 必要: {amount}）")
        self.balance -= amount

    def deposit(self, amount: int) -> None:
        if amount < 0:
            raise ValueError("負の金額は入金できません")
        self.balance += amount

    def reset(self) -> None:
        self.balance = START_BALANCE

    def save(self) -> None:
        self.path.write_text(json.dumps({"balance": self.balance}), encoding="utf-8")

    @classmethod
    def load(cls, path: Path = SAVE_FILE) -> "Wallet":
        try:
            data = json.loads(Path(path).read_text(encoding="utf-8"))
            balance = int(data["balance"])
            if balance < 0:
                raise ValueError
            return cls(balance=balance, path=Path(path))
        except (OSError, ValueError, KeyError, TypeError):
            return cls(path=Path(path))
