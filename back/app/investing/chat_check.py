"""Checks a chat answer against the data the model was given, before it's shown.

Money amounts and percentages in the answer must appear in that data, allowing for the rounding the answer shows
("$850" for "$850.13", "12%" for "12.3%"). A ticker with a figure on the same line must appear in the data too:
otherwise the figure came from the model's memory. The check is plain code, so a correct answer costs nothing."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

_NUM = r"\d{1,3}(?:[,   ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?"
_SCALE = r"(?:k|K|к|К|m|M|bn|b|B|тис\.?|млн|млрд)"
_MONEY = re.compile(
    rf"(?:US\$|\$)\s?(?P<a>{_NUM})(?:\s?(?P<sa>{_SCALE})\b)?"
    rf"|(?P<b>{_NUM})(?:\s?(?P<sb>{_SCALE}))?\s?(?:\$|USD\b|дол)"
)
_PERCENT = re.compile(rf"(?P<n>{_NUM})\s?%")
_PLAIN = re.compile(r"\d[\d,]*(?:\.\d+)?")  # numbers in the data, which is written the English way
_SCALED = re.compile(rf"(?P<n>\d[\d,]*(?:\.\d+)?)\s?(?P<s>{_SCALE})(?!\w)")  # "100k" in a note, with or without a currency
_TICKER = re.compile(r"(?<![\w$&.])([A-Z]{2,5}(?:\.[A-Z]{1,2})?)(?![\w&])")
_MULTIPLIER = {"k": 1e3, "к": 1e3, "тис": 1e3, "m": 1e6, "млн": 1e6, "b": 1e9, "bn": 1e9, "млрд": 1e9}
# Capitals that read like tickers but are words: currencies, metrics, places, institutions.
_NOT_TICKERS = frozenset(
    """USD EUR UAH GBP CHF JPY ETF ETFS AI CEO CFO CTO EPS PE PEG IPO GDP ROE ROI ROA ROIC USA US EU UK NYSE NASDAQ DCA FX
    OK YTD TTM CAGR FCF EBIT EBITDA API ESG REIT REITS SP VAT IRA FOMO FY YOY QOQ CPI FED ATH NAV PS PB EV PT DIY FAQ
    ID IT HR PR TV GPU CPU AR VR ML LLM SEC IRS ISA ETN ADR OTC LTV TAM SAAS SAS NB PS""".split()
)


@dataclass
class Findings:
    figures: list[str] = field(default_factory=list)  # as written in the answer
    tickers: list[str] = field(default_factory=list)

    def __bool__(self) -> bool:
        return bool(self.figures or self.tickers)


def _value(text: str) -> tuple[float, int]:
    """A number as written in an answer, English or Ukrainian style, and how many decimals it shows."""
    s = re.sub(r"[   ]", "", text)
    if "," in s and "." in s:
        s = s.replace(",", "")
    elif "," in s:
        s = s.replace(",", "") if re.fullmatch(r"\d{1,3}(?:,\d{3})+", s) else s.replace(",", ".")
    decimals = len(s.split(".", 1)[1]) if "." in s else 0
    return float(s), decimals


def _scale(word: str | None) -> float:
    return _MULTIPLIER.get((word or "").lower().rstrip("."), 1.0)


def known_values(data_text: str) -> list[float]:
    values = {float(m.group(0).replace(",", "")) for m in _PLAIN.finditer(data_text)}
    for m in _MONEY.finditer(data_text):  # "$1.2B" in the data is 1.2e9, not only 1.2
        number, scale = (m.group("a"), m.group("sa")) if m.group("a") else (m.group("b"), m.group("sb"))
        values.add(float(number.replace(",", "")) * _scale(scale))
    for m in _SCALED.finditer(data_text):
        values.add(float(m.group("n").replace(",", "")) * _scale(m.group("s")))
    return sorted(values)


def _found(value: float, decimals: int, scale: float, known: list[float]) -> bool:
    tolerance = 0.5 * 10 ** -decimals * scale + 1e-9
    return any(abs(abs(value) - k) <= tolerance for k in known)


def check(answer: str, data_text: str) -> Findings:
    known = known_values(data_text)
    known_tickers = set(_TICKER.findall(data_text))
    findings = Findings()
    for line in answer.splitlines():
        has_figure = False
        for m in _MONEY.finditer(line):
            number, scale = (m.group("a"), m.group("sa")) if m.group("a") else (m.group("b"), m.group("sb"))
            value, decimals = _value(number)
            has_figure = True
            if value and not _found(value * _scale(scale), decimals, _scale(scale), known):
                findings.figures.append(m.group(0).strip())
        for m in _PERCENT.finditer(line):
            value, decimals = _value(m.group("n"))
            has_figure = True
            if value not in (0, 100) and not _found(value, decimals, 1.0, known):
                findings.figures.append(m.group(0).strip())
        if has_figure:
            for ticker in _TICKER.findall(line):
                if ticker not in known_tickers and ticker not in _NOT_TICKERS and ticker not in findings.tickers:
                    findings.tickers.append(ticker)
    findings.figures = list(dict.fromkeys(findings.figures))
    return findings


def repair_message(findings: Findings) -> str:
    """What the model is told when its answer didn't pass. The investor never sees it."""
    lines = ["An automatic check compared your answer with the data you were given, before showing it."]
    if findings.figures:
        lines.append("These figures appear neither in the data nor in tool results: " + ", ".join(findings.figures) + ".")
    if findings.tickers:
        lines.append("These tickers have figures next to them but no data in this conversation: " + ", ".join(findings.tickers) + ".")
    lines.append(
        "Write the answer again. Quote figures exactly as the data has them. For a stock you have no data on, call "
        "get_stock first or leave out its figures. If a figure is your own calculation or general knowledge, say so in "
        "that sentence. Reply with the whole corrected answer only, without mentioning this check."
    )
    return "\n".join(lines)
