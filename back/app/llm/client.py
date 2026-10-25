"""Gemini client: retries for transient errors, validated structured output, and a model fallback
chain — when a model can't be reached (retired, no access, quota spent, overloaded) the next one
in the list answers instead."""

from __future__ import annotations

import asyncio
import logging
import re
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, TypeVar

from google import genai
from google.genai import errors, types
from pydantic import BaseModel, ValidationError

T = TypeVar("T", bound=BaseModel)
R = TypeVar("R")

logger = logging.getLogger(__name__)

# First model is tried first; override with GEMINI_MODEL / GEMINI_FALLBACK_MODELS in .env.
DEFAULT_MODEL = "gemini-3.1-flash-lite"
DEFAULT_FALLBACK_MODELS = ("gemini-3.5-flash-lite", "gemini-2.5-flash", "gemini-flash-lite-latest")
MAX_RETRY_DELAY_S = 60.0  # longer server-requested waits fail fast instead

# Transient API failures worth retrying on the same model.
_RETRYABLE_CODES = {408, 429, 500, 502, 503, 504}
# Failures where another model may still work: unknown/retired model, no access, quota, outage.
_FALLBACK_CODES = {400, 403, 404, 408, 429, 500, 502, 503, 504}


class StructuredOutputError(Exception):
    """Model kept returning output that does not satisfy the schema."""

    def __init__(self, attempts: int, errors: list[str]) -> None:
        self.attempts = attempts
        self.errors = errors
        super().__init__(f"invalid structured output after {attempts} attempt(s): " + "; ".join(errors))


class AllModelsFailedError(Exception):
    """Every model in the chain failed; `failures` is (model, reason) per model tried."""

    def __init__(self, failures: list[tuple[str, str]]) -> None:
        self.failures = failures
        super().__init__("all models failed: " + "; ".join(f"{m}: {r}" for m, r in failures))


@dataclass
class UsageStats:
    calls: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    thinking_tokens: int = 0  # billed as output
    total_tokens: int = 0
    api_seconds: float = 0.0  # time spent waiting for Gemini (successful calls)
    repairs: int = 0  # structured() repair retries sent
    rate_limited: int = 0  # 429 responses that were retried
    wait_seconds: float = 0.0  # time slept before retries
    fallbacks: int = 0  # times a later model in the chain was used
    by_model: dict[str, int] = field(default_factory=dict)  # successful calls per model

    def add(self, model: str, usage: types.GenerateContentResponseUsageMetadata | None, seconds: float = 0.0) -> None:
        self.api_seconds += seconds
        self.by_model[model] = self.by_model.get(model, 0) + 1
        if usage is None:
            return
        self.calls += 1
        self.prompt_tokens += usage.prompt_token_count or 0
        self.completion_tokens += usage.candidates_token_count or 0
        self.thinking_tokens += usage.thoughts_token_count or 0
        self.total_tokens += usage.total_token_count or 0

    def summary(self) -> str:
        return (
            f"calls={self.calls} prompt={self.prompt_tokens} completion={self.completion_tokens} "
            + (f"thinking={self.thinking_tokens} " if self.thinking_tokens else "")
            + f"total={self.total_tokens} api_time={self.api_seconds:.1f}s"
            + (f" retry_wait={self.wait_seconds:.0f}s" if self.wait_seconds else "")
            + (f" fallbacks={self.fallbacks}" if self.fallbacks else "")
        )


@dataclass
class StructuredResult[M: BaseModel]:
    value: M
    model: str  # the model that produced it


