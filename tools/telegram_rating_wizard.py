"""Pure state machine for a one-account Telegram rating/review draft wizard.

No network access, no browser automation and no publishing side effects.
A future authenticated adapter must supply enabled_fields from the live DOM
and explicitly verify user confirmation before performing any submission.
"""
from dataclasses import dataclass, field
from typing import Literal

STAR = "⭐⭐⭐⭐⭐"
PHOTO_CHOICES = {
    "Y": "Фото соответствует",
    "N": "Чужое фото",
    "NetNaMeste": "На месте её не оказалось",
    "Druguy": "Предложили другую",
    "Dinamo": "Динамо",
}
OTHER_CHOICES = {
    "indi": {"yes": "Да", "no": "Нет", "neopr": "Не знаю"},
    "dispetcher": {"yes": "Да", "no": "Нет", "neopr": "Не знаю"},
    "mesto": {
        "me": "У меня", "she": "У неё", "hotel": "Отель",
        "sauna": "Сауна", "office": "Офис", "neopr": "Не знаю"
    },
}
FIELD_LABELS = {
    "grade28": "Общение по телефону",
    "grade5": "Соответствие фото",
    "grade_ttx": "Соответствие параметров",
    "grade6": "Отношение к клиенту",
    "grade1": "Общая оценка",
}
PHASES = ("choose_action", "ratings", "rating_preview", "review_text", "review_preview")

@dataclass
class Draft:
    profile_id: str
    action: Literal["rating", "review"] | None = None
    phase: str = "choose_action"
    enabled_fields: tuple[str, ...] = ()
    selected_fives: set[str] = field(default_factory=set)
    answers: dict[str, str] = field(default_factory=dict)
    photo_choice: str | None = None
    review_text: str = ""
    approved: bool = False

    def __post_init__(self):
        if not self.profile_id.isdigit() or not (1 <= len(self.profile_id) <= 9):
            raise ValueError("Profile ID must be 1-9 digits")

    def begin_rating(self, enabled_fields):
        """Accept only fields determined enabled in the live, authenticated form."""
        self.action, self.phase = "rating", "ratings"
        self.enabled_fields = tuple(dict.fromkeys(enabled_fields))
        self.selected_fives.clear()
        self.answers.clear()
        self.photo_choice = None
        self.approved = False

    def select_five(self, field_id, enabled=True):
        if self.phase != "ratings" or field_id not in self.enabled_fields:
            raise ValueError("This field cannot currently be rated")
        if field_id in OTHER_CHOICES:
            raise ValueError("Use an explicit choice instead of five stars")
        if enabled:
            self.selected_fives.add(field_id)
        else:
            self.selected_fives.discard(field_id)
        self.approved = False

    def set_choice(self, name, value):
        if self.phase != "ratings":
            raise ValueError("Not in rating phase")
        if name == "isFair" and value in PHOTO_CHOICES:
            self.photo_choice = value
            if value != "Y":
                self.selected_fives.clear()
                self.answers.clear()
        elif name in OTHER_CHOICES and name in self.enabled_fields and value in OTHER_CHOICES[name]:
            self.answers[name] = value
        else:
            raise ValueError("Choice unavailable")
        self.approved = False

    def rating_preview(self, labels):
        if self.phase != "ratings" or not self.photo_choice:
            raise ValueError("Photo status needs an explicit answer")
        if self.photo_choice != "Y" and self.selected_fives:
            raise ValueError("Incompatible ratings")
        self.phase = "rating_preview"
        lines = [f"Анкета №{self.profile_id}", "Фото: " + PHOTO_CHOICES[self.photo_choice]]
        for fid in self.enabled_fields:
            if fid in self.selected_fives:
                lines.append(f"{labels.get(fid, FIELD_LABELS.get(fid, fid))} — {STAR}")
            if fid in self.answers:
                lines.append(f"{labels.get(fid, fid)} — {OTHER_CHOICES[fid][self.answers[fid]]}")
        lines.append("Проверьте фактический опыт перед подтверждением.")
        return "\n".join(lines)

    def begin_review(self):
        self.action, self.phase, self.approved = "review", "review_text", False

    def set_review(self, text):
        if self.phase != "review_text":
            raise ValueError("Review entry is not active")
        text = text.strip()
        if not text:
            raise ValueError("Empty review")
        self.review_text, self.approved = text, False
        self.phase = "review_preview"
        return f"Анкета №{self.profile_id}\n\n{text}\n\nОтправляем?"

    def confirm(self):
        if self.phase not in ("rating_preview", "review_preview"):
            raise ValueError("Review selections before confirmation")
        self.approved = True
        # The external adapter MUST require a fresh, specific user confirmation;
        # approval is a signal, not a publishing operation.
        return {"profile_id": self.profile_id, "action": self.action,
                "ratings": {k: "5" for k in self.selected_fives},
                "answers": dict(self.answers), "isFair": self.photo_choice,
                "review_text": self.review_text if self.action == "review" else None}

    def cancel(self):
        self.approved = False
        self.phase = "choose_action"