class LLMClient:
    """Thin wrapper around the Gemini client."""

    def __init__(
        self,
        api_key: str,
        models: list[str] | None = None,
        max_retries: int = 3,
        retry_base_delay: float = 1.0,
        max_repair_attempts: int = 1,
    ) -> None:
        if not api_key:
            raise ValueError("GEMINI_API_KEY is not set in back/.env")
        chain = [m.strip() for m in (models or [DEFAULT_MODEL, *DEFAULT_FALLBACK_MODELS]) if m and m.strip()]
        self.models = list(dict.fromkeys(chain))  # keep order, drop duplicates
        self.max_retries = max_retries
        self.retry_base_delay = retry_base_delay
        self.max_repair_attempts = max_repair_attempts
        self.usage = UsageStats()
        self._client = genai.Client(api_key=api_key)

    async def generate(self, prompt: str) -> str:
        """Return the full reply as plain text."""
        response, _ = await self._with_fallback(lambda model: self._generate_content(model, prompt))
        return response.text or ""

    async def structured(
        self,
        prompt: str,
        schema: type[T],
        *,
        context: dict[str, Any] | None = None,
        system_instruction: str | None = None,
    ) -> StructuredResult[T]:
        """Return a validated Pydantic model and the model name that produced it.

        Two layers:
        - response_schema makes Gemini emit JSON of the right *shape*;
        - schema.model_validate_json(..., context=...) checks what the API schema cannot express.

        On validation failure the errors are sent back to the model once ("repair" retry) instead of
        re-asking the identical prompt. If a model still fails, the next model in the chain tries.
        """
        config = types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=schema,
            system_instruction=system_instruction,
        )

        async def attempt_with(model: str) -> T:
            attempt_prompt = prompt
            attempts = 1 + self.max_repair_attempts
            problems: list[str] = []
            for attempt in range(1, attempts + 1):
                response = await self._generate_content(model, attempt_prompt, config=config)
                try:
                    return self._parse_structured(response, schema, context)
                except ValidationError as exc:
                    problems = _format_validation_errors(exc)
                except ValueError as exc:
                    problems = [str(exc)]
                logger.warning("Structured output from %s rejected (attempt %d/%d): %s", model, attempt, attempts, "; ".join(problems))
                attempt_prompt = _repair_prompt(prompt, response.text or "", problems)
                if attempt < attempts:
                    self.usage.repairs += 1
            raise StructuredOutputError(attempts, problems)

        value, model = await self._with_fallback(attempt_with)
        return StructuredResult(value=value, model=model)

    async def _with_fallback(self, run: Callable[[str], Awaitable[R]]) -> tuple[R, str]:
        failures: list[tuple[str, str]] = []
        for index, model in enumerate(self.models):
            try:
                result = await run(model)
            except errors.APIError as exc:
                if exc.code not in _FALLBACK_CODES:
                    raise
                failures.append((model, f"{exc.code} {exc.status or ''}".strip()))
            except StructuredOutputError as exc:
                failures.append((model, str(exc)))
            else:
                if index:
                    self.usage.fallbacks += 1
                    logger.warning("Gemini answered with fallback model %s after: %s", model, failures)
                return result, model
            logger.warning("Gemini model %s failed (%s), trying the next one", model, failures[-1][1])
        raise AllModelsFailedError(failures)

    async def _generate_content(
        self,
        model: str,
        prompt: str | list[types.Content],
        config: types.GenerateContentConfig | None = None,
    ) -> types.GenerateContentResponse:
        async def call() -> types.GenerateContentResponse:
            started = time.perf_counter()
            response = await self._client.aio.models.generate_content(model=model, contents=prompt, config=config)
            self.usage.add(model, response.usage_metadata, time.perf_counter() - started)
            return response

        return await self._with_retries(call)

    async def _with_retries(self, call: Callable[[], Awaitable[R]]) -> R:
        last_error: Exception | None = None
        for attempt in range(self.max_retries):
            try:
                return await call()
            except errors.APIError as exc:
                last_error = exc
                if exc.code not in _RETRYABLE_CODES or attempt + 1 >= self.max_retries:
                    raise
                # 429 says how long to wait; 1-2 s backoff would just burn the retries.
                delay = _server_retry_delay(exc) or self.retry_base_delay * (2**attempt)
                if delay > MAX_RETRY_DELAY_S:
                    raise  # e.g. a daily quota: waiting won't help, let the next model try
                if exc.code == 429:
                    self.usage.rate_limited += 1
                self.usage.wait_seconds += delay
                logger.warning("Gemini %s %s, retrying in %.0f s (attempt %d/%d)", exc.code, exc.status, delay, attempt + 2, self.max_retries)
                await asyncio.sleep(delay)
        raise RuntimeError("retry loop exited unexpectedly") from last_error

    @staticmethod
    def _parse_structured(response: types.GenerateContentResponse, schema: type[T], context: dict[str, Any] | None) -> T:
        # Truncated JSON may still parse into something plausible; reject it explicitly.
        candidate = response.candidates[0] if response.candidates else None
        if candidate is not None and candidate.finish_reason == types.FinishReason.MAX_TOKENS:
            raise ValueError("response truncated (MAX_TOKENS)")
        if not response.text:
            reason = candidate.finish_reason if candidate else "no candidates"
            raise ValueError(f"empty response (finish_reason={reason})")
        # Always validate the raw text ourselves: response.parsed skips our context validators.
        return schema.model_validate_json(response.text, context=context)


def _server_retry_delay(exc: errors.APIError) -> float | None:
    """Seconds from google.rpc.RetryInfo ("retryDelay": "21s"), if the server sent one."""
    details = exc.details.get("error", {}).get("details", []) if isinstance(exc.details, dict) else []
    for item in details:
        if isinstance(item, dict) and item.get("@type", "").endswith("RetryInfo"):
            match = re.fullmatch(r"(\d+(?:\.\d+)?)s", str(item.get("retryDelay", "")))
            if match:
                return float(match.group(1)) + 1.0  # small margin past the quota window
    return None


def _format_validation_errors(exc: ValidationError) -> list[str]:
    return [f"{'.'.join(str(p) for p in err['loc']) or '<root>'}: {err['msg']}" for err in exc.errors(include_url=False)]


def _repair_prompt(original: str, bad_output: str, problems: list[str]) -> str:
    issues = "\n".join(f"- {p}" for p in problems)
    return f"""{original}

## Your previous answer was rejected by validation
Previous answer:
{bad_output or "(empty)"}

Problems:
{issues}

Return a corrected answer that fixes every problem and still follows all rules above."""
